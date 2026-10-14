use crate::media::probe::{probe_path, ProbeResult};
use crate::render::ffmpeg::generate_thumbnail_file;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAvailability {
    pub path: String,
    pub exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub path: String,
    pub cached: bool,
}

#[tauri::command]
pub fn probe_media(path: String) -> Result<ProbeResult, String> {
    probe_path(&path)
}

/// Disk thumbnail cache via FFmpeg (JPEG under app cache dir).
#[tauri::command]
pub fn generate_thumbnail(
    app: AppHandle,
    path: String,
    time_sec: Option<f64>,
) -> Result<ThumbnailResult, String> {
    let media = PathBuf::from(&path);
    if !media.is_file() {
        return Err("Media file missing".into());
    }
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let time = time_sec.unwrap_or(0.5);
    ((time * 1000.0) as i64).hash(&mut hasher);
    let key = format!("{:x}", hasher.finish());

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    let out = cache_dir.join(format!("{key}.jpg"));
    if out.is_file() {
        return Ok(ThumbnailResult {
            path: out.to_string_lossy().to_string(),
            cached: true,
        });
    }
    generate_thumbnail_file(&media, time, &out)?;
    Ok(ThumbnailResult {
        path: out.to_string_lossy().to_string(),
        cached: false,
    })
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
