use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub offline_capable: bool,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Cutline".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        offline_capable: true,
    }
}
