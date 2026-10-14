import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { RenderPlan } from "../src/domain/renderPlan.ts";

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

export function resolveFfprobePath(): string {
  const ffmpeg = resolveFfmpegPath();
  if (ffmpeg !== "ffmpeg") {
    const sibling = join(
      dirname(ffmpeg),
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
    if (existsSync(sibling)) return sibling;
  }
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const exe = join(dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (existsSync(exe)) return exe;
  }
  return "ffprobe";
}

/** True if the media file has at least one audio stream. */
export function probeHasAudioStream(mediaPath: string): boolean {
  if (!existsSync(mediaPath)) return false;
  const ffprobe = resolveFfprobePath();
  const result = spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      mediaPath,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) return false;
  return String(result.stdout ?? "")
    .toLowerCase()
    .includes("audio");
}

/**
 * Clear includeAudio when the file has no audio track.
 * Avoids FFmpeg: Stream specifier ':a' ... matches no streams.
 */
export function sanitizePlanAudio(plan: RenderPlan): RenderPlan {
  return {
    ...plan,
    clips: plan.clips.map((clip) => {
      if (!clip.includeAudio) return clip;
      if (clip.kind !== "video" && clip.kind !== "audio") return clip;
      if (probeHasAudioStream(clip.assetPath)) return clip;
      return { ...clip, includeAudio: false };
    }),
  };
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
