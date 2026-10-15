# Implementation Plan — React Desktop Video Editor

## 1. Goal

Build a Windows-first desktop video editor inspired by CapCut using **React + TypeScript + Tauri 2 + Rust + FFmpeg**. The deliverable is a locally installed Windows application (`.exe` installer), not a deployed website.

Core editing must work offline. Source videos, project files, thumbnails, cache, and exported videos stay on the user's computer by default. No hosted frontend, cloud video storage, or mandatory backend server is required for the MVP.

This is an original product. Do not copy CapCut branding, proprietary assets, templates, effects, source code, or copyrighted materials. Use original or properly licensed assets, fonts, codecs, and libraries.

## 2. Product Principles

- **Desktop-only delivery:** package the app for Windows; do not deploy a website.
- **React UI:** React + TypeScript is the interface layer.
- **Native integration:** Tauri 2 and Rust handle filesystem operations, native dialogs, process management, and OS integration.
- **Local-first:** all core editing and export functions work offline.
- **Non-destructive editing:** edits modify project metadata, never the source media.
- **Responsive UI:** long-running operations must not block the React UI.
- **Modular design:** separate UI, project model, timeline, media probing, preview, and rendering.
- **Incremental delivery:** keep the project buildable and tested after every milestone.

## 3. MVP Scope

1. Windows desktop shell and installer.
2. Create, open, save, and reopen local projects.
3. Import local video, audio, and image files.
4. Media bin with thumbnails and basic metadata.
5. Multi-track timeline with clip placement, selection, move, trim, split, and delete.
6. Preview playback and seeking.
7. Basic video transforms, audio volume, and text/title overlays.
8. Export MP4 using FFmpeg.
9. Export progress, useful errors, and cancellation where safe.
10. Autosave/recovery and missing-media relinking.
11. Undo/redo and basic keyboard shortcuts.
12. Core editing and export work without an Internet connection.

### Out of scope for the first MVP

- Cloud storage, cloud projects, or cloud video uploads.
- Collaboration and team workspaces.
- AI generation, AI avatars, and text-to-video.
- Stock-media marketplace.
- Advanced motion tracking, advanced masks, advanced color grading, or a large effect marketplace.
- Subscription/payment systems and DRM.
- Mobile versions.
- Complete feature parity with CapCut.

Keep future extension points for effects, transitions, keyframes, subtitles, templates, and optional licensing, but do not implement all of them before the core editing/export path is reliable.

## 4. Recommended Technology Stack

### Frontend

- **React + TypeScript + Vite**. Use Vite rather than Next.js because this is a local desktop application and does not need a Next.js web server.
- **Tauri 2** to package the frontend as a Windows desktop app.
- **Rust** for Tauri commands and native operations.
- **Zustand** for editor UI state. Keep persisted project state distinct from transient UI state.
- **CSS Modules, Tailwind CSS, or another consistent styling approach**; choose one and avoid mixing styling systems without a reason.
- React components for panels, media bin, inspector, dialogs, toolbar, and timeline controls.
- Canvas/SVG/DOM for timeline rendering; evaluate Canvas or WebGL only when profiling demonstrates a need.

### Media

- **FFmpeg/ffprobe** for media probing, decoding/encoding, filters, audio processing, and export.
- Invoke FFmpeg as a child process from Rust using explicit argument arrays, not shell command strings.
- Wrap media probing and rendering behind interfaces so the implementation can evolve.
- For preview, start with browser video playback for individual source clips and validate the multi-track compositing requirement early. The final timeline preview may need a dedicated compositing/cache pipeline; do not assume a normal HTML video element can preview an arbitrary multi-track timeline.
- Web Workers may be used for CPU-heavy JavaScript tasks, but they are not a replacement for native FFmpeg export.

### Local persistence

- Versioned JSON files for project documents in the first version.
- SQLite is optional for recent projects, preferences, and indexing; do not add it unless needed.
- Store app settings, autosaves, thumbnails, and cache in Tauri's application data/cache directories.
- Never embed video bytes in project JSON or SQLite; reference media paths and stable asset IDs.
- Support a project bundle or folder-based workflow if portability requires copying media alongside the project.

