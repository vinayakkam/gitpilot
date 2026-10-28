//! How this copy of GitPilot was installed, and whether it can update itself.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

/// Written by the Arch/CachyOS package. Such installs are managed by pacman, so updates are
/// installed through pacman (`install_pacman`) instead of the updater's own installer.
pub const PACKAGE_MANAGER_MARKER: &str = "/usr/share/gitpilot/package-manager";

/// The `latest.json` platform key of the signed Arch package.
pub const PACMAN_TARGET: &str = "linux-x86_64-pacman";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateSupport {
    /// GitPilot can download and install updates itself.
    pub can_install: bool,
    /// "nsis", "msi", "appimage", "deb", "pacman" or "dev".
    pub install_kind: String,
    /// Shown when updates must be installed some other way.
    pub note: Option<String>,
}

pub fn support() -> UpdateSupport {
    if let Ok(pm) = std::fs::read_to_string(PACKAGE_MANAGER_MARKER) {
        let pm = pm.trim().to_string();
        let pacman = pm == "pacman";
        return UpdateSupport {
            can_install: pacman,
            note: Some(if pacman {
                "Installing an update asks for your password, because pacman needs administrator rights.".to_string()
            } else {
                format!("GitPilot was installed with {pm}. Download the new package from the release page and install it with {pm}.")
            }),
            install_kind: pm,
        };
    }
    let kind = match tauri::utils::platform::bundle_type() {
        Some(BundleType::Nsis) => "nsis",
        Some(BundleType::Msi) => "msi",
        Some(BundleType::AppImage) => "appimage",
        Some(BundleType::Deb) => "deb",
        Some(BundleType::Rpm) => "rpm",
        _ => "dev",
    };
    let note = match kind {
        "dev" => Some("This is a development build, so it can't update itself.".to_string()),
        "deb" | "rpm" => Some("Installing an update asks for your password, because system packages need administrator rights.".to_string()),
        _ => None,
    };
    UpdateSupport {
        can_install: kind != "dev",
        install_kind: kind.to_string(),
        note,
    }
}

/// Downloads the signed Arch package of the newest release, checks its signature and installs
/// it with `pkexec pacman -U`. Returns the installed version.
pub async fn install_pacman(
    app: &AppHandle,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<String> {
    let failed = |e: tauri_plugin_updater::Error| {
        AppError::internal("The update couldn't be downloaded. GitPilot is unchanged.")
            .with_detail(e.to_string())
    };
    let update = app
        .updater_builder()
        .target(PACMAN_TARGET)
        .build()
        .map_err(failed)?
        .check()
        .await
        .map_err(failed)?
        .ok_or_else(|| AppError::invalid("There's no newer Arch package to install."))?;
    let mut done = 0u64;
    // `download` verifies the minisign signature before returning the bytes.
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                on_progress(done, total);
            },
            || {},
        )
        .await
        .map_err(failed)?;

    let dir = tempfile::Builder::new()
        .prefix("gitpilot-update")
        .tempdir()?;
    let pkg = dir.path().join(package_file_name(&update.version));
    tokio::fs::write(&pkg, &bytes).await?;
    let out = tokio::process::Command::new("pkexec")
        .args(["pacman", "-U", "--noconfirm", "--needed"])
        .arg(&pkg)
        .stdin(std::process::Stdio::null())
        .output()
        .await;
    let out = match out {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::invalid(
                "pkexec isn't installed, so GitPilot can't ask for your password. Install polkit, or download the package from the release page and run: sudo pacman -U <file>",
            ))
        }
        Err(e) => return Err(e.into()),
    };
    match out.status.code() {
        Some(0) => Ok(update.version),
        // pkexec: 126 = the password prompt was dismissed, 127 = not authorized.
        Some(126) | Some(127) => Err(AppError::invalid(
            "The update wasn't installed because the password prompt was cancelled or refused. GitPilot is unchanged.",
        )),
        _ => Err(AppError::internal("pacman couldn't install the update. GitPilot is unchanged.")
            .with_detail(String::from_utf8_lossy(&out.stderr).into_owned())),
    }
}

/// pacman reads the compression from the file name, so keep the real package name.
fn package_file_name(version: &str) -> String {
    let safe: String = version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        .collect();
    format!("gitpilot-bin-{safe}-x86_64.pkg.tar.zst")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_file_name_keeps_only_safe_characters() {
        assert_eq!(
            package_file_name("0.5.0"),
            "gitpilot-bin-0.5.0-x86_64.pkg.tar.zst"
        );
        assert_eq!(
            package_file_name("0.5.0/../x"),
            "gitpilot-bin-0.5.0..x-x86_64.pkg.tar.zst"
        );
    }
}
