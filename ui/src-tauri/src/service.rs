//! Lifecycle of the background loop. The loop is its own detached process that outlives this
//! window (like a docker daemon): the app only starts it when it is down, reports its
//! `status.json` heartbeat, and stops it on request. Closing the app never touches it.

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

/// A heartbeat older than this means the process is gone (keep in sync with looper/service.py).
const STALE_AFTER: f64 = 20.0;
const SIDECAR: &str = "looper-service";

#[derive(Serialize, Debug, PartialEq)]
pub struct ServiceStatus {
    pub running: bool,
    pub phase: String,
    pub detail: String,
    pub pid: u32,
    pub started_at: f64,
}

impl ServiceStatus {
    fn down() -> Self {
        Self { running: false, phase: "stopped".into(), detail: String::new(), pid: 0, started_at: 0.0 }
    }
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// Pure: interpret a status.json body at time `now`.
pub fn parse_status(body: &str, now: f64) -> ServiceStatus {
    let Ok(v) = serde_json::from_str::<Value>(body) else { return ServiceStatus::down() };
    let phase = v["phase"].as_str().unwrap_or("stopped").to_string();
    let fresh = now - v["heartbeat"].as_f64().unwrap_or(0.0) < STALE_AFTER;
    ServiceStatus {
        running: fresh && phase != "stopped",
        phase: if fresh { phase } else { "stopped".into() },
        detail: v["detail"].as_str().unwrap_or("").to_string(),
        pid: v["pid"].as_u64().unwrap_or(0) as u32,
        started_at: v["started_at"].as_f64().unwrap_or(0.0),
    }
}

pub fn status(state_dir: &Path) -> ServiceStatus {
    fs::read_to_string(state_dir.join("status.json"))
        .map(|b| parse_status(&b, now()))
        .unwrap_or_else(|_| ServiceStatus::down())
}

/// Where runs, registry, db and state live. In a dev checkout (the repo's registry/ exists next to
/// the sources) that is the repo itself; an installed app uses its per-user data dir.
pub fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("LOOPER_DATA_DIR") {
        return PathBuf::from(d);
    }
    let repo = repo_root();
    if repo.join("registry").is_dir() {
        return repo;
    }
    let base = if cfg!(windows) {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or_default()
    } else if cfg!(target_os = "macos") {
        PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Application Support")
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share"))
    };
    base.join("dev.linearlooper.app")
}

pub fn state_dir() -> PathBuf {
    std::env::var("LOOPER_STATE_DIR").map(PathBuf::from).unwrap_or_else(|_| data_dir().join(".looper"))
}

pub fn runs_dir() -> PathBuf {
    std::env::var("LOOPER_RUNS_DIR").map(PathBuf::from).unwrap_or_else(|_| data_dir().join("runs"))
}

