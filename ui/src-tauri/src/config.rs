//! User settings (config.json in the data dir) and the Linear key (OS keychain).
//! The webview can set or clear the key and ask whether it exists; it can never read it back.

use std::fs;

use serde::{Deserialize, Serialize};

use crate::service::data_dir;

const KEYCHAIN_SERVICE: &str = "dev.linearlooper.app";
const KEYCHAIN_USER: &str = "linear-api-key";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    pub repo: String,
    pub label: String,
    pub ready: String,
    pub progress: String,
    pub review: String,
    pub blocked: String,
    pub deliver: String, // "github" | "none"
    pub reviewers: String,
    pub triage: String,
    pub agent: String, // "" = each role's own cli
    pub max_attempts: u32,
    pub timeout: u32,
    pub interval: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            repo: String::new(),
            label: "agent".into(),
            ready: "Todo".into(),
            progress: "In Progress".into(),
            review: "In Review".into(),
            blocked: "Backlog".into(),
            deliver: "github".into(),
            reviewers: "tech-reviewer,product-reviewer".into(),
            triage: "product-manager".into(),
            agent: String::new(),
            max_attempts: 3,
            timeout: 1800,
            interval: 300,
        }
    }
}

impl Config {
    /// Rejects what the loop would choke on or what could be mistaken for a flag. Values reach the
    /// service as separate argv entries (no shell), so this is about correctness, not quoting.
    pub fn validate(&self) -> Result<(), String> {
        for (name, v) in [("repo", &self.repo), ("label", &self.label), ("ready", &self.ready), ("progress", &self.progress),
            ("review", &self.review), ("blocked", &self.blocked), ("reviewers", &self.reviewers), ("triage", &self.triage)] {
            if v.starts_with('-') || v.contains('\n') {
                return Err(format!("{name}: invalid value"));
            }
        }
        if self.repo.trim().is_empty() {
            return Err("repo: a local git checkout is required".into());
        }
        if !std::path::Path::new(&self.repo).join(".git").exists() {
            return Err(format!("repo: {} is not a git checkout", self.repo));
        }
        if !["github", "none"].contains(&self.deliver.as_str()) {
            return Err("deliver: github or none".into());
        }
        if !["", "claude", "gemini", "codex"].contains(&self.agent.as_str()) {
            return Err("agent: claude, gemini, codex or empty".into());
        }
        if self.ready == self.blocked || self.ready == self.progress || self.ready == self.review {
            return Err("states: the ready state must differ from the others, or the loop would re-poll its own output".into());
        }
        if !(1..=10).contains(&self.max_attempts) || !(60..=14400).contains(&self.timeout) || !(10..=86400).contains(&self.interval) {
            return Err("max_attempts 1-10, timeout 60-14400 s, interval 10-86400 s".into());
        }
        Ok(())
    }

    pub fn args(&self) -> Vec<String> {
        let mut a: Vec<String> = ["--source", "linear", "--repo", &self.repo, "--label", &self.label, "--linear-ready", &self.ready,
            "--linear-progress", &self.progress, "--linear-review", &self.review, "--linear-blocked", &self.blocked,
            "--deliver", &self.deliver, "--reviewers", &self.reviewers, "--triage", &self.triage]
            .iter().map(|s| s.to_string()).collect();
        if !self.agent.is_empty() {
            a.extend(["--agent".into(), self.agent.clone()]);
        }
        a.extend(["--max-attempts".into(), self.max_attempts.to_string(), "--timeout".into(), self.timeout.to_string(),
            "--interval".into(), self.interval.to_string()]);
        a
    }
}

fn config_path() -> std::path::PathBuf {
    data_dir().join("config.json")
}

pub fn load() -> Config {
    fs::read_to_string(config_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(c: &Config) -> Result<(), String> {
    c.validate()?;
    fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let tmp = config_path().with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, config_path()).map_err(|e| e.to_string())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

/// For the service process only.
pub fn linear_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

#[tauri::command]
pub fn get_config() -> Config {
    load()
}

#[tauri::command]
pub fn set_config(config: Config) -> Result<(), String> {
    save(&config)
}

#[tauri::command]
pub fn key_status() -> bool {
    linear_key().is_some()
}

#[tauri::command]
pub fn set_linear_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return Err("that does not look like an API key".into());
    }
    entry()?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_linear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid(dir: &std::path::Path) -> Config {
        fs::create_dir_all(dir.join(".git")).unwrap();
        Config { repo: dir.to_string_lossy().into(), ..Config::default() }
    }

    #[test]
    fn defaults_with_a_git_repo_are_valid_and_become_argv() {
        let d = std::env::temp_dir().join("looper-cfg-ok");
        let c = valid(&d);
        assert!(c.validate().is_ok());
        let a = c.args();
        assert_eq!(&a[..4], ["--source", "linear", "--repo", &c.repo]);
        assert!(a.windows(2).any(|w| w == ["--linear-blocked", "Backlog"]));
        assert!(!a.contains(&"--agent".to_string()));
    }

    #[test]
    fn rejects_flag_lookalikes_non_repos_and_state_collisions() {
        let d = std::env::temp_dir().join("looper-cfg-bad");
        let mut c = valid(&d);
        c.label = "--once".into();
        assert!(c.validate().is_err());
        let mut c = valid(&d);
        c.repo = "/definitely/not/here".into();
        assert!(c.validate().is_err());
        let mut c = valid(&d);
        c.blocked = c.ready.clone();
        assert!(c.validate().is_err());
        let mut c = valid(&d);
        c.interval = 1;
        assert!(c.validate().is_err());
    }
}
