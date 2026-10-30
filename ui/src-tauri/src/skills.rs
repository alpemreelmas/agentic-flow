//! Discovery stays in Python so UI previews and execution always resolve the same skill IDs.
use tauri::async_runtime::spawn_blocking;

async fn query(repo: Option<String>, id: Option<String>) -> Result<serde_json::Value, String> {
    if let Some(ref repo) = repo {
        if !crate::chat::allowed_repo(repo) { return Err("Select a saved workspace first".into()); }
    }
    spawn_blocking(move || {
        let mut cmd = crate::service::base_command();
        cmd.arg("--registry").arg(crate::service::registry_dir());
        match repo { Some(repo) => { cmd.arg("--repo").arg(repo); }, None => { cmd.arg("--global-skills"); } }
        match id { Some(id) => { cmd.arg("--read-skill").arg(id); }, None => { cmd.arg("--list-skills"); } }
        let out = cmd.output().map_err(|e| e.to_string())?;
        if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().to_string()); }
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_skills(repo: Option<String>) -> Result<serde_json::Value, String> { query(repo, None).await }
#[tauri::command]
pub async fn read_skill(repo: Option<String>, id: String) -> Result<serde_json::Value, String> { query(repo, Some(id)).await }
