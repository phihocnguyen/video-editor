use serde_json::Value;
use std::fs;
use std::path::Path;

const SCHEMA_VERSION: u64 = 1;

pub fn read_project_file(path: &Path) -> Result<Value, String> {
    if !path.is_file() {
        return Err("Project file does not exist".into());
    }
    let text = fs::read_to_string(path).map_err(|e| format!("Failed to read project: {e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("Invalid project JSON: {e}"))?;
    validate_project_value(&value)?;
    Ok(value)
}

pub fn write_project_file(path: &Path, project: &Value) -> Result<(), String> {
    validate_project_value(project)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create folder: {e}"))?;
        }
    }

    let pretty =
        serde_json::to_string_pretty(project).map_err(|e| format!("Failed to serialize: {e}"))?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, format!("{pretty}\n")).map_err(|e| format!("Failed to write temp file: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to finalize project file: {e}")
    })?;
    Ok(())
}

pub fn validate_project_value(value: &Value) -> Result<(), String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "Project must be a JSON object".to_string())?;

    let schema = obj
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Missing schemaVersion".to_string())?;
    if schema != SCHEMA_VERSION {
        return Err(format!("Unsupported schemaVersion {schema}"));
    }

    for key in ["id", "name", "updatedAt"] {
        if obj.get(key).and_then(|v| v.as_str()).unwrap_or("").is_empty() {
            return Err(format!("Missing or empty field: {key}"));
        }
    }

    let canvas = obj
        .get("canvas")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "Missing canvas".to_string())?;
    for key in ["width", "height", "frameRate"] {
        if canvas.get(key).and_then(|v| v.as_f64()).is_none() {
            return Err(format!("canvas.{key} must be a number"));
        }
    }

    if !obj.get("tracks").map(|v| v.is_array()).unwrap_or(false) {
        return Err("tracks must be an array".into());
    }
    if !obj.get("assets").map(|v| v.is_array()).unwrap_or(false) {
        return Err("assets must be an array".into());
    }
    if !obj.get("clips").map(|v| v.is_array()).unwrap_or(false) {
        return Err("clips must be an array".into());
    }

    Ok(())
}
