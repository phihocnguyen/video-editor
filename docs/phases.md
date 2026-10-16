# Delivery phases

Maps `implementation_plan.md` milestones into executable phases. Keep the app buildable after each phase.

## Status (2026-10-16)

**MVP business logic: done** (Phases 0–5 code complete in browser/`pnpm dev` path).

| Area | State |
|------|--------|
| Timeline edit (tracks, trim, split, snap, slide, speed, mute/lock/visible) | Done |
| Preview (multi-track composite, audio, text overlays) | Done |
| Export local (`pnpm dev` + helper `:1421` + portable `tools/ffmpeg`) | Done |
| Text in export (scale coords to resolution + Windows `fontfile` quote/fallback) | Done |
| Silent / no-audio media (skip `[n:a]` filters) | Done |
| Project save/open, media bin, undo/redo, settings | Done |
| Phase 6 Slice A — clip effects (bright/contrast/sat/blur/gray/fade) | Done |
| Phase 6 Slice B — transitions + Clip panel UX | Done |
| Detach video audio onto a linked, independently trimmable audio clip | Done |
| Opacity / transform keyframes (linear; preview + export) | Done |

**Still open:**

1. **Machine verify / packaging** — MSVC; `pnpm tauri:dev`; NSIS install; offline QA. Rust export mirrors the new filters, but this machine has no Rust toolchain to compile it.
2. **Phase 6 Pro** — remaining polish (captions…).
4. **Optional polish** — export with the exact custom `.ttf` (else Arial/Segoe fallback).

---

## Phase 0 — Desktop shell & feasibility (Milestone 0)

**Goal:** Runnable Windows desktop scaffold with module boundaries and one typed native command.

- [x] React + TypeScript + Vite + Tauri 2 layout
- [x] Feature folders, domain sketch, Zustand stores
- [x] Typed `get_app_info` / `probe_media` commands
- [x] Docs stubs + preview ADR
- [x] Vitest smoke tests for time math
- [x] CapCut-like editor chrome (KlipCut branding)
- [x] Minimal CI: `pnpm typecheck` + `pnpm test`
- [x] Setup docs for MSVC + FFmpeg (`docs/setup-windows.md`)
- [ ] Machine verify: MSVC installed; `pnpm tauri:dev` launches a window
- [x] Local FFmpeg via `tools/ffmpeg` (browser export path; PATH optional)

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

**Goal:** Deterministic MP4 export via FFmpeg (Rust path + local CLI/helper).

- [x] Render-plan generator (opacity, speed, track mute/order, quality bitrates)
- [x] FFmpeg argv builder + job lifecycle
- [x] Export dialog progress + cancel + quality presets
- [x] Audio track mix (`amix` / `[outa]`) + atempo for speed
- [x] Skip audio filters when probe finds no audio stream
- [x] Local export helper (`scripts/export-server.ts` on `:1421`) without Tauri build
- [x] Text overlays in export (`drawtext`: scale to preset, quoted Windows `fontfile`, system font fallback)
- [x] Output validation with ffprobe (CLI path)
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
- [ ] Produce NSIS installer (`pnpm tauri build` with MSVC)

**Exit:** Clean Windows install; full MVP DoD in `implementation_plan.md` §16.

---

## Phase 6 — Pro effects (started)

**Goal:** Per-clip visual effects that match in preview and export (FFmpeg filters). Keep schema backward-compatible (missing `effects` → defaults).

### Slice A — Color / blur (now)

- [x] `Clip.effects`: brightness, contrast, saturation, blur, grayscale, fadeInSec, fadeOutSec
- [x] Inspector sliders for media clips
- [x] Preview via CSS `filter` + fade opacity
- [x] Export via FFmpeg `eq` / `gblur` / `hue` / `fade`
- [x] Unit tests for effect → filter strings

### Slice B — Transitions + Clip UX (now)

- [x] `Clip.transitionIn`: cut / dissolve / fade / wipeLeft / wipeRight + duration
- [x] Timeline diamond between adjacent clips (click to cycle)
- [x] Clip panel: transition chips + slider UX for effects
- [x] Preview crossfade / wipe during overlap window
- [x] Export via early overlay + fade / wipe x-offset (TS + Rust)

### Slice C — CapCut-style effects

- [x] Flip H/V (via transform scaleX / scaleY negate in Properties)
- [x] Vignette + sharpen (Adjustment + preview overlay + FFmpeg `vignette` / `unsharp`)
- [x] Effect presets (None / Warm / Cool / Vivid / Soft / B&W / Film)
- [x] Timeline FX badge when clip has non-default effects

### Slice D — Effect keyframes (CapCut-style)

- [x] Per-param `effectKeyframes` on clips (brightness / contrast / sat / blur / vignette / sharpen / grayscale)
- [x] Properties ◇ toggle at playhead; steppers upsert when param is animated
- [x] Preview resolves `effectsAtProgress` while scrubbing/playing
- [x] Timeline diamond marks + FX badge when keyframed
- [x] Export: `eq` exprs + stepped `enable=` windows for blur/vignette/sharpen
- [x] Opacity / transform keyframes (linear position, scale, rotation, opacity)
- [ ] Full curve graph editor (optional; speed-ramp style)

### Later slices (ordered)

1. **Captions** — SRT import + burn-in (drawtext / ass)
2. **Color grading** — curves / LUTs (beyond simple eq)
3. **Proxy / GPU compositor** — smoother multi-track preview
4. **Templates** — starter timelines
5. **Platforms** — macOS / Linux packaging
6. **Optional** — AI assist, licensing hooks
