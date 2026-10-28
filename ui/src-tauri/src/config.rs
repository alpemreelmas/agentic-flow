//! User settings (config.json in the data dir) and the Linear key (OS keychain).
//! The webview can set or clear the key and ask whether it exists; it can never read it back.

use std::fs;

use serde::{Deserialize, Serialize};

use crate::service::data_dir;

const KEYCHAIN_SERVICE: &str = "dev.linearlooper.app";
const KEYCHAIN_USER: &str = "linear-api-key";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub project_id: String,
    pub project_name: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Config {
    pub workspaces: Vec<Workspace>,
    pub active_workspace: String, // id of the workspace the UI shows; "" = all
    #[serde(skip_serializing)]
    pub repo: String, // legacy single-repo field: read once, migrated into `workspaces`
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
            workspaces: vec![],
            active_workspace: String::new(),
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
        for (name, v) in [("label", &self.label), ("ready", &self.ready), ("progress", &self.progress),
            ("review", &self.review), ("blocked", &self.blocked), ("reviewers", &self.reviewers), ("triage", &self.triage)] {
            if v.starts_with('-') || v.contains('\n') {
                return Err(format!("{name}: invalid value"));
            }
        }
        self.validate_workspaces()?;
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

    fn validate_workspaces(&self) -> Result<(), String> {
        if self.workspaces.is_empty() {
            return Err("add at least one workspace (a local git checkout)".into());
        }
        let many = self.workspaces.len() > 1;
        for (i, w) in self.workspaces.iter().enumerate() {
            if w.name.trim().is_empty() || w.name.starts_with('-') || w.repo.starts_with('-') {
                return Err(format!("workspace {}: invalid name or path", i + 1));
            }
            if !std::path::Path::new(&w.repo).join(".git").exists() {
                return Err(format!("workspace {}: {} is not a git checkout", w.name, w.repo));
            }
            if many && w.project_id.is_empty() {
                return Err(format!("workspace {}: pick a Linear project (needed once there are several workspaces)", w.name));
            }
            for o in &self.workspaces[..i] {
                if o.name == w.name {
                    return Err(format!("workspace name {} is used twice", w.name));
                }
                if o.repo == w.repo {
                    return Err(format!("{} is already used by workspace {}", w.repo, o.name));
                }
                if !w.project_id.is_empty() && o.project_id == w.project_id {
                    return Err(format!("Linear project {} is mapped to both {} and {}", w.project_name, o.name, w.name));
                }
            }
        }
        Ok(())
    }

    /// What the service reads: it re-reads this file every poll, so edits apply without a restart.
    pub fn workspaces_json(&self) -> String {
        let list: Vec<serde_json::Value> = self.workspaces.iter()
            .map(|w| serde_json::json!({"name": w.name, "repo": w.repo, "project_id": w.project_id, "enabled": w.enabled}))
            .collect();
        serde_json::Value::Array(list).to_string()
    }

    pub fn args(&self) -> Vec<String> {
        let mut a: Vec<String> = ["--source", "linear", "--workspaces", &workspaces_path().to_string_lossy(), "--label", &self.label, "--linear-ready", &self.ready,
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

pub fn workspaces_path() -> std::path::PathBuf {
    data_dir().join("workspaces.json")
}

pub fn load() -> Config {
    let mut c: Config = fs::read_to_string(config_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    if c.workspaces.is_empty() && !c.repo.trim().is_empty() {
        // settings saved before workspaces existed: keep working as one catch-all workspace
        let name = std::path::Path::new(&c.repo).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Varsayılan".into());
        c.workspaces.push(Workspace { id: "ws-default".into(), name, repo: c.repo.clone(), enabled: true, ..Workspace::default() });
    }
    c
}

fn atomic_write(path: &std::path::Path, body: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn write(c: &Config) -> Result<(), String> {
    atomic_write(&workspaces_path(), &c.workspaces_json())?;
    atomic_write(&config_path(), &serde_json::to_string_pretty(c).map_err(|e| e.to_string())?)
}

fn save(c: &Config) -> Result<(), String> {
    c.validate()?;
    write(c)
}

/// Which workspace the UI shows. Not a setting the loop depends on, so no full validation.
#[tauri::command]
pub fn set_active_workspace(id: String) -> Result<(), String> {
    let mut c = load();
    c.active_workspace = id;
    write(&c)
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

    fn ws(dir: &std::path::Path, name: &str, project: &str) -> Workspace {
        fs::create_dir_all(dir.join(".git")).unwrap();
        Workspace { id: name.into(), name: name.into(), repo: dir.to_string_lossy().into(), project_id: project.into(),
            project_name: project.into(), enabled: true }
    }

    fn valid(dir: &std::path::Path) -> Config {
        Config { workspaces: vec![ws(dir, "main", "")], ..Config::default() }
    }

    #[test]
    fn defaults_with_a_git_repo_are_valid_and_become_argv() {
        let d = std::env::temp_dir().join("looper-cfg-ok");
        let c = valid(&d);
        assert!(c.validate().is_ok());
        let a = c.args();
        assert_eq!(&a[..3], ["--source", "linear", "--workspaces"]);
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
        c.workspaces[0].repo = "/definitely/not/here".into();
        assert!(c.validate().is_err());
        assert!(Config::default().validate().is_err()); // no workspace at all
        let mut c = valid(&d);
        c.blocked = c.ready.clone();
        assert!(c.validate().is_err());
        let mut c = valid(&d);
        c.interval = 1;
        assert!(c.validate().is_err());
    }

    #[test]
    fn several_workspaces_need_distinct_projects_names_and_repos() {
        let a = std::env::temp_dir().join("looper-ws-a");
        let b = std::env::temp_dir().join("looper-ws-b");
        let mut c = Config { workspaces: vec![ws(&a, "web", "p1"), ws(&b, "api", "p2")], ..Config::default() };
        assert!(c.validate().is_ok());
        c.workspaces[1].project_id = "p1".into();
        assert!(c.validate().unwrap_err().contains("mapped to both"));
        c.workspaces[1].project_id = String::new();
        assert!(c.validate().unwrap_err().contains("pick a Linear project"));
        c.workspaces[1] = ws(&a, "api", "p2");
        assert!(c.validate().unwrap_err().contains("already used"));
    }

    #[test]
    fn workspaces_json_is_what_the_service_reads() {
        let d = std::env::temp_dir().join("looper-ws-json");
        let c = Config { workspaces: vec![ws(&d, "web", "p1")], ..Config::default() };
        let v: serde_json::Value = serde_json::from_str(&c.workspaces_json()).unwrap();
        assert_eq!(v[0]["project_id"], "p1");
        assert_eq!(v[0]["enabled"], true);
    }
}
