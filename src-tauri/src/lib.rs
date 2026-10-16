mod commands;
mod media;
mod project;
mod render;
mod storage;
mod toolchain;

use render::job::{ExportJobStore, SharedJobs};
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let jobs: SharedJobs = Arc::new(ExportJobStore::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs)
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::media::probe_media,
            commands::media::check_media_paths,
            commands::media::import_media_paths,
            commands::media::generate_thumbnail,
            commands::media::extract_audio_track,
            commands::project::open_project,
            commands::project::save_project,
            commands::project::validate_project,
            commands::project::autosave_project,
            commands::project::recover_autosave,
            commands::project::save_library_project,
            commands::project::list_library_projects,
            commands::project::import_media_into_project,
            commands::project::is_library_project_path,
            commands::project::delete_library_project,
            commands::render::start_export,
            commands::render::get_export_status,
            commands::render::cancel_export,
            toolchain::ffmpeg_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cutline");
}
