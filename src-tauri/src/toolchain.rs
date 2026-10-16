//! Locate the FFmpeg / ffprobe binaries.
//!
//! Resolution order (first hit wins):
//! 1. `KLIPCUT_FFMPEG` / `FFMPEG_PATH` env (a binary file or a directory)
//! 2. Bundled sidecars next to the app executable
//!    (`ffmpeg[.exe]`, `ffmpeg-<target-triple>[.exe]`, same for ffprobe)
//! 3. Dev tree: `tools/ffmpeg[/bin]/` walking up from CWD and the executable
//! 4. Common Windows install locations
//! 5. `PATH` search
//! 6. Bare `"ffmpeg"` / `"ffprobe"` fallback (relies on PATH at spawn time)
//!
//! Results are cached in `OnceLock`s — resolution walks the filesystem, so
//! callers (e.g. per-clip audio probing) must stay cheap.

use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Spawn helper that hides the console window on Windows (FFmpeg/ffprobe/
/// taskkill otherwise flash a CMD briefly on every probe/thumb/export).
pub fn silent_command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg(target_os = "windows")]
const EXE_SUFFIX: &str = ".exe";
#[cfg(not(target_os = "windows"))]
const EXE_SUFFIX: &str = "";

/// Target triple used for Tauri sidecar naming (`binaries/<tool>-<triple>`).
const TRIPLE: &str = if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    "x86_64-pc-windows-msvc"
} else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
    "aarch64-pc-windows-msvc"
} else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    "x86_64-apple-darwin"
} else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    "aarch64-apple-darwin"
} else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    "x86_64-unknown-linux-gnu"
} else {
    "unknown"
};

#[cfg(target_os = "windows")]
const COMMON_DIRS: &[&str] = &[
    "C:\\ffmpeg\\bin",
    "C:\\Program Files\\ffmpeg\\bin",
    "C:\\Program Files (x86)\\ffmpeg\\bin",
];
#[cfg(not(target_os = "windows"))]
const COMMON_DIRS: &[&str] = &["/usr/local/bin", "/opt/homebrew/bin"];

static FFMPEG: OnceLock<PathBuf> = OnceLock::new();
static FFPROBE: OnceLock<PathBuf> = OnceLock::new();

pub fn ffmpeg_program() -> PathBuf {
    FFMPEG.get_or_init(|| resolve_tool("ffmpeg")).clone()
}

pub fn ffprobe_program() -> PathBuf {
    FFPROBE.get_or_init(resolve_ffprobe).clone()
}

fn candidate_names(tool: &str) -> [String; 2] {
    [
        format!("{tool}{EXE_SUFFIX}"),
        format!("{tool}-{TRIPLE}{EXE_SUFFIX}"),
    ]
}

fn first_existing(dir: &Path, tool: &str) -> Option<PathBuf> {
    candidate_names(tool)
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

fn from_env(tool: &str) -> Option<PathBuf> {
    for key in ["KLIPCUT_FFMPEG", "FFMPEG_PATH"] {
        let raw = std::env::var(key).ok()?;
        if raw.trim().is_empty() {
            continue;
        }
        let path = PathBuf::from(&raw);
        if path.is_file() {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned());
            match stem.as_deref() {
                Some(name)
                    if name == tool
                        || name.starts_with(format!("{tool}-").as_str()) =>
                {
                    return Some(path);
                }
                _ => {}
            }
            // Env points at the sibling binary (e.g. ffmpeg.exe while
            // resolving ffprobe) — look next to it.
            if let Some(parent) = path.parent() {
                if let Some(hit) = first_existing(parent, tool) {
                    return Some(hit);
                }
            }
            continue;
        }
        if path.is_dir() {
            if let Some(hit) = first_existing(&path, tool) {
                return Some(hit);
            }
        }
    }
    None
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|parent| parent.to_path_buf())
}

fn ancestor_dirs(base: &Path, depth: usize) -> Vec<PathBuf> {
    let mut dirs = Vec::with_capacity(depth + 1);
    let mut current: Option<&Path> = Some(base);
    for _ in 0..=depth {
        match current {
            Some(dir) => {
                dirs.push(dir.to_path_buf());
                current = dir.parent();
            }
            None => break,
        }
    }
    dirs
}

fn dev_tree(tool: &str) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.extend(ancestor_dirs(&cwd, 4));
    }
    if let Some(exe) = exe_dir() {
        roots.extend(ancestor_dirs(&exe, 5));
    }
    for root in roots {
        for sub in ["tools/ffmpeg/bin", "tools/ffmpeg"] {
            if let Some(hit) = first_existing(&root.join(sub), tool) {
                return Some(hit);
            }
        }
    }
    None
}

fn search_path(tool: &str) -> Option<PathBuf> {
    let path_env = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_env) {
        if let Some(hit) = first_existing(&dir, tool) {
            return Some(hit);
        }
    }
    None
}

fn resolve_tool(tool: &str) -> PathBuf {
    if let Some(hit) = from_env(tool) {
        return hit;
    }
    if let Some(dir) = exe_dir() {
        if let Some(hit) = first_existing(&dir, tool) {
            return hit;
        }
    }
    if let Some(hit) = dev_tree(tool) {
        return hit;
    }
    for dir in COMMON_DIRS {
        if let Some(hit) = first_existing(Path::new(dir), tool) {
            return hit;
        }
    }
    if let Some(hit) = search_path(tool) {
        return hit;
    }
    PathBuf::from(tool)
}

fn resolve_ffprobe() -> PathBuf {
    // Prefer the sibling of the resolved ffmpeg (a bundled pair stays paired).
    let ffmpeg = ffmpeg_program();
    if ffmpeg.is_absolute() {
        if let Some(parent) = ffmpeg.parent() {
            if let Some(hit) = first_existing(parent, "ffprobe") {
                return hit;
            }
        }
    }
    if let Some(hit) = from_env("ffprobe") {
        return hit;
    }
    if let Some(dir) = exe_dir() {
        if let Some(hit) = first_existing(&dir, "ffprobe") {
            return hit;
        }
    }
    if let Some(hit) = dev_tree("ffprobe") {
        return hit;
    }
    for dir in COMMON_DIRS {
        if let Some(hit) = first_existing(Path::new(dir), "ffprobe") {
            return hit;
        }
    }
    if let Some(hit) = search_path("ffprobe") {
        return hit;
    }
    PathBuf::from("ffprobe")
}

fn probe_version(program: &Path) -> bool {
    silent_command(program)
        .arg("-version")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub ffmpeg: String,
    pub ffmpeg_ok: bool,
    pub ffprobe: String,
    pub ffprobe_ok: bool,
    /// True when the resolved ffmpeg ships next to the app (bundled sidecar).
    pub bundled: bool,
}

/// Definitive availability check: resolves both binaries and runs
/// `ffmpeg/ffprobe -version`. Cheap enough for UI polling.
#[tauri::command]
pub fn ffmpeg_status() -> ToolchainStatus {
    let ffmpeg = ffmpeg_program();
    let ffprobe = ffprobe_program();
    let bundled = ffmpeg.is_absolute()
        && exe_dir()
            .map(|dir| ffmpeg.starts_with(&dir))
            .unwrap_or(false);
    ToolchainStatus {
        ffmpeg: ffmpeg.to_string_lossy().to_string(),
        ffmpeg_ok: probe_version(&ffmpeg),
        ffprobe: ffprobe.to_string_lossy().to_string(),
        ffprobe_ok: probe_version(&ffprobe),
        bundled,
    }
}
