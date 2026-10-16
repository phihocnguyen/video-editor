# KlipCut

A lightweight, local-first video editor for Windows.

KlipCut is a desktop video editor that lets you import media, edit footage on a multi-track timeline, and export finished videos to MP4 — all directly on your machine.

Designed with privacy and local workflows in mind, KlipCut keeps your projects, media files, and exports on your device. No account required. No cloud uploads.

Built with React, TypeScript, Vite, Tauri 2, Rust, and FFmpeg.

## Features

- **Multi-track timeline editing** — Move, trim, split, snap clips, adjust playback speed, and manage linked audio.
- **Flexible media management** — Import video, audio, and image files, with support for relinking moved media.
- **Real-time composition preview** — Preview layered video, text, effects, and transitions directly in the editor.
- **MP4 export** — Render videos using H.264 video and AAC audio, with configurable resolution and quality presets.
- **Project management** — Create, open, save, and automatically save projects in `.klipcut.json` format.
- **Local-first workflow** — Keep projects, source media, and rendered exports on your machine, without requiring an account or cloud storage.

## Technology stack

| Technology | Purpose |
| --- | --- |
| React | User interface |
| TypeScript | Type-safe application development |
| Vite | Development server and frontend build |
| Tauri 2 | Native desktop application framework |
| Rust | Native application and backend functionality |
| FFmpeg / ffprobe | Media probing, thumbnail generation, and video rendering |

## System requirements

KlipCut's development environment requires the following:

- **Operating system:** Windows 10 or Windows 11 (64-bit)
- **Node.js:** Version 20 or later
- **pnpm:** Version 12.11.2
- **Rust:** Stable toolchain
- **Visual Studio Build Tools:** Installed with the Desktop development with C++ workload
- **WebView2:** Runtime, typically preinstalled on Windows
- **FFmpeg and ffprobe:** Available on `PATH` for media probing, thumbnail generation, and export

For detailed Windows configuration instructions, including MSVC and FFmpeg setup, see `docs/setup-windows.md`.

## Getting started

### 1. Install dependencies

Clone the repository, navigate to the project directory, and install the dependencies:

```bash
pnpm install
```

### 2. Start development

Run the web-based editor with its local export helper:

```bash
pnpm dev
```

To launch the native desktop application through Tauri:

```bash
pnpm tauri:dev
```

To run the marketing website locally:

```bash
pnpm dev:marketing
```

On Vercel, the marketing website is served from the root path (`/`).

## Available scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the editor and local export helper |
| `pnpm dev:marketing` | Start the marketing website |
| `pnpm test` | Run unit tests |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm build` | Build the frontend for production |
| `pnpm tauri:build` | Build the Windows NSIS installer |
| `pnpm export:video` | Render a project JSON file from the command line |

## Building for Windows

Build the native Windows installer with:

```bash
pnpm tauri:build
```

The generated NSIS installer is located at:

```text
src-tauri/target/release/bundle/nsis/
```

**Build environment note:** Producing the installer requires the Rust toolchain and FFmpeg in the build environment. The application also relies on FFmpeg and ffprobe for its media-processing workflows.

## Rendering and preview limitations

KlipCut uses browser-based compositing for timeline previews. It does not currently implement a dedicated GPU-based compositor.

Preview rendering and final video export are separate workflows. FFmpeg handles media processing and final export, while the browser provides the editing preview.

## Project documentation

For additional technical details, see:

- `docs/architecture.md` — Application architecture
- `docs/project-format.md` — Project file format
- `docs/rendering.md` — Rendering and export pipeline
- `docs/preview-backend.md` — Preview backend implementation
- `docs/phases.md` — Development phases and roadmap
- `docs/licensing.md` — FFmpeg and third-party licensing information

## Project status

- **Current version:** 0.1.1
- **Platform:** Windows 10 and Windows 11 (64-bit)
- **Application type:** Native desktop video editor
- **Export format:** MP4 (H.264/AAC)

KlipCut is under active development. Features, workflows, and implementation details may evolve as the project progresses.

KlipCut — Video editing, on your machine.