### Tooling and packaging

- Windows 10/11 x64 initially.
- Node.js and pnpm.
- Rust stable toolchain and Windows build prerequisites required by Tauri.
- Tauri bundler for Windows installer output (`.exe` installer and/or `.msi`, depending on configuration).
- Bundle or install FFmpeg components in compliance with their licenses.
- Pin dependency versions and document reproducible development and release builds.

## 5. Architecture

Use a modular desktop monolith. Do not create microservices or a backend server for local editing.

### Logical modules

- `src/app/`: application startup, routing/view switching, global providers.
- `src/components/`: reusable UI components.
- `src/features/editor/`: editor shell, toolbar, panels, dialogs.
- `src/features/media-bin/`: imported media list, thumbnails, metadata.
- `src/features/timeline/`: tracks, clips, selection, drag/drop, snapping, editing commands.
- `src/features/preview/`: playback controls, playhead, preview surface.
- `src/features/inspector/`: clip properties and effect parameters.
- `src/features/export/`: export dialog, presets, progress, errors.
- `src/stores/`: Zustand stores for UI state and command/history state.
- `src/domain/`: project schema, timeline model, time math, validation, render-plan types.
- `src/lib/`: typed Tauri API wrappers, utilities, error handling.
- `src-tauri/src/commands/`: Rust commands exposed to the frontend.
- `src-tauri/src/media/`: FFmpeg/ffprobe invocation, media probing, thumbnails.
- `src-tauri/src/project/`: project file operations, validation, autosave.
- `src-tauri/src/render/`: render-plan validation, FFmpeg argument construction, job lifecycle.
- `src-tauri/src/storage/`: app directories, cache, temporary files.
- `src-tauri/capabilities/`: Tauri permissions/capabilities, scoped to the minimum required.
- `tests/`: frontend/domain and integration tests.
- `docs/`: architecture, project format, rendering, licensing.

Suggested repository layout:

```text
desktop-video-editor/
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── index.html
├── README.md
├── docs/
│   ├── architecture.md
│   ├── project-format.md
│   ├── rendering.md
│   └── licensing.md
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── editor/
│   │   ├── media-bin/
│   │   ├── timeline/
│   │   ├── preview/
│   │   ├── inspector/
│   │   └── export/
│   ├── stores/
│   ├── domain/
│   ├── lib/
│   └── styles/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs
│       ├── commands/
│       ├── media/
│       ├── project/
│       ├── render/
│       └── storage/
├── assets/
│   └── test-media/
└── tests/
    ├── unit/
    └── integration/
```

Adjust the structure to fit the generated Tauri template, but preserve the module boundaries.

## 6. Frontend-to-Native Boundary

Use typed Tauri commands for native capabilities. Do not expose unrestricted filesystem or process execution to the frontend.

Expected command/API groups:

- Project: create, open, save, autosave, recover, validate.
- Media: select/import files, probe metadata, generate thumbnails, check availability, relink.
- Render: validate project, start export, query job status, cancel export.
- Storage: resolve app cache/data directories, clear app-owned cache.
- Settings: load/save application preferences.

Requirements:

- Define request/response TypeScript types for every command.
- Validate all command inputs again in Rust; frontend validation alone is insufficient.
- Use Tauri capabilities and allowlists/scoped permissions as narrowly as possible.
- Never execute a command or path supplied as an arbitrary string from the UI.
- Stream or poll progress in a controlled way; do not send a high-frequency event for every frame.
- Return structured errors with a safe user-facing message and diagnostic details for logs.

## 7. Project Data Model

Define and document a versioned project schema before implementing timeline editing.

A project should contain:

