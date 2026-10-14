use crate::project::{read_project_file, validate_project_value, write_project_file};
use crate::storage::autosave_path;
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub fn open_project(path: String) -> Result<Value, String> {
    read_project_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn save_project(path: String, project: Value) -> Result<(), String> {
    write_project_file(&PathBuf::from(path), &project)
}

#[tauri::command]
pub fn validate_project(project: Value) -> Result<(), String> {
    validate_project_value(&project)
}

#[tauri::command]
pub fn autosave_project(app: AppHandle, project: Value) -> Result<String, String> {
    let path = autosave_path(&app)?;
    write_project_file(&path, &project)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn recover_autosave(app: AppHandle) -> Result<Option<Value>, String> {
    let path = autosave_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(read_project_file(&path)?))
}
