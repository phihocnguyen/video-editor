# Delivery phases

Maps `implementation_plan.md` milestones into executable phases. Keep the app buildable after each phase.

## Phase 0 — Desktop shell & feasibility (Milestone 0)

**Goal:** Runnable Windows desktop scaffold with module boundaries and one typed native command.

- [x] React + TypeScript + Vite + Tauri 2 layout
- [x] Feature folders, domain sketch, Zustand stores
- [x] Typed `get_app_info` / `probe_media` commands
- [x] Docs stubs + preview ADR
- [x] Vitest smoke tests for time math
- [x] CapCut-like editor chrome (Cutline branding)
- [x] Minimal CI: `pnpm typecheck` + `pnpm test`
- [x] Setup docs for MSVC + FFmpeg (`docs/setup-windows.md`)
- [ ] Machine verify: MSVC installed; `pnpm tauri:dev` launches a window
- [ ] Machine verify: FFmpeg on PATH; probe/export on sample media

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
- [x] Disk thumbnail cache via FFmpeg (`generate_thumbnail`)
- [ ] Machine verify end-to-end on `pnpm tauri:dev`

**Exit:** Create → import → save → reopen; originals untouched; missing media flagged.

---

## Phase 2 — Timeline editing (Milestone 2)

**Goal:** Non-destructive multi-track editing with undo/redo.

- [x] Track/clip commands (add/remove/move/trim/split/delete)
- [x] Timeline UI: selection, playhead, zoom, scroll
- [x] Drag media to timeline; add at playhead
- [x] History stack; Ctrl+Z / Ctrl+Y
- [x] Unit tests for invariants and edge cases
- [x] Snap-to-edges / playhead (toggle)
- [x] Trim handles in UI
- [x] Smooth playhead scrub (pointer drag follows mouse)
- [x] Live clip slide (pointer drag)
- [x] Add/remove tracks; mute / visible / lock toggles
- [x] Clip speed (timeline duration = source / speed)

**Exit:** Edit operations preserve model; UI responsive with representative clip count.

---

## Phase 3 — Preview (Milestone 3)

**Goal:** Play/pause/seek across the timeline with documented limits.

- [x] Playback clock tied to ticks
- [x] Stacked multi-track video/image preview (visible tracks, opacity)
- [x] Reduce black-flash on import/seek
- [x] Audio playback from active media/audio clips
- [x] Document preview limits in UI copy
- [ ] Full proxy / GPU compositor (Later)

**Exit:** Seek/playback across clip boundaries for MVP track types.

---

## Phase 4 — Export (Milestone 4)

**Goal:** Deterministic MP4 export via FFmpeg from Rust.

- [x] Render-plan generator (opacity, speed, track mute/order, quality bitrates)
- [x] FFmpeg argv builder + job lifecycle
- [x] Export dialog progress + cancel + quality presets
- [x] Audio track mix (`amix` / `[outa]`) + atempo for speed
- [x] Output validation with ffprobe
- [ ] Machine verify on `pnpm tauri:dev` (MSVC + FFmpeg)

**Exit:** Multi-clip project → valid MP4; cancel leaves no corrupt final; semantics match docs.

---

## Phase 5 — MVP polish & packaging (Milestone 5)

**Goal:** Installable offline MVP.

- [x] Add text clip + edit content/font/color/position
- [x] Browse custom fonts
- [x] Preview text overlays (move / resize / delete)
- [x] Opacity/volume/speed for selected clips
- [x] Shortcuts, settings, recent projects
- [x] NSIS target + icon set + version `0.1.0` + installMode
- [x] README known limitations + licensing pointers
- [x] Update strategy decision documented (manual NSIS; no auto-updater)
- [ ] Offline QA pass on a clean Windows machine (human)

**Exit:** Clean Windows install; full MVP DoD in `implementation_plan.md` §16.

---

## Later — Pro features

Only after Phase 5 is reliable: keyframes, transitions, color, captions, proxies, templates, optional AI/licensing, macOS/Linux.
