# Cutline

Windows-first desktop video editor: **React + TypeScript + Vite + Tauri 2 + Rust + FFmpeg**.

Local-first — projects, media, cache, and exports stay on the machine. Core editing and export work offline. Original product (not CapCut branding, assets, or code).

## Prerequisites

- Windows 10/11 x64
- Node.js 20+ and [pnpm](https://pnpm.io/)
- [Rust stable](https://rustup.rs/)
- **Visual Studio Build Tools** — “Desktop development with C++” (`link.exe`)
- WebView2 (usually preinstalled)
- **FFmpeg / ffprobe** on `PATH` for probe, thumbnails, and export

See `docs/setup-windows.md` for MSVC + FFmpeg details.

## Quick start

```bash
pnpm install
pnpm tauri:dev          # desktop (needs MSVC)
pnpm dev                # browser UI only (no native export)
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm tauri:dev` | Desktop app |
| `pnpm build` | Frontend production build |
| `pnpm tauri:build` | Windows NSIS installer |
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | TypeScript check |

Version: `0.1.0` (`package.json` / `src-tauri/tauri.conf.json`).

## What works (MVP)

- Create / open / save / autosave projects (`.cutline.json`)
- Import video, audio, images; missing-media flag + relink
- Multi-track timeline: move (live slide), trim, split, delete, snap, speed
- Track mute / visible / lock; add/remove tracks
- Preview: stacked visible video tracks, text overlays (drag/resize), audio clips
- Export MP4 (H.264/AAC) with resolution + quality presets, progress, cancel, ffprobe check
- Shortcuts: Space, Ctrl+S/O, Delete, Undo/Redo; recent projects; snap setting

## Known limitations

- Preview is HTML media stacking — not a full GPU compositor or proxy pipeline
- Browser `pnpm dev` uses blob URLs; **export requires desktop import paths**
- Transitions, keyframes, color, captions = **Later** (see `docs/phases.md`)
- MSVC + FFmpeg must be installed by the developer/user; not bundled in MVP
- No auto-updater yet (manual NSIS installs)

## Architecture & licenses

- `implementation_plan.md`, `docs/phases.md`, `docs/architecture.md`
- `docs/project-format.md`, `docs/rendering.md`, `docs/preview-backend.md`
- `docs/licensing.md` — FFmpeg LGPL/GPL and third-party notes

## Packaging

```bash
pnpm tauri:build
```

Produces an NSIS installer under `src-tauri/target/release/bundle/nsis/`. App icons live in `src-tauri/icons/`.
