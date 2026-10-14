mod commands;
mod media;
mod project;
mod render;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::media::probe_media,
            commands::media::check_media_paths,
            commands::media::import_media_paths,
            commands::project::open_project,
            commands::project::save_project,
            commands::project::validate_project,
            commands::project::autosave_project,
            commands::project::recover_autosave,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cutline");
}
