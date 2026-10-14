# Local tools

## FFmpeg

Export needs `ffmpeg.exe`. Resolution order:

1. `FFMPEG_PATH` / `CUTLINE_FFMPEG`
2. `tools/ffmpeg/bin/ffmpeg.exe`
3. `ffmpeg` on system `PATH`

This repo may already include a portable build under `tools/ffmpeg/bin/` (gitignored).

If missing, download a Windows build and copy `ffmpeg.exe` (+ `ffprobe.exe`) into `tools/ffmpeg/bin/`, then restart `pnpm dev`.

- https://github.com/BtbN/FFmpeg-Builds/releases (win64)
- or https://www.gyan.dev/ffmpeg/builds/

```powershell
$env:FFMPEG_PATH = "C:\path\to\ffmpeg.exe"
pnpm dev
```
