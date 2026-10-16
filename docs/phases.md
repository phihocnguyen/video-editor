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
5. **Phase 7 — Strip templates** — done (Slices A–D; see below).

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
4. **Strip templates** — moved to Phase 7
5. **Platforms** — macOS / Linux packaging
6. **Optional** — AI assist, licensing hooks

---

## Phase 7 — Strip templates (planned 2026-10-17)

**Goal:** A catalog of ready-made strip layouts (4 videos, 8 videos, and the same idea at other counts). The user drops that many clips. The app opens a normal 9:16 project with every cell filled. No music in the template. The user can still edit the result on the timeline.

**Not in this phase:** bundled music, beat-matching, remixing a reference video, captions, sequential layouts (photo dump, letterbox sequence, product story). Those can reuse the applier later. They are not required to ship strips.

### What a template is

A template is data, not a new player. Applying it builds a `ProjectDocument` the editor already understands.

- Canvas `1080×1920`, 30 fps, background `#000000`.
- Duration is fixed at **10 seconds**. Every cell is on screen for all 10 seconds. This is a collage, not a cut sequence.
- No audio clips. The empty audio track from `createEmptyProject` stays empty.
- One video track per cell. Preview stacks by `track.order` (`layerStackZ`: lower order paints above). Cells use orders `1…n`. The frame sits on order `0` so it paints above the cells. The frame track is locked.
- Each cell is a media clip (image or video) whose transform **covers** the cell, then a **hard crop** to that rectangle. The frame graphic does not hide overflow: neighboring cells would show each other's spill without the crop. Preview uses the cell rect as `clip-path`. Export crops the same rect before overlay.
- Cover math is new. Today a layer is contain-fit into the full canvas, then `scaleX`/`scaleY` and a center `x`/`y` (`containFitBox` in `src/domain/mediaTransform.ts`). Add `coverTransform(cell, mediaSize, canvas)` that returns the center and the uniform scale relative to that contain-fit box: `scale = max(cellW / fitW, cellH / fitH)`.
- Grayscale cells set `effects.grayscale` (already previewed and exported).
- Images hold for the full 10 seconds. Videos play from the start. A video shorter than 10 seconds plays once and **holds its last frame** for the rest, in preview and export.
- Drop order is row-major: top-left, across, then the next row.
- Fewer files than cells: the extra cells stay empty (canvas black shows through). Extra files are imported into the media bin and not placed.

Slot rectangles are normalized `0…1` of the canvas, top-left origin, authored next to the frame SVG. Do not infer slots by measuring the SVG at runtime.

The film rebate (sprocket holes, edge numbers, vertical edge label) is one SVG at `1080×1920`, added as a shape image on the locked frame track. The same path convention as Shape library assets (`/shapes/`). Edge copy is original (frame numbers and a house label). Do not print the Kodak wordmark or "Portra" on the frame.

### Catalog

One generator. A template is `{ cols, rows, twin, frame }`.

| id | User drops | Cells | Layout |
|---|---|---|---|
| `strip-4` | 4 | 4 | 2×2, no frame |
| `strip-8` | 8 | 8 | 2×4, no frame |
| `film-4` | 4 | 4 | 2×2 inside a film rebate |
| `film-8` | 8 | 8 | 2×4 inside a film rebate |
| `film-pair-4` | 4 | 8 | Two 2×2 strips. Left is the grayscale copy of the same 4 clips. Right is color. Film rebate. |
| `film-pair-8` | 8 | 16 | Two 2×4 strips, same rule. This is the contact-sheet layout. |

`film-pair-*` places file *i* in cell *i* on the left (grayscale) and the matching cell on the right (color). The user does not drop 16 files for an 8-video pair.

The generator also covers later counts without new apply code: 2 (1×2), 3 (1×3), 6 (2×3), 9 (3×3), 12 (3×4), each with or without `frame` and `twin`. Those ids are data. They do not block the first ship.

Gutters between cells are part of the slot rects (the rect is the photo window, not the full strip). The SVG draws the black gap, the sprockets, and the edge text.

### Apply flow

1. User opens the template list and picks one. The card shows the slot count ("8 videos") and a still of the empty frame.
2. User drops files in order, or picks that many from the media bin.
3. Domain function `applyStripTemplate(template, assets)` returns a new project: canvas, cell tracks, clips, frame asset, grayscale flags. Import and probe stay outside this function. The function is pure and unit-tested.
4. The editor opens that project. Undo history starts after the apply.

Replacing one cell is a later slice: click a cell, pick another file, rewrite that clip's asset and `coverTransform`. No schema field is required for the first ship. Track name (`cell-3`) is enough to find the clip.

### Slices

#### Slice A — Place 4 and 8

- [x] `LayoutTemplate` type and the `strip-4` / `strip-8` definitions (slot rects for a 9:16 canvas with even gutters)
- [x] `coverTransform` plus tests: wide photo, tall photo, square photo, each covers the cell and stays centered
- [x] `applyStripTemplate` for `strip-4` and `strip-8`: canvas size, 10 s, one track per cell, no audio clips, row-major assignment
- [x] Tests for too few files (empty cells) and too many files (extras not placed)
- [x] No UI yet

#### Slice B — Crop, film frame, pair

- [x] Cell crop in preview (`clip-path` from the slot rect) so cover overflow does not enter the next cell
- [x] The same crop in export (TS render plan and the Rust mirror)
- [x] Last-frame hold for a video shorter than 10 seconds, preview and export
- [x] Film-rebate SVG on the locked top track (`film-4`, `film-8`)
- [x] `film-pair-4` and `film-pair-8`: each file placed twice, left grayscale, right untouched
- [x] Tests: pair uses `n` assets and `2n` clips; only the left clip has `grayscale: true`

#### Slice C — Picker

- [x] Template list in the editor library (next to the existing shape / filter panels)
- [x] Card shows name, "4 videos" / "8 videos", and a static preview of the frame
- [x] Drop or pick files, then open the new project
- [x] Apply is one undo step

#### Slice D — More counts, swap one cell

- [x] Register 2, 3, 6, 9, and 12 from the same generator, plain and with the film frame
- [x] Click a filled cell and replace its media. Recompute `coverTransform` for the new dimensions. Leave the other cells alone.

**Exit:** Drop 8 videos on `film-pair-8`, preview shows two strips (left gray, right color) with no spill between cells, export matches the preview, and the timeline is a normal project the user can still move and trim. `strip-4` and `strip-8` pass the same check without the frame.
