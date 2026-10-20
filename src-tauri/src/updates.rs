//! How this copy of GitPilot was installed, and whether it can update itself.

use serde::Serialize;
use tauri::utils::config::BundleType;
use ts_rs::TS;

/// Written by the Arch/CachyOS package. Such installs are managed by pacman, so the in-app
/// updater must not replace files itself.
pub const PACKAGE_MANAGER_MARKER: &str = "/usr/share/gitpilot/package-manager";

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
        return UpdateSupport {
            can_install: false,
            note: Some(format!(
                "GitPilot was installed with {pm}. Download the new package from the release page and install it with {pm} (for pacman: sudo pacman -U <file>)."
            )),
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
