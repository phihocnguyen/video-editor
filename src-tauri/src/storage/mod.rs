use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {e}"))
}

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

pub fn autosave_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("autosave");
    ensure_dir(&dir)?;
    Ok(dir.join("recovery.cutline.json"))
}

pub fn projects_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("projects");
    ensure_dir(&dir)?;
    Ok(dir)
}

pub fn project_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let id = sanitize_project_id(project_id)?;
    let dir = projects_root(app)?.join(&id);
    ensure_dir(&dir)?;
    Ok(dir)
}

pub fn project_file_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(app, project_id)?.join("project.cutline.json"))
}

pub fn project_media_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let dir = project_dir(app, project_id)?.join("media");
    ensure_dir(&dir)?;
    Ok(dir)
}

pub fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve app cache dir: {e}"))?
        .join("media");
    ensure_dir(&dir)?;
    Ok(dir)
}

pub fn sanitize_project_id(project_id: &str) -> Result<String, String> {
    let trimmed = project_id.trim();
    if trimmed.is_empty() {
        return Err("Project id is empty".into());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Invalid project id".into());
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err("Invalid project id".into());
    }
    Ok(trimmed.to_string())
}

pub fn safe_media_file_name(original: &str) -> String {
    let base = Path::new(original)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("media.bin");
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() || out == "." || out == ".." {
        "media.bin".into()
    } else {
        out
    }
}
