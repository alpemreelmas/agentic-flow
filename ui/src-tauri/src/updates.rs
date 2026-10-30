//! Keep verified downloads in memory; installation requires the loop and chats to be closed.
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates(Mutex<Option<(Update, Vec<u8>)>>);

#[tauri::command]
pub async fn check_update(app: AppHandle, state: State<'_, Updates>) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Err("Otomatik güncelleme için AppImage sürümünü kullanın.".into());
    }
    if let Some((update, _)) = state.0.lock().unwrap().as_ref() {
        return Ok(Some(update.version.clone()));
    }
    let updater = app.updater_builder().timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(None) };
    let mut received = 0u64;
    let bytes = update.download(|chunk, total| {
        received += chunk as u64;
        let _ = app.emit("update-progress", serde_json::json!({"received": received, "total": total}));
    }, || {}).await.map_err(|e| e.to_string())?;
    let version = update.version.clone();
    *state.0.lock().unwrap() = Some((update, bytes));
    Ok(Some(version))
}

#[tauri::command]
pub fn install_update(app: AppHandle, state: State<'_, Updates>, chats: State<'_, crate::chat::Chats>) -> Result<(), String> {
    // Never signal a live daemon: it may pick up a task between heartbeat and shutdown.
    if crate::service::status(&crate::service::state_dir()).running {
        return Err("Önce döngüyü durdurun ve kapanmasını bekleyin.".into());
    }
    // The daemon owns this flock throughout its lifetime, even if its heartbeat is stale.
    // Hold it through installation so another process cannot claim a task meanwhile.
    let dir = crate::service::state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = std::fs::OpenOptions::new().create(true).append(true)
        .open(dir.join("service.lock")).map_err(|e| e.to_string())?;
    lock.try_lock().map_err(|_| "Döngü henüz kapanmadı; biraz sonra tekrar deneyin.".to_string())?;
    let _chats_guard = chats.idle_guard()?;
    let pending = state.0.lock().unwrap();
    let (update, bytes) = pending.as_ref().ok_or("İndirilmiş güncelleme yok.")?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
