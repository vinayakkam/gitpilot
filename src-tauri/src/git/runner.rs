//! The single place where git processes are spawned.
//!
//! Security rules (see CLAUDE.md): argument vectors only, never a shell; credentials are
//! never prompted for on a terminal; output is redacted before it reaches the UI.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Notify;

use super::errors::classify;
use crate::error::{AppError, AppResult, ErrorKind};

pub const LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// The URL-scoped key git reads the GitHub header from: exactly https://github.com, no other host.
const GITHUB_HEADER_KEY: &str = "http.https://github.com/.extraHeader";

#[derive(Clone)]
pub struct Git {
    exe: PathBuf,
    /// `Authorization` header for HTTPS requests to github.com (the GitHub sign-in), if enabled.
    github_auth: Option<String>,
}

// Hand-written so the token never ends up in a log line.
impl std::fmt::Debug for Git {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Git")
            .field("exe", &self.exe)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub struct Output {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

#[derive(Debug, Clone)]
pub struct RunOpts<'a> {
    pub stdin: Option<&'a [u8]>,
    pub timeout: Duration,
    /// Exit codes other than 0 that should be returned as `Ok` (e.g. `diff --no-index` uses 1).
    pub ok_codes: &'a [i32],
    /// Read-only commands set GIT_OPTIONAL_LOCKS=0 so they never contend with the user's own git use.
    pub read_only: bool,
}

impl Default for RunOpts<'_> {
    fn default() -> Self {
        Self {
            stdin: None,
            timeout: LOCAL_TIMEOUT,
            ok_codes: &[],
            read_only: false,
        }
    }
}

impl RunOpts<'_> {
    pub fn read() -> Self {
        Self {
            read_only: true,
            ..Self::default()
        }
    }
}

impl Git {
    pub fn new(exe: PathBuf) -> Self {
        Self {
            exe,
            github_auth: None,
        }
    }

    /// Uses `token` for HTTPS clone/fetch/push to github.com only. It's passed as an
    /// `http.https://github.com/.extraHeader` through `GIT_CONFIG_*` environment variables,
    /// so it never reaches the command line, a config file or a shell credential helper.
    pub fn with_github_token(mut self, token: &str) -> Self {
        use base64::Engine;
        let basic =
            base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
        self.github_auth = Some(format!("Authorization: Basic {basic}"));
        self
    }

    pub fn exe(&self) -> &Path {
        &self.exe
    }

