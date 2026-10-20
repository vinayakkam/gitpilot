//! SQLite repository registry. Only data Git can't tell us is stored here.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoRecord {
    #[ts(type = "number")]
    pub id: i64,
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub added_at: i64,
    #[ts(type = "number | null")]
    pub last_opened_at: Option<i64>,
    /// Whether the folder still exists on disk (computed, not stored).
    pub available: bool,
}

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS repos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            last_opened_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');",
    )?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<RepoRecord> {
    let path: String = r.get(1)?;
    Ok(RepoRecord {
        id: r.get(0)?,
        available: Path::new(&path).is_dir(),
        path,
        name: r.get(2)?,
        added_at: r.get(3)?,
        last_opened_at: r.get(4)?,
    })
}

const COLS: &str = "id, path, name, added_at, last_opened_at";

pub fn list(conn: &Connection) -> AppResult<Vec<RepoRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM repos ORDER BY COALESCE(last_opened_at, added_at) DESC, name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], row_to_record)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<RepoRecord> {
    conn.query_row(
        &format!("SELECT {COLS} FROM repos WHERE id = ?1"),
        [id],
        row_to_record,
    )
    .optional()?
    .ok_or_else(|| {
        AppError::new(
            ErrorKind::InvalidInput,
            "That repository is no longer registered in GitPilot.",
        )
    })
}

pub fn find_by_path(conn: &Connection, path: &str) -> AppResult<Option<RepoRecord>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLS} FROM repos WHERE path = ?1"),
            [path],
            row_to_record,
        )
        .optional()?)
}

/// Adds a repository, or returns the existing record if the path is already registered.
pub fn add(conn: &Connection, path: &str, name: &str) -> AppResult<RepoRecord> {
    if let Some(existing) = find_by_path(conn, path)? {
        return Ok(existing);
    }
    conn.execute(
        "INSERT INTO repos (path, name, added_at) VALUES (?1, ?2, ?3)",
        params![path, name, now()],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn touch(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE repos SET last_opened_at = ?1 WHERE id = ?2",
        params![now(), id],
    )?;
    Ok(())
}

pub fn relocate(conn: &Connection, id: i64, path: &str, name: &str) -> AppResult<RepoRecord> {
    if let Some(other) = find_by_path(conn, path)? {
        if other.id != id {
            return Err(AppError::new(
                ErrorKind::AlreadyExists,
                "That folder is already registered as another repository.",
            ));
        }
    }
    conn.execute(
        "UPDATE repos SET path = ?1, name = ?2 WHERE id = ?3",
        params![path, name, id],
    )?;
    get(conn, id)
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> AppResult<RepoRecord> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::invalid("Name can't be empty."));
    }
    conn.execute(
        "UPDATE repos SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    get(conn, id)
}

/// Unregisters a repository. Never touches files on disk.
pub fn remove(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM repos WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud() {
        let c = open_in_memory().unwrap();
        let a = add(&c, "/tmp/a", "a").unwrap();
        let again = add(&c, "/tmp/a", "other").unwrap();
        assert_eq!(a.id, again.id);
        add(&c, "/tmp/b", "b").unwrap();
        touch(&c, a.id).unwrap();
        let l = list(&c).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].name, "a");
        let moved = relocate(&c, a.id, "/tmp/c", "c").unwrap();
        assert_eq!(moved.path, "/tmp/c");
        remove(&c, a.id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        assert!(get(&c, a.id).is_err());
    }
}
