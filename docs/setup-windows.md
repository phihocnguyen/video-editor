# Windows setup

## Render without building the desktop app

Needs **FFmpeg**. Prefer the portable copy at `tools/ffmpeg/bin/ffmpeg.exe` (already set up if present), or put FFmpeg on `PATH` / set `FFMPEG_PATH`.

### Export button in the UI (recommended)

```powershell
pnpm install
pnpm dev
```

Restart `pnpm dev` after installing FFmpeg. Export panel should show `Helper: online · FFmpeg ok`.

`pnpm dev` starts Vite **and** a local export helper on `http://127.0.0.1:1421`.

1. Open the app in the browser  
2. **Import media** (cached under `.klipcut-cache/media`)  
3. Edit the timeline  
4. Click **Export** — MP4 downloads when finished  

### Optional CLI

```powershell
pnpm export:video -- path\to\project.klipcut.json path\to\out.mp4
```

## Desktop app (optional — needs MSVC)

1. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**.  
2. Confirm `where.exe link`.  
3. **Bundle FFmpeg** (required — otherwise export/thumbnails break on user machines): drop `ffmpeg-x86_64-pc-windows-msvc.exe` + `ffprobe-x86_64-pc-windows-msvc.exe` into `src-tauri/binaries/` (see its README; prefer the essentials build for size).  
4. `pnpm tauri:dev` / `pnpm tauri:build`.

The Export panel shows which binary is active (`Bundled FFmpeg` vs `System FFmpeg` vs missing). Without sidecars it falls back to `tools/ffmpeg`, common install dirs, then `PATH`.

## FFmpeg / ffprobe

1. Download a release build (prefer LGPL for redistribution — `docs/licensing.md`).  
2. Add `bin` to `PATH`.  
3. `ffmpeg -version` and `ffprobe -version`.

## Update strategy (MVP)

No auto-updater. Ship versioned NSIS installers manually after packaging is validated.
