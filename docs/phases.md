# Delivery phases

Maps `implementation_plan.md` milestones into executable phases. Keep the app buildable after each phase.

## Phase 0 — Desktop shell & feasibility (Milestone 0)

**Goal:** Runnable Windows desktope scaffold with module boundaries and one typed native command.

- [x] React + TypeScript + Vite + Tauri 2 layout
- [x] Feature folders, domain sketch, Zustand stores
- [x] Typed `get_app_info` / `probe_media` commands
- [x] Docs stubs + preview ADR
- [x] Vitest smoke tests for time math
- [x] CapCut-like editor chrome (Cutline branding)
- [ ] Install MSVC Build Tools; `pnpm tauri:dev` launches a window
- [ ] FFmpeg on PATH; probe/export PoC on sample media
- [ ] Minimal CI: `pnpm typecheck` + `pnpm test`

**Exit:** App window on Windows; probe sample file; UI stays responsive; no web deploy.

---

## Phase 1 — Project & media foundation (Milestone 1)

**Goal:** Local projects and media bin work across restarts.

- [x] Project JSON validate/serialize (TypeScript)
- [x] Project save/open/validate + autosave paths (Rust)
- [x] Native dialogs for open/save/import (Tauri plugin)
- [x] Import → probe → media bin; missing-media flag
- [x] Browser import + image/video thumbnails (object URL / convertFileSrc)
- [x] Relink UX (confirm before swap, desktop)
- [ ] Verify end-to-end on `pnpm tauri:dev` (needs MSVC)
- [ ] Disk thumbnail cache via FFmpeg (optional upgrade)

**Exit:** Create → import → save → reopen; originals untouched; missing media flagged.

---

## Phase 2 — Timeline editing (mostly done / Milestone 2)

**Goal:** Non-destructive multi-track editing with undo/redo.

- [x] Track/clip commands (add/remove/move/trim/split/delete)
- [x] Timeline UI: selection, playhead, zoom, scroll
- [x] Drag media to timeline; add at playhead
- [x] History stack; Ctrl+Z / Ctrl+Y
- [x] Unit tests for invariants and edge cases
- [ ] Snap-to-edges polish
- [ ] Trim handles in UI (domain trim exists)

**Exit:** Edit operations preserve model; UI responsive with representative clip count.

---

## Phase 3 — Preview (in progress / Milestone 3)

**Goal:** Play/pause/seek across the timeline with documented limits.

- [x] Playback clock tied to ticks
- [x] Active-clip video/image preview (single top video track)
- [ ] Audio playback/mixing
- [ ] Multi-track compositing / proxy cache
- [x] Document preview limits in UI copy

**Exit:** Seek/playback across clip boundaries for MVP track types.

---

## Phase 4 — Export (in progress / Milestone 4)

**Goal:** Deterministic MP4 export via FFmpeg from Rust.

- [x] Render-plan generator (TypeScript) including text overlays
- [x] FFmpeg argv builder + job lifecycle (Rust; needs FFmpeg on PATH)
- [x] Export dialog progress + cancel
- [ ] Verify on `pnpm tauri:dev` (MSVC + FFmpeg)
- [ ] Output validation with ffprobe
- [ ] Audio track mix in export filter graph

**Exit:** Multi-clip project → valid MP4; cancel leaves no corrupt final; semantics match docs.

---

## Phase 5 — MVP polish & packaging (in progress / Milestone 5)

**Goal:** Installable offline MVP.

- [x] Add text clip + edit content/font/color/position
- [x] Browse custom fonts (desktop dialog / browser file picker)
- [x] Preview text overlays
- [ ] Transforms/volume inspector for media clips
- [ ] Shortcuts, settings, recent projects
- [ ] NSIS installer, icon, versioning
- [ ] Offline QA pass; README known limitations + licenses

**Exit:** Clean Windows install; full MVP DoD in `implementation_plan.md` §16.

---

## Later — Pro features

Only after Phase 5 is reliable: keyframes, transitions, color, captions, proxies, templates, optional AI/licensing, macOS/Linux.
