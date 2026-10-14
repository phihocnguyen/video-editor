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

## Phase 1 — Project & media foundation (in progress / Milestone 1)

**Goal:** Local projects and media bin work across restarts.

- [x] Project JSON validate/serialize (TypeScript)
- [x] Project save/open/validate + autosave paths (Rust)
- [x] Native dialogs for open/save/import (Tauri plugin)
- [x] Import → probe → media bin; missing-media flag
- [ ] Thumbnail generation + disk cache
- [ ] Relink UX (confirm before swap)
- [ ] Verify end-to-end on `pnpm tauri:dev` (needs MSVC)

**Exit:** Create → import → save → reopen; originals untouched; missing media flagged.

---

## Phase 2 — Timeline editing (Milestone 2)

**Goal:** Non-destructive multi-track editing with undo/redo.

- Track/clip commands (add/remove/move/trim/split/delete)
- Timeline UI: selection, playhead, zoom, scroll, snap
- History stack; keyboard basics for undo/redo
- Unit tests for invariants and edge cases

**Exit:** Edit operations preserve model; UI responsive with representative clip count.

---

## Phase 3 — Preview (Milestone 3)

**Goal:** Play/pause/seek across the timeline with documented limits.

- Playback clock tied to ticks
- Active-clip / simple compositing strategy
- Audio mix strategy (even if limited)
- Proxy/cache only if profiling requires it
- Document preview vs export fidelity (`docs/preview-backend.md`)

**Exit:** Seek/playback across clip boundaries for MVP track types.

---

## Phase 4 — Export (Milestone 4)

**Goal:** Deterministic MP4 export via FFmpeg from Rust.

- Render-plan generator from project snapshot
- Explicit argv/filter graph; progress + cancel + temp finalize
- Export dialog presets (source/720p/1080p)
- ffprobe output validation; structured errors

**Exit:** Multi-clip project → valid MP4; cancel leaves no corrupt final; semantics match docs.

---

## Phase 5 — MVP polish & packaging (Milestone 5)

**Goal:** Installable offline MVP.

- Text/title overlays; transforms; volume in inspector
- Shortcuts, settings, recent projects
- NSIS installer, icon, versioning
- Offline QA pass; README known limitations + licenses

**Exit:** Clean Windows install; full MVP DoD in `implementation_plan.md` §16.

---

## Later — Pro features

Only after Phase 5 is reliable: keyframes, transitions, color, captions, proxies, templates, optional AI/licensing, macOS/Linux.
