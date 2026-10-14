# Cutline

Windows-first desktop video editor built with **React + TypeScript + Vite + Tauri 2 + Rust + FFmpeg**.

Local-first: projects, media, cache, and exports stay on the user's machine. Core editing and export work offline. This is an original product — not CapCut branding, assets, or code.

## Prerequisites

- Windows 10/11 x64
- Node.js 20+ and [pnpm](https://pnpm.io/)
- [Rust stable](https://rustup.rs/)
- **Visual Studio Build Tools** with the “Desktop development with C++” workload (`link.exe` required for Tauri)
- WebView2 (usually preinstalled on Windows 10/11)
- FFmpeg / ffprobe on `PATH` for media probe and export spikes

Phase roadmap: `docs/phases.md`.

## Quick start

```bash
pnpm install
pnpm tauri:dev
```

Frontend-only (no native bridge):

```bash
pnpm dev
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm tauri:dev` | Desktop app (Vite + Tauri) |
| `pnpm build` | Frontend production build |
| `pnpm tauri:build` | Windows installer (NSIS) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | TypeScript check |

## Architecture

See `implementation_plan.md` and:

- `docs/architecture.md`
- `docs/project-format.md`
- `docs/rendering.md`
- `docs/licensing.md`

## Status

Initialized for **Milestone 0** (desktop shell + module boundaries + typed native commands). Feature panels mark unfinished work explicitly; buttons that are not implemented are disabled.
