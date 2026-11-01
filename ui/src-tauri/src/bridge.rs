//! A trusted sidecar holds the Linear key; agents receive only a session capability.
use std::{io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Stdio}, sync::mpsc, thread, time::Duration};
use serde_json::{json, Value};
use tauri::AppHandle;

pub struct Bridge {
    child: Child,
    input: ChildStdin,
    pub descriptor: Value,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Bridge failures used to vanish into /dev/null; keep them next to the service log.
fn bridge_log() -> Stdio {
    let dir = crate::service::state_dir();
    let _ = std::fs::create_dir_all(&dir);
    std::fs::OpenOptions::new().create(true).append(true).open(dir.join("bridge.log")).map(Stdio::from).unwrap_or_else(|_| Stdio::null())
}

impl Bridge {
    pub fn start(app: AppHandle, chat_id: String, workspace: &crate::config::Workspace,
                 config: &crate::config::Config) -> Result<Self, String> {
        let mut cmd = crate::service::base_command();
        cmd.arg("--bridge-broker").env_remove("LINEAR_API_KEY")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(bridge_log());
        let mut child = cmd.spawn().map_err(|_| "Linear araç köprüsü başlatılamadı")?;
        let input = child.stdin.take().ok_or("bridge stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
        let mut bridge = Self { child, input, descriptor: Value::Null };
        let mut scope = serde_json::to_value(workspace).map_err(|e| e.to_string())?;
        for (key, value) in [("ready", &config.ready), ("progress", &config.progress),
                              ("blocked", &config.blocked), ("label", &config.label)] {
            scope[key] = json!(value);
        }
        writeln!(bridge.input, "{}", json!({"key": crate::config::linear_key(), "scope": scope,
            "state_dir": crate::service::state_dir(),
            "config_path": crate::service::data_dir().join("config.json")}))
            .and_then(|_| bridge.input.flush()).map_err(|_| "bridge initialization failed")?;
        let (tx, rx) = mpsc::sync_channel(1);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(event) = serde_json::from_str::<Value>(&line) {
                    if event["type"] == "bridge_ready" {
                        let _ = tx.try_send(event);
                    } else {
                        crate::chat::emit(&app, &chat_id, event);
                    }
                }
            }
        });
        bridge.descriptor = rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "Linear araç köprüsü zamanında yanıt vermedi")?;
        Ok(bridge)
    }

    pub fn set_key(&mut self, key: &Option<String>) {
        // If this channel breaks, retire the broker instead of leaving stale credentials usable.
        if writeln!(self.input, "{}", json!({"type": "key", "key": key}))
            .and_then(|_| self.input.flush()).is_err() {
            let _ = self.child.kill();
        }
    }
}
