//! Shared application state managed by Tauri.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use rusqlite::Connection;

use crate::db;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::git::{locate::locate_git, Git};
use crate::settings::{self, Settings};

pub struct AppState {
    db: Mutex<Connection>,
    settings: RwLock<Settings>,
    settings_path: PathBuf,
    pub data_dir: PathBuf,
    locks: Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>,
    cancels: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
    pub watches: crate::watch::Watches,
}

impl AppState {
    pub fn new(data_dir: PathBuf, config_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&config_dir)?;
        let conn = db::open(&data_dir.join("gitpilot.db"))?;
        let settings_path = config_dir.join("settings.json");
        let settings = settings::load(&settings_path);
        Ok(Self {
            db: Mutex::new(conn),
            settings: RwLock::new(settings),
            settings_path,
            data_dir,
            locks: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            watches: crate::watch::Watches::default(),
        })
    }

    pub fn db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self
            .db
            .lock()
            .map_err(|_| AppError::new(ErrorKind::Database, "The database is unavailable."))?;
        f(&conn)
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn save_settings(&self, s: Settings) -> AppResult<Settings> {
        s.validate()?;
        settings::save(&self.settings_path, &s)?;
        if let Ok(mut w) = self.settings.write() {
            *w = s.clone();
        }
        Ok(s)
    }

    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> AppResult<()> {
        let mut s = self.settings();
        f(&mut s);
        settings::save(&self.settings_path, &s)?;
        if let Ok(mut w) = self.settings.write() {
            *w = s;
        }
        Ok(())
    }

    pub fn git(&self) -> AppResult<Git> {
        let s = self.settings();
        let configured = Some(s.git_path.as_str()).filter(|p| !p.trim().is_empty());
        locate_git(configured).map(Git::new).ok_or_else(|| {
            if configured.is_some() {
                AppError::new(
                    ErrorKind::GitNotFound,
                    "The Git executable set in Settings → Git doesn't exist. Fix the path or clear it to auto-detect.",
                )
            } else {
                AppError::new(
                    ErrorKind::GitNotFound,
                    "Git isn't installed or couldn't be found. Install Git (git-scm.com) or set its location in Settings → Git.",
                )
            }
        })
    }

    /// Resolves a registered repository id to its folder. Commands never accept raw paths for git work.
    pub fn repo_path(&self, id: i64) -> AppResult<PathBuf> {
        let rec = self.db(|c| db::get(c, id))?;
        let p = PathBuf::from(&rec.path);
        if !p.is_dir() {
            return Err(AppError::new(
                ErrorKind::PathNotFound,
                format!("The folder for '{}' was moved or deleted. Locate it again or remove it from GitPilot.", rec.name),
            )
            .with_detail(rec.path));
        }
        Ok(p)
    }

    /// Per-repository lock that serializes mutating operations.
    pub fn repo_lock(&self, id: i64) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.locks.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(id).or_default().clone()
    }

    pub fn backup_dir(&self) -> PathBuf {
        self.data_dir.join("discard-backups")
    }

    /// Registers a cancellable operation under `key` ("clone" or "repo:<id>").
    /// The returned guard unregisters it when the operation ends.
    pub fn begin_cancellable(&self, key: String) -> CancelGuard<'_> {
        let notify = Arc::new(tokio::sync::Notify::new());
        self.cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key.clone(), notify.clone());
        CancelGuard {
            state: self,
            key,
            notify,
        }
    }

    /// Requests cancellation. Returns false when nothing cancellable is running under `key`.
    pub fn cancel(&self, key: &str) -> bool {
        match self
            .cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
        {
            Some(n) => {
                n.notify_one();
                true
            }
            None => false,
        }
    }
}

pub struct CancelGuard<'a> {
    state: &'a AppState,
    key: String,
    pub notify: Arc<tokio::sync::Notify>,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        let mut map = self.state.cancels.lock().unwrap_or_else(|e| e.into_inner());
        if map
            .get(&self.key)
            .is_some_and(|n| Arc::ptr_eq(n, &self.notify))
        {
            map.remove(&self.key);
        }
    }
}
