//! Backend of the run viewer. It only tails `runs/*.jsonl` (written by the Python loop)
//! and forwards new lines to the webview as `run-event`. The webview gets no file access.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

mod config;
mod service;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

const POLL_INTERVAL: Duration = Duration::from_millis(300);

#[derive(Default)]
struct Watcher(Mutex<Option<Arc<AtomicBool>>>); // stop flag of the running poller

#[derive(Clone, Serialize)]
struct RunEvent {
    run_id: String,
    event: Value,
}

/// Returns complete JSON lines appended since `*offset` and advances the offset.
/// A trailing partial line (writer mid-append) is left for the next poll.
fn read_new_events(path: &Path, offset: &mut u64) -> Vec<Value> {
    let Ok(mut file) = fs::File::open(path) else { return vec![] };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len < *offset {
        *offset = 0; // file was truncated/replaced
    }
    if len == *offset || file.seek(SeekFrom::Start(*offset)).is_err() {
        return vec![];
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return vec![];
    }
    let Some(end) = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1) else { return vec![] };
    *offset += end as u64;
    String::from_utf8_lossy(&buf[..end])
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

fn jsonl_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    files.retain(|p| p.extension().is_some_and(|x| x == "jsonl"));
    files.sort();
    files
}

/// Where the Python loop writes runs. `LOOPER_RUNS_DIR` overrides the dev default (<repo>/runs).
#[tauri::command]
fn default_runs_dir() -> String {
    service::runs_dir().to_string_lossy().into_owned()
}

