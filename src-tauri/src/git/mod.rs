//! Git integration layer. All git processes are spawned by `runner`.

pub mod assist;
pub mod diff;
pub mod eol;
pub mod errors;
pub mod everyday;
pub mod explore;
pub mod locate;
pub mod log;
pub mod pulls;
pub mod redact;
pub mod refs;
pub mod repo;
pub mod rewrite;
pub mod runner;
pub mod status;
pub mod validate;

pub use repo::Repo;
pub use runner::Git;
