//! GitPilot backend.

pub mod ai;
pub mod claude_code;
pub mod cli;
mod commands;
pub mod db;
pub mod error;
pub mod git;
pub mod github;
pub mod opencode;
pub mod secrets;
pub mod settings;
pub mod signing_keys;
pub mod state;
pub mod updates;
pub mod watch;

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(st) = window.try_state::<state::AppState>() {
                    st.release_window(window.label());
                }
            }
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
            commands::changes::last_commit,
            commands::changes::lfs_status,
            commands::changes::lfs_track,
            commands::changes::lfs_untrack,
            commands::changes::lfs_install_hooks,
            commands::repos::repo_watch,
            commands::repos::repo_unwatch,
            commands::repos::window_open_repo,
            commands::changes::commit_amend,
            commands::changes::commit_undo,
            commands::changes::discard_partial,
            commands::changes::stash_paths,
            commands::branches::tag_list,
            commands::branches::tag_create,
            commands::branches::tag_delete,
            commands::branches::tag_push,
            commands::history::log_get,
            commands::history::commit_get,
            commands::history::commit_diff_file,
            commands::history::commit_revert,
            commands::history::commit_cherry_pick,
            commands::history::branch_merge,
            commands::history::branch_rebase,
            commands::history::sequence_run,
            commands::history::file_blame,
            commands::history::compare_files,
            commands::history::compare_file_diff,
            commands::history::conflict_resolve_block,
            commands::history::conflict_take_side,
            commands::history::conflict_apply_text,
            commands::history::rebase_commits,
            commands::history::rebase_interactive,
            commands::history::branch_reset,
            commands::history::backup_list,
            commands::history::backup_restore,
            commands::history::backup_delete,
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
            commands::branches::worktree_list,
            commands::branches::worktree_add,
            commands::branches::worktree_remove,
            commands::branches::worktree_prune,
            commands::remotes::remote_list,
            commands::remotes::remote_add,
            commands::remotes::remote_set_url,
            commands::remotes::remote_remove,
            commands::remotes::sync_fetch,
            commands::remotes::sync_pull,
            commands::remotes::sync_push,
            commands::remotes::op_cancel,
            commands::remotes::submodule_list,
            commands::remotes::submodule_update,
            commands::github::github_account,
            commands::github::github_device_start,
            commands::github::github_device_wait,
            commands::github::github_token_set,
            commands::github::github_sign_out,
            commands::github::github_repos,
            commands::github::github_link,
            commands::github::github_pulls,
            commands::github::github_pull_create,
            commands::github::github_pull_checkout,
            commands::assist::ai_suggest_commit,
            commands::assist::ai_explain,
            commands::assist::ai_pr_description,
            commands::assist::ai_conflict_help,
            commands::assist::claude_detect,
            commands::assist::opencode_detect,
            commands::signing::signing_get,
            commands::signing::signing_keys,
            commands::signing::signing_enable,
            commands::signing::signing_disable,
            commands::signing::commit_signature,
            commands::assist::assistant_launch,
            commands::assist::staged_diff_text,
            commands::assist::claude_auth_status,
            commands::assist::claude_login,
            commands::assist::openrouter_models,
            commands::assist::openrouter_key_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitPilot");
}