pub fn registry_dir() -> PathBuf {
    std::env::var("LOOPER_REGISTRY_DIR").map(PathBuf::from).unwrap_or_else(|_| data_dir().join("registry"))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// First launch of an installed app: copy the bundled default roles/skills into the data dir.
pub fn seed_registry(bundled: &Path) -> std::io::Result<()> {
    let dest = registry_dir();
    if dest.exists() || !bundled.is_dir() {
        return Ok(());
    }
    copy_dir(bundled, &dest)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

/// A GUI-launched app gets a minimal PATH (no Homebrew, nvm, ~/.local/bin), so `gh`, `node` and the
/// agent CLIs would not be found. Ask the user's login shell for the PATH it would give a terminal.
pub fn user_path() -> Option<String> {
    static CACHE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(user_path_uncached).clone()
}

fn user_path_uncached() -> Option<String> {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(shell).args(["-ilc", "printf '__P__%s__P__' \"$PATH\""]).stdin(Stdio::null()).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let start = text.find("__P__")? + 5;
        let end = text[start..].find("__P__")? + start;
        return Some(text[start..end].to_string());
    }
    #[allow(unreachable_code)]
    None
}

/// The bundled sidecar next to the app binary when installed; otherwise the dev checkout via uv.
/// No arguments yet, but PATH is set so the agent CLIs and `gh` are found.
pub fn base_command() -> Command {
    let sidecar = std::env::current_exe().ok().and_then(|e| {
        let name = if cfg!(windows) { format!("{SIDECAR}.exe") } else { SIDECAR.to_string() };
        let p = e.parent()?.join(name);
        p.is_file().then_some(p)
    });
    let mut cmd = match sidecar {
        Some(p) => Command::new(p),
        None => {
            let mut c = Command::new("uv");
            c.args(["run", "python", "-m", "looper.main"]);
            c.current_dir(repo_root());
            c
        }
    };
    if let Some(p) = user_path() {
        cmd.env("PATH", p);
    }
    cmd
}

fn service_command() -> Command {
    let mut cmd = base_command();
    // LOOPER_ARGS (dev/testing) replaces the saved settings wholesale.
    match std::env::var("LOOPER_ARGS") {
        Ok(a) => cmd.args(a.split_whitespace()),
        Err(_) => cmd.args(crate::config::load().args()),
    };
    let data = data_dir();
    cmd.arg("--runs").arg(runs_dir()).arg("--registry").arg(registry_dir()).arg("--db").arg(data.join("looper.db"));
    if let Some(key) = crate::config::linear_key() {
        cmd.env("LINEAR_API_KEY", key);
    }
    cmd
}

/// Linear projects for the workspace picker (JSON), via the same binary and key.
pub fn list_projects() -> Result<String, String> {
    run_json("--list-projects")
}

/// Read-only snapshot of the labelled Linear issues (JSON), via the same binary, settings and key.
pub fn list_queue() -> Result<String, String> {
    run_json("--list-queue")
}

fn run_json(flag: &str) -> Result<String, String> {
    let mut cmd = service_command();
    cmd.arg(flag);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("queue check failed").to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Runs the loop's read-only Linear check with the saved settings and key; returns its output.
pub fn check() -> Result<String, String> {
    let mut cmd = service_command();
    cmd.arg("--check").arg("--state").arg(state_dir().join("check"));
    let out = cmd.output().map_err(|e| e.to_string())?;
    Ok(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

/// Starts the loop unless it is already up. Safe to call on every app launch: the Python side
/// holds a lock, so a lost race ends in a second process that exits at once.
pub fn start(state_dir: &Path) -> Result<ServiceStatus, String> {
    if status(state_dir).running {
        return Ok(status(state_dir));
    }
    if std::env::var("LOOPER_ARGS").is_err() {
        crate::config::load().validate().map_err(|e| format!("Ayarlar eksik: {e}"))?;
    }
    fs::create_dir_all(state_dir).map_err(|e| e.to_string())?;
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state_dir.join("service.log"))
        .map_err(|e| e.to_string())?;
    let mut cmd = service_command();
    cmd.arg("--state").arg(state_dir).stdin(Stdio::null()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
    detach(&mut cmd);
    cmd.spawn().map_err(|e| format!("could not start the service: {e}"))?;
    Ok(ServiceStatus { running: false, phase: "starting".into(), ..ServiceStatus::down() })
}

#[cfg(unix)]
fn detach(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0); // own group: a closed terminal or window never signals the loop
}

#[cfg(windows)]
fn detach(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0000_0008 | 0x0000_0200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
}

pub fn stop(state_dir: &Path) -> Result<(), String> {
    let s = status(state_dir);
    if !s.running {
        return Ok(());
    }
    let pid = s.pid.to_string();
    let out = if cfg!(windows) {
        Command::new("taskkill").args(["/PID", &pid, "/T"]).output()
    } else {
        Command::new("kill").args(["-TERM", &pid]).output()
    };
    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_heartbeat_is_running() {
        let s = parse_status(r#"{"pid":7,"started_at":1,"heartbeat":100,"phase":"idle","detail":"x"}"#, 105.0);
        assert!(s.running && s.pid == 7 && s.phase == "idle");
    }

    #[test]
    fn old_heartbeat_means_the_process_is_gone() {
        let s = parse_status(r#"{"pid":7,"heartbeat":100,"phase":"running"}"#, 100.0 + STALE_AFTER + 1.0);
        assert!(!s.running && s.phase == "stopped");
    }

    #[test]
    fn clean_stop_and_garbage_are_not_running() {
        assert!(!parse_status(r#"{"heartbeat":100,"phase":"stopped"}"#, 100.0).running);
        assert!(!parse_status("not json", 0.0).running);
    }
}

#[cfg(all(test, unix))]
mod path_tests {
    #[test]
    fn login_shell_path_is_found() {
        let p = super::user_path().expect("login shell should report a PATH");
        assert!(p.contains("/usr/bin"), "{p}");
    }
}