- `schemaVersion`
- project ID and name
- canvas width, height, frame rate, and aspect ratio
- tracks with stable IDs, type, order, mute/visibility/lock state, and volume where applicable
- imported media assets with stable IDs and metadata
- clips referencing asset IDs and track IDs
- clip timeline start, source in/out, playback speed, transform, opacity, volume, and effects
- title/text content and styling
- transitions and keyframes when implemented
- export settings where appropriate

### Time representation

- Avoid floating-point seconds as the sole source of truth for timeline positions.
- Prefer integer ticks or rational time values; document conversions to frame indices and FFmpeg timestamps.
- Handle variable-frame-rate input deliberately.
- Define inclusive/exclusive source ranges and timeline interval semantics.
- Test frame rounding and clip boundary conditions.

### File paths and relinking

- Store paths in a way that supports moving a project folder.
- Support relative paths where possible and retain enough metadata to offer relinking.
- Never silently substitute a different file with the same filename without confirmation.
- Show missing-media state and block or warn before rendering an incomplete project.

## 8. Timeline and Editing Semantics

Implement editing operations as commands so they can be undone and redone.

Required commands:

- Add/remove track.
- Add/remove clip.
- Move clip between positions and tracks.
- Trim clip start/end without changing source media.
- Split clip at a valid timeline position.
- Delete selected clips.
- Change clip properties.
- Undo/redo commands.
- Snap to playhead, clip edges, and markers as a configurable behavior.

Requirements:

- Clearly define overlapping-clip compositing.
- Define track order and video/audio track behavior.
- Prevent invalid or negative durations.
- Keep transient UI state separate from persisted project state.
- Autosave only valid state and avoid corrupting the last known-good save.
- Test split, trim, move, undo/redo, frame rounding, and edge cases.

## 9. Media Import and Preview

### Import

- Use native file dialogs through Tauri.
- Validate file existence and readability.
- Probe media asynchronously via Rust/FFprobe.
- Show progress for expensive thumbnail generation.
- Support video, audio, and still images in the MVP.
- Display useful errors for unsupported, corrupt, or inaccessible files.
- Never block the UI thread while probing or decoding.

### Preview

- Implement play, pause, seek, and playhead display.
- Keep preview responsive during timeline edits.
- Use lower-resolution/proxy preview when needed, while preserving full-quality export.
- Cache thumbnails and waveform data with a bounded cache policy.
- Define a strategy for multiple overlapping video/audio tracks.
- Test seeking near clip boundaries, clips with different frame rates, audio/video offsets, and portrait footage.

A single-file player is not sufficient evidence that multi-track timeline preview works. Validate this architecture early.

## 10. Rendering and Export

Create a `RenderService` and a render-plan representation independent of React components.

The render pipeline should:

1. Validate the project and media references.
2. Snapshot project state for the render job.
3. Build a deterministic render plan.
4. Generate a safe FFmpeg argument list/filter graph.
5. Launch FFmpeg from Rust without blocking the UI.
6. Capture logs and parse progress.
7. Report progress, success, failure, and cancellation state.
8. Write to a temporary output path, then finalize the file only after successful rendering.
9. Preserve diagnostics without logging unnecessary sensitive data.

### MVP export options

- MP4 container.
- H.264 video and AAC audio where available and legally distributable.
- Resolution presets: source, 720p, 1080p.
- Frame-rate options constrained by project settings.
- Quality/bitrate preset.
- User-selected output path.

### Rendering correctness

- Preview and export must use the same documented semantics for trims, track order, transforms, and audio levels.
- Validate output with `ffprobe`.
- Test audio/video synchronization, aspect ratio, rotation metadata, portrait and landscape media, no-audio clips, mixed frame rates, and missing media.
- Never build FFmpeg commands by concatenating untrusted strings. Use a process API with explicit arguments and validated filter parameters.
- Cancellation must terminate the process safely and clean up temporary files.
- Do not claim GPU acceleration unless the selected encoder and hardware path are detected and verified.

## 11. Performance and Reliability

