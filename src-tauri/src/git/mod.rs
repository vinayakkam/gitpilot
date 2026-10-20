//! Git integration layer. All git processes are spawned by `runner`.

pub mod diff;
pub mod errors;
pub mod locate;
pub mod log;
pub mod redact;
pub mod refs;
pub mod repo;
pub mod runner;
pub mod status;
pub mod validate;

pub use repo::Repo;
pub use runner::Git;
