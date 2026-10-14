# Rendering

Export is driven by a **render plan** independent of React UI.

## Pipeline

1. Validate project + media references
2. Snapshot project state for the job
3. Build deterministic render plan
4. Construct FFmpeg argv + filter graph (explicit args only)
5. Run FFmpeg from Rust without blocking the UI
6. Parse progress; support cancel + temp cleanup
7. Finalize output path only after success
8. Validate with ffprobe

## MVP targets

- Container: MP4
- Video: H.264; Audio: AAC (subject to redistributable FFmpeg build)
- Presets: source / 720p / 1080p
- User-selected output path

## Safety

- Never concatenate untrusted strings into a shell command
- Write to temp, then atomic replace
- Cancel must terminate the child process and remove incomplete finals
