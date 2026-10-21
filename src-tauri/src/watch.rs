//! Auto-refresh: watches a repository's files and tells the UI when something changed,
//! so the file list updates the moment you save in your editor.
//!
//! Ignored paths (.gitignore, .git/info/exclude) are filtered out, and on Linux only
//! non-ignored folders are watched at all, so `node_modules` or `target` never use up
//! inotify watches. Events are debounced; one "repo-changed" event is emitted per burst.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// Quiet period before reporting a change.
const DEBOUNCE: Duration = Duration::from_millis(350);
/// Upper bound on folders watched individually (Linux).
const MAX_DIRS: usize = 20_000;

type Shared = Arc<Mutex<RecommendedWatcher>>;

struct Entry {
    _watcher: Shared,
    stop: Arc<AtomicBool>,
    users: usize,
}

#[derive(Default)]
pub struct Watches {
    inner: Mutex<HashMap<i64, Entry>>,
}

impl Watches {
    /// Starts watching `root` (or adds a user if it's already watched).
    /// `notify_ui` is called (from a background thread) after each burst of changes.
    pub fn watch(
        &self,
        id: i64,
        root: PathBuf,
        notify_ui: impl Fn() + Send + 'static,
    ) -> Result<(), String> {
        let mut map = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(e) = map.get_mut(&id) {
            e.users += 1;
            return Ok(());
        }
        let (tx, rx) = channel::<Event>();
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                let _ = tx.send(ev);
            }
        })
        .map_err(|e| e.to_string())?;
        let shared: Shared = Arc::new(Mutex::new(watcher));
        let filter = Filter::new(&root);
        {
            let mut w = shared.lock().map_err(|e| e.to_string())?;
            if cfg!(target_os = "linux") {
                for dir in filter.dirs_to_watch(&root) {
                    let _ = w.watch(&dir, RecursiveMode::NonRecursive);
                }
            } else {
                w.watch(&root, RecursiveMode::Recursive)
                    .map_err(|e| e.to_string())?;
            }
            let git_dir = root.join(".git");
            if git_dir.is_dir() {
                let _ = w.watch(&git_dir, RecursiveMode::NonRecursive);
                let _ = w.watch(&git_dir.join("refs"), RecursiveMode::Recursive);
            }
        }
        let stop = Arc::new(AtomicBool::new(false));
        let weak: Weak<Mutex<RecommendedWatcher>> = Arc::downgrade(&shared);
        let stop2 = stop.clone();
        std::thread::Builder::new()
            .name(format!("gitpilot-watch-{id}"))
            .spawn(move || {
                let mut filter = filter;
                let mut pending = false;
                loop {
                    if stop2.load(Ordering::Relaxed) {
                        return;
                    }
                    let wait = if pending {
                        DEBOUNCE
                    } else {
                        Duration::from_secs(1)
                    };
                    match rx.recv_timeout(wait) {
                        Ok(ev) => {
                            if filter.relevant(&ev) {
                                pending = true;
                                if cfg!(target_os = "linux") {
                                    filter.watch_new_dirs(&ev, &weak);
                                }
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            if pending {
                                pending = false;
                                filter.reload_if_ignore_changed();
                                notify_ui();
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        map.insert(
            id,
            Entry {
                _watcher: shared,
                stop,
                users: 1,
            },
        );
        Ok(())
    }

    /// Removes a user; the watch stops when nobody needs it any more.
    pub fn unwatch(&self, id: i64) {
        if let Ok(mut map) = self.inner.lock() {
            let remove = match map.get_mut(&id) {
                Some(e) => {
                    e.users = e.users.saturating_sub(1);
                    e.users == 0
                }
                None => false,
            };
            if remove {
                if let Some(e) = map.remove(&id) {
                    e.stop.store(true, Ordering::Relaxed);
                }
            }
        }
    }

    pub fn is_watching(&self, id: i64) -> bool {
        self.inner
            .lock()
            .map(|m| m.contains_key(&id))
            .unwrap_or(false)
    }
}

/// Decides which file-system events matter.
struct Filter {
    root: PathBuf,
    git_dir: PathBuf,
    ignore: Gitignore,
    ignore_changed: bool,
    watched_dirs: usize,
}

impl Filter {
    fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            git_dir: root.join(".git"),
            ignore: build_ignore(root),
            ignore_changed: false,
            watched_dirs: 0,
        }
    }

    fn reload_if_ignore_changed(&mut self) {
        if self.ignore_changed {
            self.ignore = build_ignore(&self.root);
            self.ignore_changed = false;
        }
    }

    fn is_ignored(&self, p: &Path, is_dir: bool) -> bool {
        match p.strip_prefix(&self.root) {
            Ok(rel) if !rel.as_os_str().is_empty() => self
                .ignore
                .matched_path_or_any_parents(rel, is_dir)
                .is_ignore(),
            _ => false,
        }
    }

    fn relevant(&mut self, ev: &Event) -> bool {
        if matches!(ev.kind, EventKind::Access(_)) {
            return false;
        }
        ev.paths.iter().any(|p| self.relevant_path(p))
    }

    fn relevant_path(&mut self, p: &Path) -> bool {
        if let Ok(rel) = p.strip_prefix(&self.git_dir) {
            let name = rel.to_string_lossy().replace('\\', "/");
            if name.ends_with(".lock") {
                return false;
            }
            return matches!(
                name.as_str(),
                "index"
                    | "HEAD"
                    | "ORIG_HEAD"
                    | "MERGE_HEAD"
                    | "FETCH_HEAD"
                    | "packed-refs"
                    | "CHERRY_PICK_HEAD"
                    | "REVERT_HEAD"
            ) || name.starts_with("refs/")
                || name.starts_with("rebase-merge")
                || name.starts_with("rebase-apply");
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == ".gitignore" {
            self.ignore_changed = true;
            return true;
        }
        !self.is_ignored(p, p.is_dir())
    }

    /// All non-ignored folders under `root` (excluding .git), up to MAX_DIRS.
    fn dirs_to_watch(&self, root: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let walker = ignore::WalkBuilder::new(root)
            .hidden(false)
            .git_ignore(true)
            .git_exclude(true)
            .git_global(false)
            .require_git(false)
            .filter_entry(|e| e.file_name() != ".git")
            .build();
        for entry in walker.flatten() {
            if entry.file_type().is_some_and(|t| t.is_dir()) {
                out.push(entry.into_path());
                if out.len() >= MAX_DIRS {
                    break;
                }
            }
        }
        out
    }

    /// Linux: newly created folders need their own watch.
    fn watch_new_dirs(&mut self, ev: &Event, watcher: &Weak<Mutex<RecommendedWatcher>>) {
        if !matches!(ev.kind, EventKind::Create(_)) || self.watched_dirs >= MAX_DIRS {
            return;
        }
        let Some(shared) = watcher.upgrade() else {
            return;
        };
        let Ok(mut w) = shared.lock() else {
            return;
        };
        for p in &ev.paths {
            if p.is_dir() && !p.starts_with(&self.git_dir) && !self.is_ignored(p, true) {
                for d in self.dirs_to_watch(p) {
                    if w.watch(&d, RecursiveMode::NonRecursive).is_ok() {
                        self.watched_dirs += 1;
                    }
                }
            }
        }
    }
}

fn build_ignore(root: &Path) -> Gitignore {
    let mut b = GitignoreBuilder::new(root);
    let _ = b.add(root.join(".gitignore"));
    let _ = b.add(root.join(".git").join("info").join("exclude"));
    b.build().unwrap_or_else(|_| Gitignore::empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn wait_for(count: &AtomicUsize, at_least: usize) -> bool {
        for _ in 0..60 {
            if count.load(Ordering::SeqCst) >= at_least {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn reports_changes_but_not_ignored_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
        let f = Filter::new(&root);
        let dirs = f.dirs_to_watch(&root);
        assert!(dirs.iter().any(|d| d.ends_with("src")));
        assert!(!dirs
            .iter()
            .any(|d| d.to_string_lossy().contains("node_modules")));

        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let w = Watches::default();
        w.watch(1, root.clone(), move || {
            c.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200));

        // Ignored writes don't trigger a refresh.
        std::fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
        std::fs::write(root.join("debug.log"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(900));
        assert_eq!(
            count.load(Ordering::SeqCst),
            0,
            "ignored files are filtered out"
        );

        // A real edit does, once per burst.
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(root.join("src/lib.rs"), "").unwrap();
        assert!(wait_for(&count, 1), "edit reported");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(count.load(Ordering::SeqCst), 1, "debounced into one event");

        // New folders are picked up (Linux watches folders one by one).
        std::fs::create_dir_all(root.join("src/new")).unwrap();
        assert!(wait_for(&count, 2));
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(root.join("src/new/file.rs"), "x").unwrap();
        assert!(wait_for(&count, 3), "file in a new folder reported");

        w.unwatch(1);
        assert!(!w.is_watching(1));
    }
}
