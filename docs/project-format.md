# Project format

Versioned JSON documents. Media bytes are never embedded — only paths and stable asset IDs.

## Schema (v1 sketch)

- `schemaVersion` — integer; migrations required on bump
- `id`, `name`
- `canvas` — width, height, frameRate
- `tracks[]` — id, kind (`video`|`audio`), order, mute/visibility/lock, volume
- `assets[]` — id, kind, path, metadata, `missing` flag
- `clips[]` — track/asset refs, timeline start, source in/out (exclusive out), speed, transform, volume, optional text

## Time

- Source of truth: integer **ticks** (`TICKS_PER_SECOND = 1_000_000`)
- Convert to frames/seconds only at UI and FFmpeg boundaries
- Clip source ranges: inclusive in, exclusive out

## Paths

- Prefer relative paths when media lives beside the project
- Detect missing media; require user confirmation for relink
- Never silently swap files by filename alone
