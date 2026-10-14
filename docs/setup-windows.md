# Windows setup

## Render video without building the desktop app

Only **FFmpeg on PATH** is required:

```powershell
ffmpeg -version
pnpm install
pnpm export:video -- path\to\project.cutline.json path\to\out.mp4
pnpm export:video -- project.json out.mp4 --preset 720 --quality high
pnpm export:video -- project.json out.mp4 --dry-run
```

Project JSON must use real filesystem media paths (not browser `blob:` URLs). Save a project from the editor after desktop import, or hand-author paths.

## Desktop app (optional — needs MSVC)

1. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**.
2. Confirm `where.exe link`.
3. `pnpm tauri:dev` / `pnpm tauri:build` (NSIS under `src-tauri/target/release/bundle/nsis/`).

## FFmpeg / ffprobe

1. Download a release build (prefer LGPL for redistribution — `docs/licensing.md`).
2. Add `bin` to `PATH`.
3. `ffmpeg -version` and `ffprobe -version`.

## Update strategy (MVP)

No auto-updater. Ship versioned NSIS installers manually after packaging is validated.
