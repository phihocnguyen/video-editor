mod commands;
mod media;
mod project;
mod render;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::media::probe_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cutline");
}