    fn command(&self, cwd: &Path, read_only: bool) -> Command {
        let mut cmd = Command::new(&self.exe);
        cmd.current_dir(cwd)
            // Global config overrides that make output stable and parseable.
            .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_LITERAL_PATHSPECS", "1")
            .env("GIT_PAGER", "cat")
            .env("GIT_MERGE_AUTOEDIT", "no")
            // ":" tells git not to launch an editor (rebase/cherry-pick/revert --continue keep the prepared message).
            .env("GIT_EDITOR", ":")
            // Interactive rebase sets its own sequence editor with `-c sequence.editor=...`;
            // a user's GIT_SEQUENCE_EDITOR would take precedence and open their editor.
            .env_remove("GIT_SEQUENCE_EDITOR")
            .env("LC_ALL", "C")
            .env("LANGUAGE", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if read_only {
            cmd.env("GIT_OPTIONAL_LOCKS", "0");
        }
        if let Some(auth) = &self.github_auth {
            // Appended after any GIT_CONFIG_* entries the user already set.
            let n: usize = std::env::var("GIT_CONFIG_COUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            cmd.env(format!("GIT_CONFIG_KEY_{n}"), GITHUB_HEADER_KEY)
                .env(format!("GIT_CONFIG_VALUE_{n}"), auth)
                .env("GIT_CONFIG_COUNT", (n + 1).to_string());
        }
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }

    /// Runs git and returns the raw output; non-zero exit codes not listed in `ok_codes`
    /// are converted into a classified [`AppError`].
    pub async fn run<I, S>(&self, cwd: &Path, args: I, opts: RunOpts<'_>) -> AppResult<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut cmd = self.command(cwd, opts.read_only);
        cmd.args(args);
        cmd.stdin(if opts.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

        let mut child = cmd.spawn().map_err(|e| spawn_error(&self.exe, e))?;

        if let Some(input) = opts.stdin {
            if let Some(mut stdin) = child.stdin.take() {
                let data = input.to_vec();
                tokio::spawn(async move {
                    let _ = stdin.write_all(&data).await;
                    let _ = stdin.shutdown().await;
                });
            }
        }

        let out = match tokio::time::timeout(opts.timeout, child.wait_with_output()).await {
            Ok(r) => r.map_err(AppError::from)?,
            Err(_) => {
                return Err(AppError::new(
                    ErrorKind::Timeout,
                    "Git took too long to respond and the operation was stopped.",
                ))
            }
        };

        let code = out.status.code().unwrap_or(-1);
        let output = Output {
            stdout: out.stdout,
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            code,
        };
        if code == 0 || opts.ok_codes.contains(&code) {
            Ok(output)
        } else if code == -1 {
            Err(
                AppError::new(ErrorKind::Git, "Git stopped unexpectedly before finishing.")
                    .with_detail(output.stderr),
            )
        } else {
            Err(classify(&output.stderr))
        }
    }

    /// Convenience: run read-only, return stdout as text.
    pub async fn read<I, S>(&self, cwd: &Path, args: I) -> AppResult<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        Ok(self.run(cwd, args, RunOpts::read()).await?.text())
    }

    /// Runs git, streaming progress lines (split on `\r` and `\n`) from stderr to `on_line`.
    /// Used for clone/fetch/pull/push so the UI can show progress.
    ///
    /// When `cancel` is notified, git is asked to stop (SIGTERM on Unix, so it can remove its own
    /// lock files), given a few seconds, then killed. The result is an `ErrorKind::Cancelled` error.
    pub async fn run_streaming<I, S, F>(
        &self,
        cwd: &Path,
        args: I,
        timeout: Duration,
        cancel: Option<&Notify>,
        mut on_line: F,
    ) -> AppResult<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
        F: FnMut(String) + Send,
    {
        let mut cmd = self.command(cwd, false);
        cmd.args(args).stdin(Stdio::null());
        // Own process group, so cancelling also stops helpers git starts (ssh, credential helpers).
        #[cfg(unix)]
        cmd.process_group(0);
        let mut child = cmd.spawn().map_err(|e| spawn_error(&self.exe, e))?;
        let pid = child.id();
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::internal("Could not read git output."))?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("Could not read git output."))?;

        let work = async {
            let stdout_task = tokio::spawn(async move {
                let mut buf = Vec::new();
                let _ = stdout.read_to_end(&mut buf).await;
                buf
            });
            let mut all = Vec::new();
            let mut line = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = stderr.read(&mut chunk).await?;
                if n == 0 {
                    break;
                }
                for &b in &chunk[..n] {
                    all.push(b);
                    if b == b'\r' || b == b'\n' {
                        if !line.is_empty() {
                            on_line(crate::git::redact::redact_text(&String::from_utf8_lossy(
                                &line,
                            )));
                            line.clear();
                        }
                    } else {
                        line.push(b);
                    }
                }
            }
            if !line.is_empty() {
                on_line(crate::git::redact::redact_text(&String::from_utf8_lossy(
                    &line,
                )));
            }
            let status = child.wait().await?;
            let stdout = stdout_task.await.unwrap_or_default();
            Ok::<_, std::io::Error>((status, stdout, all))
        };
        tokio::pin!(work);

        let result = tokio::select! {
            r = tokio::time::timeout(timeout, &mut work) => match r {
                Ok(r) => r.map_err(AppError::from)?,
                Err(_) => {
                    return Err(AppError::new(
                        ErrorKind::Timeout,
                        "The network operation took too long and was stopped.",
                    ))
                }
            },
            _ = wait_for(cancel) => {
                terminate(pid, false);
                // Give git a moment to clean up its lock files, then make sure nothing is left.
                let _ = tokio::time::timeout(Duration::from_secs(5), &mut work).await;
                terminate(pid, true);
                return Err(AppError::new(ErrorKind::Cancelled, "Cancelled."));
            }
        };
        let (status, stdout, stderr_bytes) = result;
        let code = status.code().unwrap_or(-1);
        let output = Output {
            stdout,
            stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
            code,
        };
        if code == 0 {
            Ok(output)
        } else {
            Err(classify(&output.stderr))
        }
    }
}

/// Resolves when `cancel` is notified; never resolves when there is no cancel handle.
async fn wait_for(cancel: Option<&Notify>) {
    match cancel {
        Some(n) => n.notified().await,
        None => std::future::pending().await,
    }
}

/// Stops git and everything it started. `force` = SIGKILL, otherwise SIGTERM so git can remove its
/// lock files. On Windows there is no graceful signal for console-less processes, so the process
/// tree is ended with `taskkill /T` (git itself is also killed when its handle is dropped).
fn terminate(pid: Option<u32>, force: bool) {
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    {
        let sig = if force { libc::SIGKILL } else { libc::SIGTERM };
        // SAFETY: kill(2) on the process group we created for this child (negative pid = group).
        unsafe {
            libc::kill(-(pid as libc::pid_t), sig);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = force;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = (pid, force);
}

fn spawn_error(exe: &Path, e: std::io::Error) -> AppError {
    if e.kind() == std::io::ErrorKind::NotFound {
        AppError::new(
            ErrorKind::GitNotFound,
            "Git could not be started. Install Git or set its location in Settings → Git.",
        )
        .with_detail(format!("{}: {e}", exe.display()))
    } else {
        AppError::new(ErrorKind::Git, "Git could not be started.")
            .with_detail(format!("{}: {e}", exe.display()))
    }
}
