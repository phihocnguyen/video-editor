# Licensing notes

Review before commercial distribution. This file tracks obligations; it is not legal advice.

## Stack (to verify per release)

| Component | Notes |
| --- | --- |
| Tauri 2 / Rust crates | Check each crate license |
| React / Vite / Zustand | Typically MIT-compatible; confirm lockfile |
| FFmpeg / ffprobe | LGPL vs GPL depends on **build and codecs**. Prefer an LGPL build for redistribution when possible; document exact binary source and configure flags |
| Fonts / icons | Use original or properly licensed assets only |

## Product policy

- No CapCut branding, proprietary assets, templates, or source
- No bundling of copyrighted stock media without rights
- Core editing/export must not require network access

## Action items (Milestone 0+)

- [ ] Pin and document the FFmpeg build used in CI/dev
- [ ] Generate third-party license notice for the installer
- [ ] Confirm NSIS/installer redistributable components
