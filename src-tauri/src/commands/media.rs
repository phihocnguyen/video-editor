use crate::media::probe::{probe_path, ProbeResult};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAvailability {
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
pub fn probe_media(path: String) -> Result<ProbeResult, String> {
    probe_path(&path)
}

#[tauri::command]
pub fn check_media_paths(paths: Vec<String>) -> Result<Vec<MediaAvailability>, String> {
    Ok(paths
        .into_iter()
        .map(|path| MediaAvailability {
            exists: Path::new(&path).is_file(),
            path,
        })
        .collect())
}

#[tauri::command]
pub fn import_media_paths(paths: Vec<String>) -> Result<Vec<ProbeResult>, String> {
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        results.push(probe_path(&path)?);
    }
    Ok(results)
}
