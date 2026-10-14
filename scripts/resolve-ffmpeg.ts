import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const CANDIDATES = [
  process.env.FFMPEG_PATH,
  process.env.CUTLINE_FFMPEG,
  "ffmpeg",
  // Common Windows install locations
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  join(process.cwd(), "tools", "ffmpeg", "bin", "ffmpeg.exe"),
  join(process.cwd(), "tools", "ffmpeg", "ffmpeg.exe"),
].filter(Boolean) as string[];

export function resolveFfmpegPath(): string {
  for (const candidate of CANDIDATES) {
    if (candidate === "ffmpeg") continue;
    if (existsSync(candidate)) return candidate;
  }
  // Search PATH explicitly (helps when spawn inherits a thin env)
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const exe = join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (existsSync(exe)) return exe;
  }
  return "ffmpeg";
}

export function ffmpegMissingMessage(tried: string): string {
  return [
    `Cannot find FFmpeg (${tried}).`,
    "Install FFmpeg and restart the terminal / `pnpm dev`.",
    "Quick options:",
    "  winget install --id Gyan.FFmpeg -e",
    "  or set FFMPEG_PATH to the full path of ffmpeg.exe",
    "  or place a build under tools/ffmpeg/bin/ffmpeg.exe",
  ].join(" ");
}
