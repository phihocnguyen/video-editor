use crate::media::probe::{probe_path, ProbeResult};

#[tauri::command]
pub fn probe_media(path: String) -> Result<ProbeResult, String> {
    // Path is validated inside the media module; never shell-out with user strings.
    probe_path(&path)
}
