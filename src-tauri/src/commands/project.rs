use crate::media::probe::probe_path;
use crate::project::{read_project_file, validate_project_value, write_project_file};
use crate::storage::{
    autosave_path, project_file_path, project_media_dir, projects_root, safe_media_file_name,
    sanitize_project_id,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMeta {
    id: Option<String>,
    name: Option<String>,
    updated_at: Option<String>,
}

fn project_id_from_value(project: &Value) -> Result<String, String> {
    project
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "Project is missing id".into())
}

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

/// Create or update the AppData draft for this project id.
#[tauri::command]
pub fn save_library_project(app: AppHandle, project: Value) -> Result<String, String> {
    validate_project_value(&project)?;
    let id = project_id_from_value(&project)?;
    let path = project_file_path(&app, &id)?;
    write_project_file(&path, &project)?;
    // Keep a crash recovery copy in sync with the latest draft.
    let recovery = autosave_path(&app)?;
    let _ = write_project_file(&recovery, &project);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_library_projects(app: AppHandle) -> Result<Vec<LibraryProjectInfo>, String> {
    let root = projects_root(&app)?;
    let mut entries = Vec::new();

    let read_dir = match fs::read_dir(&root) {
        Ok(rd) => rd,
        Err(_) => return Ok(entries),
    };

    for entry in read_dir.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let file = dir.join("project.klipcut.json");
        if !file.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<ProjectMeta>(&text) else {
            continue;
        };
        let folder_id = entry.file_name().to_string_lossy().to_string();
        let id = meta.id.filter(|s| !s.is_empty()).unwrap_or(folder_id);
        let name = meta
            .name
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Untitled project".into());
        let updated_at = meta.updated_at.unwrap_or_default();
        entries.push(LibraryProjectInfo {
            id,
            name,
            path: file.to_string_lossy().to_string(),
            updated_at,
        });
    }

    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(entries)
}

/// Copy selected media files into `projects/<id>/media/` and probe the copies.
#[tauri::command]
pub fn import_media_into_project(
    app: AppHandle,
    project_id: String,
    paths: Vec<String>,
) -> Result<Vec<crate::media::probe::ProbeResult>, String> {
    let media_dir = project_media_dir(&app, &project_id)?;
    let mut results = Vec::with_capacity(paths.len());

    for src in paths {
        let source = PathBuf::from(&src);
        if !source.is_file() {
            results.push(probe_path(&src)?);
            continue;
        }

        let original_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("media.bin");
        let safe = safe_media_file_name(original_name);
        let mut hasher = DefaultHasher::new();
        src.hash(&mut hasher);
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
            .hash(&mut hasher);
        let dest_name = format!("{:x}_{}", hasher.finish(), safe);
        let dest = media_dir.join(dest_name);

        fs::copy(&source, &dest).map_err(|e| {
            format!(
                "Failed to copy media into project library ({}): {e}",
                source.display()
            )
        })?;

        let dest_str = dest.to_string_lossy().to_string();
        results.push(probe_path(&dest_str)?);
    }

    Ok(results)
}

/// True when `path` is under the AppData projects library.
#[tauri::command]
pub fn is_library_project_path(app: AppHandle, path: String) -> Result<bool, String> {
    let root = projects_root(&app)?;
    let candidate = PathBuf::from(path);
    let root_canon = fs::canonicalize(&root).unwrap_or(root);
    let cand_canon = fs::canonicalize(&candidate).unwrap_or(candidate);
    Ok(cand_canon.starts_with(&root_canon))
}

/// Permanently delete an AppData library project folder (JSON + copied media).
#[tauri::command]
pub fn delete_library_project(app: AppHandle, project_id: String) -> Result<(), String> {
    let id = sanitize_project_id(&project_id)?;
    let root = projects_root(&app)?;
    let dir = root.join(&id);
    if !dir.exists() {
        return Ok(());
    }
    let root_canon = fs::canonicalize(&root).unwrap_or(root);
    let dir_canon = fs::canonicalize(&dir).unwrap_or(dir.clone());
    if !dir_canon.starts_with(&root_canon) || dir_canon == root_canon {
        return Err("Invalid project path".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete project: {e}"))?;
    Ok(())
}
