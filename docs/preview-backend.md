# ADR: Preview backend (Milestone 0)

## Status

Accepted for MVP direction; revisit after Milestone 3 profiling.

## Context

Multi-track timelines with overlaps, transforms, and text cannot be faithfully previewed by a single HTML `<video>` element pointing at one source file.

## Decision

1. **Milestone 0–2:** keep preview panel as a clear placeholder; do not fake multi-track compositing.
2. **Milestone 3:** implement playback/seek against the timeline model. Start with sequential/active-clip browser decode where possible; add a Rust/FFmpeg-backed proxy or frame cache if compositing gaps appear.
3. **Export (Milestone 4)** remains the correctness path via FFmpeg filter graph; preview may be lower fidelity but must share trim/track/transform semantics documented in `rendering.md`.

## Consequences

- Early demos must label preview limitations.
- Do not block timeline editing on perfect preview.
- Invest in shared domain semantics so preview and export do not diverge silently.
