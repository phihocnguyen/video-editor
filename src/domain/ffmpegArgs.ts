import type { RenderClipPlan, RenderPlan } from "./renderPlan";

export interface BuiltFfmpegCommand {
  program: string;
  args: string[];
  tempOutput: string;
}

export interface BuildFfmpegOptions {
  /** Defaults to always-true (tests). CLI should pass `existsSync`. */
  fileExists?: (path: string) => boolean;
}

/** Build explicit FFmpeg argv from a render plan (CLI + same semantics as Rust export). */
export function buildFfmpegArgs(
  plan: RenderPlan,
  outputPath: string,
  options?: BuildFfmpegOptions,
): BuiltFfmpegCommand {
  const fileExists = options?.fileExists ?? (() => true);

  if (plan.missingAssetIds.length > 0) {
    throw new Error("Project has missing media; relink before export");
  }
  if (plan.durationSec <= 0) {
    throw new Error("Render duration must be > 0");
  }

  const width = Math.max(2, plan.width - (plan.width % 2));
  const height = Math.max(2, plan.height - (plan.height % 2));
  const fps = plan.frameRate > 0 ? plan.frameRate : 30;
  const duration = plan.durationSec;

  const visuals = plan.clips
    .filter((c) => c.kind === "video" || c.kind === "image")
    .slice()
    .sort(
      (a, b) =>
        a.trackOrder - b.trackOrder || a.timelineStartSec - b.timelineStartSec,
    );

  const audios = plan.clips.filter(
    (c) => c.includeAudio && (c.kind === "audio" || c.kind === "video"),
  );

  for (const clip of [...visuals, ...audios]) {
    if (clip.assetPath.startsWith("blob:")) {
      throw new Error("Cannot export browser blob URLs; use filesystem paths");
    }
    if (!fileExists(clip.assetPath)) {
      throw new Error(`Media file missing: ${clip.assetPath}`);
    }
  }

  const tempOutput = outputPath.replace(/(\.mp4)?$/i, ".tmp.mp4");
  const args: string[] = ["-y", "-hide_banner"];

  args.push(
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
  );

  for (const clip of visuals) {
    const sourceDur = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
    if (clip.kind === "image") {
      const clipDur = Math.max(0.01, clip.timelineEndSec - clip.timelineStartSec);
      args.push("-loop", "1", "-t", clipDur.toFixed(3), "-i", clip.assetPath);
    } else {
      args.push(
        "-ss",
        Math.max(0, clip.sourceInSec).toFixed(3),
        "-t",
        sourceDur.toFixed(3),
        "-i",
        clip.assetPath,
      );
    }
  }

  const audioOnly: { inputIndex: number; clip: RenderClipPlan }[] = [];
  let audioOnlyOffset = 1 + visuals.length;
  for (const clip of audios) {
    if (clip.kind !== "audio") continue;
    const sourceDur = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
    args.push(
      "-ss",
      Math.max(0, clip.sourceInSec).toFixed(3),
      "-t",
      sourceDur.toFixed(3),
      "-i",
      clip.assetPath,
    );
    audioOnly.push({ inputIndex: audioOnlyOffset, clip });
    audioOnlyOffset += 1;
  }

  const filter = buildFilterComplex(plan, visuals, audioOnly, width, height, fileExists);
  args.push("-filter_complex", filter, "-map", "[outv]");

  if (audios.length > 0) {
    args.push("-map", "[outa]", "-c:a", "aac", "-b:a", plan.audioBitrate);
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-b:v",
    plan.videoBitrate,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    tempOutput,
  );

  return { program: "ffmpeg", args, tempOutput };
}