- Keep probing, thumbnail generation, waveform generation, filesystem operations, and rendering off the UI thread.
- Bound thumbnail, waveform, and preview caches.
- Avoid loading full-resolution video into memory unnecessarily.
- Add configurable preview quality and render concurrency.
- Handle disk-full conditions, permission errors, locked files, and process crashes.
- Use atomic save/replace patterns and maintain recoverable autosaves.
- Provide crash diagnostics and user-readable error messages.
- Never delete original source media.
- Clean up only app-owned temporary/cache files.

## 12. Security and Licensing

- Treat imported media and metadata as untrusted input.
- Validate paths and avoid arbitrary command execution.
- Invoke FFmpeg from Rust using explicit arguments; never use a shell command assembled from user input.
- Restrict filesystem access to paths the user selected or app-owned directories.
- Review licenses for Tauri, Qt is not required, FFmpeg, fonts, codecs, icons, and every bundled third-party library before commercial distribution.
- Confirm whether the selected FFmpeg build is LGPL/GPL and meet its obligations. Do not assume every codec or build is freely redistributable.
- Do not bundle proprietary stock media or copyrighted templates without appropriate rights.
- Core editing and export must not require Internet access.

## 13. Testing Strategy

### Unit tests

- Project schema validation and migration.
- Time/frame conversion.
- Timeline commands and undo/redo.
- Clip split/trim/move invariants.
- Render-plan generation.
- FFmpeg argument construction and parameter validation.
- Cache keying and invalidation.
- TypeScript command-wrapper error handling.

### Integration tests

- Import and probe test media.
- Generate thumbnails and waveforms.
- Save, close, and reopen projects.
- Missing-media and relink flows.
- Render short projects and validate outputs with `ffprobe`.
- Cancel a render and confirm cleanup.
- Test project recovery after simulated interruption.
- Verify typed frontend/native command contracts.

### Manual QA

- Windows 10/11 on a clean machine.
- Paths containing spaces and non-ASCII characters.
- Portrait/landscape, variable-frame-rate, and mixed-frame-rate sources.
- Long filenames and large media files.
- Low disk space and restricted output directories.
- Repeated open/save/export cycles.
- Core editing works with network disconnected.
- Installer works without a development environment installed.

Use small, legally redistributable fixtures in automated tests. Do not depend on user-owned media in CI.

## 14. Implementation Milestones

### Milestone 0 — Desktop shell and feasibility spike

Deliverables:
- React + TypeScript + Vite frontend.
- Tauri 2 + Rust desktop shell.
- Reproducible Windows development setup.
- Typed frontend-to-Rust command example.
- FFmpeg probe/export proof of concept.
- Preview-backend decision record.
- Basic CI build and unit-test command.

Acceptance criteria:
- App launches as a desktop window on a Windows development machine.
- Imports a sample video and reads metadata through Rust/FFprobe.
- Exports a short sample clip through FFmpeg.
- UI remains responsive during export.
- No web deployment or server runtime is required.
- Licensing notes are documented.

### Milestone 1 — Project and media foundation

Deliverables:
- Project schema and versioning.
- Create/open/save project.
- Media import and media bin.
- Thumbnail generation and local cache.
- Autosave/recovery foundation.

Acceptance criteria:
- Project survives app restart.
- Original files remain untouched.
- Missing media is clearly detected.

### Milestone 2 — Basic timeline

Deliverables:
- Track and clip models.
- Multi-track timeline UI in React.
- Selection, move, trim, split, delete.
- Playhead, zoom, scroll, snapping.
- Undo/redo.

Acceptance criteria:
- Editing operations preserve model invariants.
- Unit tests cover core editing operations.
- UI remains responsive with a representative number of clips.

### Milestone 3 — Preview

Deliverables:
- Playback and seeking.
- Basic compositing of overlapping clips.
- Audio playback/mixing strategy.
- Preview cache/proxy strategy if required.

Acceptance criteria:
- Preview handles supported MVP track types.
- Seek and playback work across clip boundaries.
- Preview limitations are documented.

### Milestone 4 — Export

Deliverables:
- Render-plan generator.
- FFmpeg rendering integration through Rust.
- Export dialog, progress, failure diagnostics, and cancellation.
- Output validation.

