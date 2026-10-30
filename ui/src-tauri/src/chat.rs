//! Brainstorming chats: each one is a `looper-service --chat` child process holding one ACP agent
//! session (see looper/chat.py). The webview sends text and receives events; it never gets a
//! process handle or a path of its own choosing.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Stdio},
    sync::Mutex,
    thread,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

const MAX_CHATS: usize = 4;
const AGENTS: [&str; 3] = ["claude", "gemini", "codex"];

struct Session {
    child: Child,
    stdin: ChildStdin,
    bridge: Option<crate::bridge::Bridge>,
}

#[derive(Default)]
pub struct Chats(Mutex<HashMap<String, Session>>);

impl Chats {
    pub fn idle_guard(&self) -> Result<impl Drop + '_, String> {
        let guard = self.0.lock().unwrap();
        if !guard.is_empty() { return Err("Önce açık sohbetleri kapatın.".into()); }
        Ok(guard)
    }
}

#[derive(Clone, Serialize)]
struct ChatEvent {
    chat_id: String,
    event: Value,
}

pub(crate) fn emit(app: &AppHandle, chat_id: &str, event: Value) {
    let _ = app.emit("chat-event", ChatEvent { chat_id: chat_id.into(), event });
}

fn new_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("chat-{t:x}")
}

/// Only a configured workspace's folder can be browsed: the page can't point the agent elsewhere.
pub(crate) fn allowed_repo(repo: &str) -> bool {
    let norm = |p: &str| std::fs::canonicalize(p).unwrap_or_else(|_| std::path::PathBuf::from(p.trim_end_matches('/')));
    let want = norm(repo);
    crate::config::load().workspaces.iter().any(|w| norm(&w.repo) == want)
}