function buildFilterComplex(
  plan: RenderPlan,
  visuals: RenderClipPlan[],
  audioOnly: { inputIndex: number; clip: RenderClipPlan }[],
  width: number,
  height: number,
  fileExists: (path: string) => boolean,
): string {
  const parts: string[] = [];
  let current = "[0:v]";

  visuals.forEach((clip, index) => {
    const inputIndex = index + 1;
    const start = Math.max(0, clip.timelineStartSec);
    const end = Math.max(start + 0.01, clip.timelineEndSec);
    const speed = clip.speed > 0 ? clip.speed : 1;
    const opacity = Math.min(1, Math.max(0, clip.opacity));
    const setpts =
      Math.abs(speed - 1) < 0.001
        ? "setpts=PTS-STARTPTS"
        : `setpts=(PTS-STARTPTS)/${speed}`;
    parts.push(
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,${setpts},format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[v${index}]`,
    );
    const next = `[tmp${index}]`;
    parts.push(
      `${current}[v${index}]overlay=0:0:format=auto:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${next}`,
    );
    current = next;
  });

  plan.texts.forEach((text, ti) => {
    const start = Math.max(0, text.timelineStartSec);
    const end = Math.max(start + 0.01, text.timelineEndSec);
    const escaped = escapeDrawtext(text.content);
    const fontfile =
      text.fontPath && fileExists(text.fontPath)
        ? `:fontfile=${escapeFilterPath(text.fontPath)}`
        : "";
    const fontsize = Math.max(8, text.fontSize);
    const color = normalizeColor(text.color);
    const alpha = Math.min(1, Math.max(0, text.opacity));
    const xExpr =
      text.align === "left"
        ? `${Math.max(0, Math.round(text.x))}`
        : text.align === "right"
          ? `${Math.max(0, Math.round(text.x))}-text_w`
          : `${Math.max(0, Math.round(text.x))}-(text_w/2)`;
    const yExpr = `${Math.max(0, Math.round(text.y))}-(text_h/2)`;
    const next = `[txt${ti}]`;
    parts.push(
      `${current}drawtext=text='${escaped}'${fontfile}:fontsize=${fontsize}:fontcolor=${color}@${alpha.toFixed(3)}:x=${xExpr}:y=${yExpr}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${next}`,
    );
    current = next;
  });

  if (current !== "[outv]") {
    parts.push(`${current}null[outv]`);
  }

  const audioLabels: string[] = [];
  let ai = 0;

  visuals.forEach((clip, index) => {
    if (clip.kind !== "video" || !clip.includeAudio) return;
    const inputIndex = index + 1;
    const startMs = Math.round(Math.max(0, clip.timelineStartSec) * 1000);
    const vol = Math.min(2, Math.max(0, clip.volume));
    const speed = clip.speed > 0 ? clip.speed : 1;
    const atempo = atempoChain(speed);
    const label = `[a${ai}]`;
    parts.push(
      `[${inputIndex}:a]asetpts=PTS-STARTPTS,${atempo}volume=${vol},adelay=${startMs}|${startMs},apad,atrim=0:${plan.durationSec.toFixed(3)}${label}`,
    );
    audioLabels.push(label);
    ai += 1;
  });

  for (const { inputIndex, clip } of audioOnly) {
    if (!clip.includeAudio) continue;
    const startMs = Math.round(Math.max(0, clip.timelineStartSec) * 1000);
    const vol = Math.min(2, Math.max(0, clip.volume));
    const speed = clip.speed > 0 ? clip.speed : 1;
    const atempo = atempoChain(speed);
    const label = `[a${ai}]`;
    parts.push(
      `[${inputIndex}:a]asetpts=PTS-STARTPTS,${atempo}volume=${vol},adelay=${startMs}|${startMs},apad,atrim=0:${plan.durationSec.toFixed(3)}${label}`,
    );
    audioLabels.push(label);
    ai += 1;
  }

  if (audioLabels.length === 1) {
    parts.push(`${audioLabels[0]}anull[outa]`);
  } else if (audioLabels.length > 1) {
    parts.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:dropout_transition=0:normalize=0[outa]`,
    );
  }

  return parts.join(";");
}

function atempoChain(speed: number): string {
  if (Math.abs(speed - 1) < 0.001) return "";
  let remaining = speed;
  const filters: string[] = [];
  while (remaining > 2 + 1e-6) {
    filters.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-6) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return `${filters.join(",")},`;
}

function escapeDrawtext(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "%%")
    .replace(/\n/g, "\\n");
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") && (trimmed.length === 7 || trimmed.length === 4)) {
    return `0x${trimmed.slice(1)}`;
  }
  return "white";
}
