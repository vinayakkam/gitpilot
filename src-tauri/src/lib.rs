//! GitPilot backend.

pub mod ai;
pub mod claude_code;
mod commands;
pub mod db;
pub mod error;
pub mod git;
pub mod secrets;
pub mod settings;
pub mod state;
pub mod updates;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let config = app.path().app_config_dir()?;
            let st = state::AppState::new(data, config)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            app.manage(st);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::settings_get,
            commands::app::settings_save,
            commands::app::secret_status,
            commands::app::secret_set,
            commands::app::secret_clear,
            commands::app::update_support,
            commands::repos::repo_list,
            commands::repos::repo_inspect_path,
            commands::repos::repo_add,
            commands::repos::repo_init,
            commands::repos::repo_clone,
            commands::repos::repo_remove,
            commands::repos::repo_relocate,
            commands::repos::repo_rename,
            commands::repos::repo_open,
            commands::changes::status_get,
            commands::changes::diff_file,
            commands::changes::stage_paths,
            commands::changes::unstage_paths,
            commands::changes::stage_all,
            commands::changes::unstage_all,
            commands::changes::hunk_apply,
            commands::changes::discard_tracked,
            commands::changes::discard_untracked,
            commands::changes::commit_create,
            commands::changes::identity_get,
            commands::changes::identity_set,
            commands::changes::files_search,
            commands::changes::lines_apply,
            commands::changes::eol_check,
            commands::changes::eol_fix,
            commands::changes::eol_add_gitattributes,
            commands::changes::gitignore_add,
            commands::changes::untrack_paths,
            commands::history::log_get,
            commands::history::commit_get,
            commands::history::commit_diff_file,
            commands::history::commit_revert,
            commands::history::commit_cherry_pick,
            commands::history::branch_merge,
            commands::history::branch_rebase,
            commands::history::sequence_run,
            commands::branches::branch_list,
            commands::branches::branch_create,
            commands::branches::branch_switch,
            commands::branches::branch_checkout_remote,
            commands::branches::branch_rename,
            commands::branches::branch_delete,
            commands::branches::branch_delete_remote,
            commands::branches::branch_compare,
            commands::branches::branch_set_upstream,
            commands::branches::stash_list,
            commands::branches::stash_push,
            commands::branches::stash_apply,
            commands::branches::stash_drop,
            commands::remotes::remote_list,
            commands::remotes::remote_add,
            commands::remotes::remote_set_url,
            commands::remotes::remote_remove,
            commands::remotes::sync_fetch,
            commands::remotes::sync_pull,
            commands::remotes::sync_push,
            commands::remotes::op_cancel,
            commands::assist::ai_suggest_commit,
            commands::assist::claude_detect,
            commands::assist::claude_launch,
            commands::assist::staged_diff_text,
            commands::assist::claude_auth_status,
            commands::assist::claude_login,
            commands::assist::openrouter_models,
            commands::assist::openrouter_key_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitPilot");
}
