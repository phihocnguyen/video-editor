# Bundled FFmpeg sidecars (required for a shippable build)

`tauri build` embeds every binary listed in `bundle.externalBin` and the app
prefers them over anything on PATH (see `src/toolchain.rs`). Until these files
exist, `tauri dev` / `tauri build` will fail — that is intentional: shipping
without FFmpeg means export, thumbnails and probing break on user machines.

## Files to drop here

Tauri sidecar naming: `<name>-<target-triple>[.exe]`.

Windows x64 (this project's target):

- `ffmpeg-x86_64-pc-windows-msvc.exe`
- `ffprobe-x86_64-pc-windows-msvc.exe`

## Where to get them (small = better)

- https://www.gyan.dev/ffmpeg/builds/ → **ffmpeg-release-essentials.zip**
  (~25–30 MB per binary instead of ~80 MB full). Essentials covers
  libx264 + aac + image2 + ffprobe, i.e. everything Cutline uses.
- Extract `bin/ffmpeg.exe` → rename → drop here (same for ffprobe).

Verify after dropping in:

```powershell
.\src-tauri\binaries\ffmpeg-x86_64-pc-windows-msvc.exe -version
.\src-tauri\binaries\ffprobe-x86_64-pc-windows-msvc.exe -version
```

## Fallbacks (no rebuild needed)

If the sidecars are absent at runtime (dev machines), the app resolves in order:
`CUTLINE_FFMPEG`/`FFMPEG_PATH` → `tools/ffmpeg[/bin]/` → common install dirs →
`PATH` → bare `ffmpeg`. The Export panel shows which binary is active
(bundled vs system path).

## Size note

The two essentials binaries add ~55–65 MB pre-compression (~25–35 MB in the
NSIS installer thanks to LZMA). That is the price of "build ra là chạy".
Do NOT commit large binaries to git — keep them local (see `.gitignore`).