/// Start (or restart) tailing `runs_dir`. Existing files are replayed from the start, so the
/// webview needs only this one stream for both history and live updates.
#[tauri::command]
fn start_watch(app: AppHandle, state: State<Watcher>, runs_dir: String) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(prev) = state.0.lock().unwrap().replace(stop.clone()) {
        prev.store(true, Ordering::Relaxed);
    }
    thread::spawn(move || {
        let dir = PathBuf::from(runs_dir);
        let mut offsets: HashMap<PathBuf, u64> = HashMap::new();
        while !stop.load(Ordering::Relaxed) {
            for path in jsonl_files(&dir) {
                let run_id = path.file_stem().unwrap().to_string_lossy().into_owned();
                for event in read_new_events(&path, offsets.entry(path.clone()).or_insert(0)) {
                    let _ = app.emit("run-event", RunEvent { run_id: run_id.clone(), event });
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

// ---- registry editor -------------------------------------------------------------------
// The webview never sees a path: it names an entry by (kind, name) and this side maps that to
// registry/roles/<name>.md or registry/skills/<name>/SKILL.md. Names are restricted so a name
// like "../../x" can't escape the registry directory.

#[derive(Serialize)]
struct Entry {
    kind: &'static str,
    name: String,
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn entry_path(dir: &str, kind: &str, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid name {name:?}: use letters, digits, '-' and '_'"));
    }
    let root = PathBuf::from(dir);
    match kind {
        "role" => Ok(root.join("roles").join(format!("{name}.md"))),
        "skill" => Ok(root.join("skills").join(name).join("SKILL.md")),
        _ => Err(format!("unknown kind {kind:?}")),
    }
}

/// Roles and skills are markdown with a `---` frontmatter block; refuse to save anything else,
/// because the Python loader would reject it at run time.
fn check_frontmatter(content: &str) -> Result<(), String> {
    match content.strip_prefix("---\n") {
        Some(rest) if rest.contains("\n---") => Ok(()),
        _ => Err("must start with a '---' frontmatter block that is closed by another '---'".into()),
    }
}

#[tauri::command]
fn default_registry_dir() -> String {
    service::registry_dir().to_string_lossy().into_owned()
}

#[tauri::command]
fn list_registry(dir: String) -> Vec<Entry> {
    let root = PathBuf::from(dir);
    let names = |sub: &str, keep: &dyn Fn(&Path) -> Option<String>| -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(root.join(sub))
            .map(|rd| rd.flatten().filter_map(|e| keep(&e.path())).collect())
            .unwrap_or_default();
        v.sort();
        v
    };
    let roles = names("roles", &|p| {
        (p.extension().is_some_and(|x| x == "md")).then(|| p.file_stem()?.to_str().map(String::from))?
    });
    let skills = names("skills", &|p| {
        p.join("SKILL.md").is_file().then(|| p.file_name()?.to_str().map(String::from))?
    });
    roles
        .into_iter()
        .map(|name| Entry { kind: "role", name })
        .chain(skills.into_iter().map(|name| Entry { kind: "skill", name }))
        .collect()
}

#[tauri::command]
fn read_entry(dir: String, kind: String, name: String) -> Result<String, String> {
    fs::read_to_string(entry_path(&dir, &kind, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_entry(dir: String, kind: String, name: String, content: String) -> Result<(), String> {
    check_frontmatter(&content)?;
    let path = entry_path(&dir, &kind, &name)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("md.tmp"); // write + rename: a crash never leaves a half-written role
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn service_status() -> service::ServiceStatus {
    service::status(&service::state_dir())
}

// Commands that spawn processes or wait on the network are async + spawn_blocking: sync commands
// would run on the main thread and freeze the window.
#[tauri::command]
async fn start_service() -> Result<service::ServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(|| service::start(&service::state_dir())).await.map_err(|e| e.to_string())?
}

/// Opens an https link in the system browser. Only https, so a crafted value can't launch anything else.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(char::is_whitespace) {
        return Err("only https links can be opened".into());
    }
    let (prog, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![&url])
    } else if cfg!(windows) {
        ("rundll32", vec!["url.dll,FileProtocolHandler", &url])
    } else {
        ("xdg-open", vec![&url])
    };
    std::process::Command::new(prog).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_queue() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(service::list_queue).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_connection() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(service::check).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop_service() -> Result<(), String> {
    service::stop(&service::state_dir())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Watcher::default())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(res) = app.path().resource_dir() {
                if let Err(e) = service::seed_registry(&res.join("registry")) {
                    eprintln!("could not seed registry: {e}");
                }
            }
            // Docker-style: opening the app brings the loop up if it is down. Quitting never stops it.
            if let Err(e) = service::start(&service::state_dir()) {
                eprintln!("service autostart failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_runs_dir,
            start_watch,
            default_registry_dir,
            list_registry,
            read_entry,
            write_entry,
            service_status,
            start_service,
            stop_service,
            check_connection,
            list_queue,
            open_url,
            config::get_config,
            config::set_config,
            config::key_status,
            config::set_linear_key,
            config::clear_linear_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn entry_names_cannot_escape_the_registry() {
        assert!(entry_path("/r", "role", "../etc/passwd").is_err());
        assert!(entry_path("/r", "skill", "a/b").is_err());
        assert!(entry_path("/r", "role", "").is_err());
        assert!(entry_path("/r", "tool", "x").is_err());
        assert_eq!(entry_path("/r", "role", "reviewer").unwrap(), PathBuf::from("/r/roles/reviewer.md"));
        assert_eq!(entry_path("/r", "skill", "s_1").unwrap(), PathBuf::from("/r/skills/s_1/SKILL.md"));
    }

    #[test]
    fn rejects_content_without_frontmatter() {
        assert!(check_frontmatter("just text").is_err());
        assert!(check_frontmatter("---\nname: x\n").is_err()); // never closed
        assert!(check_frontmatter("---\nname: x\n---\nbody").is_ok());
    }

    #[test]
    fn write_read_list_roundtrip() {
        let dir = std::env::temp_dir().join(format!("looper-reg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let d = dir.to_string_lossy().into_owned();
        let doc = "---\nname: r\n---\nhello".to_string();

        write_entry(d.clone(), "role".into(), "r".into(), doc.clone()).unwrap();
        write_entry(d.clone(), "skill".into(), "s".into(), doc.clone()).unwrap();
        assert_eq!(read_entry(d.clone(), "role".into(), "r".into()).unwrap(), doc);
        assert!(write_entry(d.clone(), "role".into(), "bad".into(), "no frontmatter".into()).is_err());

        let listed: Vec<(String, String)> =
            list_registry(d).into_iter().map(|e| (e.kind.to_string(), e.name)).collect();
        assert_eq!(listed, vec![("role".into(), "r".into()), ("skill".into(), "s".into())]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_only_complete_new_lines() {
        let path = std::env::temp_dir().join(format!("looper-test-{}.jsonl", std::process::id()));
        let _ = fs::remove_file(&path);
        let mut offset = 0;

        let mut f = fs::OpenOptions::new().create(true).append(true).open(&path).unwrap();
        write!(f, "{{\"type\":\"a\"}}\n{{\"type\":\"b\"").unwrap(); // second line incomplete
        let first = read_new_events(&path, &mut offset);
        assert_eq!(first.len(), 1);

        writeln!(f, "}}").unwrap(); // complete it
        let second = read_new_events(&path, &mut offset);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0]["type"], "b");
        assert!(read_new_events(&path, &mut offset).is_empty());
        let _ = fs::remove_file(&path);
    }
}