#[tauri::command]
pub async fn chat_start(app: AppHandle, repo: String, agent: String) -> Result<String, String> {
    if !AGENTS.contains(&agent.as_str()) {
        return Err("agent: claude, gemini or codex".into());
    }
    if !allowed_repo(&repo) {
        return Err("Bu klasör kayıtlı bir workspace değil. Ayarlar > Workspace'ler bölümünde ekleyip üstteki Kaydet'e basın.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let chats = app.state::<Chats>();
        if chats.0.lock().unwrap().len() >= MAX_CHATS {
            return Err(format!("at most {MAX_CHATS} chats at once; close one first"));
        }
        let id = new_id();
        let config = crate::config::load();
        let norm = |p: &str| std::fs::canonicalize(p).unwrap_or_else(|_| std::path::PathBuf::from(p));
        let workspace = config.workspaces.iter().find(|w| norm(&w.repo) == norm(&repo));
        let bridge = match workspace {
            _ if agent == "gemini" => {
                emit(&app, &id, json!({"type": "bridge_status", "available": false,
                    "message": "Gemini adaptöründe Linear araçları kapalı; Claude veya Codex ile sohbet açın. Repo sohbeti kullanılabilir."}));
                None
            }
            Some(w) if w.enabled && !w.project_id.is_empty() && crate::config::linear_key().is_some() => {
                match crate::bridge::Bridge::start(app.clone(), id.clone(), w, &config) {
                    Ok(bridge) => Some(bridge),
                    Err(message) => { emit(&app, &id, json!({"type": "bridge_status", "available": false, "message": message})); None }
                }
            }
            _ => {
                emit(&app, &id, json!({"type": "bridge_status", "available": false,
                    "message": "Linear araçları için Ayarlar'dan anahtar ekleyin, workspace'i etkinleştirip Linear projesini seçin; ardından sohbeti yeniden açın."}));
                None
            }
        };
        let mut cmd = crate::service::base_command();
        for key in ["LINEAR_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "LOOPER_BRIDGE_DESCRIPTOR"] {
            cmd.env_remove(key);
        }
        if let Some(b) = &bridge { cmd.env("LOOPER_BRIDGE_DESCRIPTOR", b.descriptor.to_string()); }
        cmd.args(["--chat", "--agent", &agent, "--repo", &repo]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.arg("--registry").arg(crate::service::registry_dir());
        if let Some(w) = workspace {
            for skill in &w.skills { cmd.arg("--skill").arg(skill); }
        }
        let mut child = cmd.spawn().map_err(|e| format!("could not start the chat: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        chats.0.lock().unwrap().insert(id.clone(), Session { child, stdin, bridge });

        let err_tail = std::sync::Arc::new(Mutex::new(String::new()));
        let tail = err_tail.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut t = tail.lock().unwrap();
                t.push_str(&line);
                t.push('\n');
                let mut cut = t.len().saturating_sub(2000);
                while !t.is_char_boundary(cut) { cut += 1; }
                *t = t[cut..].to_string();
            }
        });
        let (app2, id2) = (app.clone(), id.clone());
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(ev) = serde_json::from_str::<Value>(&line) {
                    emit(&app2, &id2, ev);
                }
            }
            // The process ended (stopped, crashed, or the agent could not start): say why.
            app2.state::<Chats>().0.lock().unwrap().remove(&id2);
            let tail = err_tail.lock().unwrap().trim().to_string();
            emit(&app2, &id2, json!({"type": "closed", "stderr": tail}));
        });
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn send(app: &AppHandle, id: &str, msg: Value) -> Result<(), String> {
    let chats = app.state::<Chats>();
    let mut map = chats.0.lock().unwrap();
    let s = map.get_mut(id).ok_or("this chat has ended")?;
    writeln!(s.stdin, "{msg}").and_then(|_| s.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_send(app: AppHandle, chat_id: String, text: String, files: Vec<String>, skills: Vec<String>) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 100_000 {
        return Err("empty or too long".into());
    }
    if files.len() > 20 || files.iter().any(|f| f.starts_with('/') || f.split('/').any(|p| p == "..")) {
        return Err("invalid file mention".into());
    }
    if skills.len() > 32 || skills.iter().any(|s| s.len() > 256) { return Err("invalid skills".into()); }
    send(&app, &chat_id, json!({"type": "prompt", "text": text, "files": files, "skills": skills}))
}

#[tauri::command]
pub fn chat_set_mode(app: AppHandle, chat_id: String, id: String) -> Result<(), String> {
    send(&app, &chat_id, json!({"type": "set_mode", "id": id}))
}

/// `value` is a string (select option) or a bool (toggle), exactly what the agent offered.
#[tauri::command]
pub fn chat_set_config(app: AppHandle, chat_id: String, id: String, value: Value) -> Result<(), String> {
    if !value.is_string() && !value.is_boolean() {
        return Err("value must be a string or a boolean".into());
    }
    send(&app, &chat_id, json!({"type": "set_config", "id": id, "value": value}))
}

/// Tracked and untracked-but-not-ignored files of a workspace, for @-completion.
#[tauri::command]
pub async fn list_files(repo: String) -> Result<Vec<String>, String> {
    if !allowed_repo(&repo) {
        return Err("not a workspace folder".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = std::process::Command::new("git")
            .args(["ls-files", "--cached", "--others", "--exclude-standard"])
            .current_dir(&repo)
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).lines().take(30_000).map(String::from).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn chat_cancel(app: AppHandle, chat_id: String) -> Result<(), String> {
    send(&app, &chat_id, json!({"type": "cancel"}))
}

#[tauri::command]
pub fn chat_stop(app: AppHandle, chat_id: String) {
    if let Some(s) = app.state::<Chats>().0.lock().unwrap().remove(&chat_id) {
        drop(s.stdin); // EOF lets the agent exit cleanly; kill is the backstop
        drop(s.bridge);
        thread::spawn(move || {
            let mut child = s.child;
            for _ in 0..50 {
                if child.try_wait().ok().flatten().is_some() { return; }
                thread::sleep(std::time::Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    }
}

pub(crate) fn refresh_bridge_keys(app: &AppHandle) {
    let key = crate::config::linear_key();
    for session in app.state::<Chats>().0.lock().unwrap().values_mut() {
        if let Some(bridge) = &mut session.bridge { bridge.set_key(&key); }
    }
}
