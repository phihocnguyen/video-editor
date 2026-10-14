# Architecture

Cutline is a **modular desktop monolith**: React UI + Tauri/Rust native layer + FFmpeg child processes. No backend server or cloud dependency for core editing.

## Layers

1. **UI (`src/features/*`)** — editor shell, media bin, timeline, preview, inspector, export.
2. **State (`src/stores`)** — Zustand for transient UI state; project document kept separate.
3. **Domain (`src/domain`)** — project schema, time math, validation, render-plan types.
4. **Native bridge (`src/lib/tauri.ts`)** — typed wrappers over Tauri `invoke`.
5. **Rust (`src-tauri`)** — filesystem, dialogs, process management, FFmpeg/ffprobe.

## Native modules

| Module | Responsibility |
| --- | --- |
| `commands/` | Tauri command surface (validated inputs) |
| `media/` | Probe, thumbnails, availability |
| `project/` | Save/open/autosave/validate |
| `render/` | Render plan + FFmpeg job lifecycle |
| `storage/` | App data/cache/temp paths |

## Preview note

A single HTML `<video>` element is insufficient for multi-track timeline preview. Milestone 0 records this decision: start with source-clip playback for early UX, validate compositing requirements early in Milestone 3, and introduce proxy/cache pipeline if needed.
