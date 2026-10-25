use serde::Serialize;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::git::repo::{self, Identity};
use crate::secrets::{self, KeyStatus};
use crate::settings::{AiProviderKind, Settings};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub git_path: Option<String>,
    pub git_version: Option<String>,
    pub git_error: Option<AppError>,
    pub global_identity: Option<Identity>,
    pub data_dir: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    let (git_path, git_version, git_error, global_identity) = match state.git() {
        Ok(g) => match repo::git_version(&g).await {
            Ok(v) => {
                let id = repo::global_identity(&g).await.ok();
                (Some(g.exe().display().to_string()), Some(v), None, id)
            }
            Err(e) => (Some(g.exe().display().to_string()), None, Some(e), None),
        },
        Err(e) => (None, None, Some(e), None),
    };
    Ok(AppInfo {
        // Same source the updater compares against (tauri.conf.json "version").
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        git_path,
        git_version,
        git_error,
        global_identity,
        data_dir: state.data_dir.display().to_string(),
    })
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Settings {
    state.settings()
}

/// Saves settings and tells every window ("settings-changed"), so they all use them at once.
#[tauri::command]
pub fn settings_save(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> AppResult<Settings> {
    use tauri::Emitter;
    // last_repo_id is owned by the backend.
    let mut s = settings;
    s.last_repo_id = state.settings().last_repo_id;
    let saved = state.save_settings(s)?;
    let _ = app.emit("settings-changed", &saved);
    Ok(saved)
}

#[tauri::command]
pub fn secret_status(provider: AiProviderKind) -> KeyStatus {
    secrets::status(provider)
}

#[tauri::command]
pub fn secret_set(provider: AiProviderKind, key: String) -> AppResult<KeyStatus> {
    secrets::set(provider, &key)?;
    Ok(secrets::status(provider))
}

#[tauri::command]
pub fn secret_clear(provider: AiProviderKind) -> AppResult<KeyStatus> {
    secrets::clear(provider)?;
    Ok(secrets::status(provider))
}

#[tauri::command]
pub fn update_support() -> crate::updates::UpdateSupport {
    crate::updates::support()
}