Acceptance criteria:
- A multi-clip project renders to a valid MP4.
- Trims, track order, transforms, and audio levels match documented semantics.
- Failed or cancelled renders do not leave a corrupt final output.

### Milestone 5 — MVP polish and packaging

Deliverables:
- Titles/text overlays.
- Basic transforms and volume controls.
- Keyboard shortcuts.
- User settings and recent projects.
- Windows installer, app icon, versioning, and update strategy decision.

Acceptance criteria:
- Installer works on a clean supported Windows machine.
- Required runtime components are bundled or clearly installed.
- Core editing works offline.
- README documents build, test, package, and known limitations.

### Later milestones — Pro features

Implement only after the MVP pipeline is reliable:

- **URGENT — Detach audio from video + cut audio**
  - When reading/importing a video that has an audio stream, extract the soundtrack into a separate audio asset (FFmpeg `-vn` copy/re-encode) while keeping the video usable muted or linked.
  - Place video and audio on separate timeline tracks so the user can mute, move, trim, and split the music/dialogue independently (“cắt nhạc”).
  - Optional link/lock so A/V stay tied until the user explicitly unlinks; preview and export must stay in sync for linked pairs and correct when only audio is cut.
  - Acceptance: import a sample MP4 with audio → get an audio clip (or linked pair) → trim/split audio without requiring a matching video cut → export keeps intended A/V relationship.
- Keyframes and animation curves.
- Transitions and effect stack.
- Color correction and LUT support.
- Chroma key and masks.
- Captions/subtitles and waveform improvements.
- Proxy workflows and advanced caching.
- Template system.
- Optional AI integrations.
- Optional subscription/licensing.
- macOS/Linux support if justified by product priorities.

## 15. Instructions for the AI Coding Agent

Work incrementally and keep the app buildable after every milestone.

1. First inspect the repository and report its current structure, toolchain, and existing code. Do not overwrite or delete existing work without justification.
2. Read the entire plan and propose a concise implementation checklist before broad changes.
3. Start with Milestone 0. Do not implement the full feature list in one giant change.
4. Before adding a dependency, explain why it is needed and verify compatibility and license.
5. Prefer small modules with explicit interfaces over large monolithic files.
6. Add tests alongside core logic, especially time arithmetic, timeline commands, serialization, and render-plan generation.
7. Keep React UI separate from project/media domain logic and Rust native operations.
8. Never block the React UI thread with FFmpeg, probing, thumbnail generation, or waveform work.
9. Never mutate source media. Editing must remain non-destructive.
10. Do not expose unrestricted filesystem or process execution to the frontend.
11. Do not fake functionality with placeholder buttons that appear to work. Clearly mark unfinished features.
12. Do not claim a feature is complete without implementation and a relevant test or reproducible manual verification.
13. After each milestone, report files created/changed, architecture decisions, commands executed, build/test results, known issues, and next steps.
14. If the environment lacks Windows, Rust, FFmpeg, or other required tooling, report the limitation and exact verification steps; do not claim an unexecuted build succeeded.
15. Keep `README.md`, `docs/architecture.md`, `docs/project-format.md`, `docs/rendering.md`, and `docs/licensing.md` current.
16. Avoid microservices, cloud storage, accounts, telemetry, or online dependencies unless explicitly approved. Core editing and export must work offline.

## 16. MVP Definition of Done

The MVP is complete only when:

- A user can install and launch the Windows desktop app.
- A user can create, save, close, reopen, and recover a project.
- A user can import local video/audio/image files.
- A user can arrange clips across multiple tracks, trim, split, move, and delete clips.
- The user can preview the supported timeline.
- The user can export a multi-clip project to a valid MP4.
- Export progress and failure states are understandable.
- Original media files are never modified or deleted.
- Missing media is detected and can be relinked.
- Core editing and export work without Internet access.
- Automated tests pass, and the Windows packaging procedure is documented.
- Known limitations and third-party license obligations are documented.
