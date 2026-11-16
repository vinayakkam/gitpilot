//! Remote control, from the Settings screen.
//!
//! Thin on purpose: everything real happens in `remote::service`. Note what is *not* here --
//! there is no command that takes a pairing key or runs a phone command locally, so nothing in
//! the UI can hand a key to anything, and a page in a WebView cannot impersonate a phone.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppResult;
use crate::remote::service::{self, Pairing, RemoteStatus};
use crate::state::AppState;

#[tauri::command]
pub async fn remote_status(state: State<'_, AppState>) -> AppResult<RemoteStatus> {
    Ok(service::status(&state).await)
}

/// Turns the feature on or off. Turning it off stops the loop but keeps paired phones, so it can
/// be turned on again without pairing anything twice.
#[tauri::command]
pub async fn remote_enable(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<RemoteStatus> {
    state.update_settings(|s| s.remote.enabled = enabled)?;
    if enabled {
        service::spawn_loop(&app);
    }
    Ok(service::status(&state).await)
}

/// Starts pairing: opens a relay channel, makes a key, and returns what the QR code should show.
#[tauri::command]
pub async fn remote_pair_start(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Pairing> {
    let pairing = service::pair_start(&state, &name).await?;
    service::spawn_loop(&app);
    Ok(pairing)
}

#[tauri::command]
pub async fn remote_device_remove(state: State<'_, AppState>, device: String) -> AppResult<RemoteStatus> {
    service::remove_device(&state, &device).await?;
    Ok(service::status(&state).await)
}

/// Checks for commands straight away, instead of waiting for the next pass. Used by the "test the
/// connection" button in Settings, where waiting fifteen seconds would feel broken.
#[tauri::command]
pub async fn remote_poll_now(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    let pass = service::poll_once(&state).await;
    if pass.handled > 0 {
        let _ = app.emit("remote-activity", pass.handled);
    }
    Ok(pass.handled)
}

/// Starts the listening loop at startup when the user already had it on.
pub fn start_if_enabled(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if state.settings().remote.enabled {
            service::spawn_loop(app);
        }
    }
}
