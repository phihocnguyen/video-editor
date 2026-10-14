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
- Resolution presets: canvas / 720p / 1080p
- Quality presets: draft / standard / high (video + audio bitrates)
- Honors clip opacity, speed, track mute/volume/order, text opacity
- User-selected output path
- Post-export `ffprobe` validation note on the job message

## Safety

- Never concatenate untrusted strings into a shell command
- Write to temp, then atomic replace
- Cancel must terminate the child process and remove incomplete finals
