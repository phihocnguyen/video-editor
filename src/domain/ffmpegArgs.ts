import { ffmpegVideoEffectsChain } from "./effects";
import type { RenderClipPlan, RenderPlan } from "./renderPlan";
import { transitionDurationSec, type TransitionType } from "./transitions";

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
    const overlap = Math.max(0, clip.transitionOverlapSec);
    const sourceDur = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
    if (clip.kind === "image") {
      // Hold for outgoing transition is added via tpad in the filter graph.
      const clipDur =
        Math.max(0.01, clip.timelineEndSec - clip.timelineStartSec) + overlap;
      args.push("-loop", "1", "-t", clipDur.toFixed(3), "-i", clip.assetPath);
    } else {
      const speed = clip.speed > 0 ? clip.speed : 1;
      const earlySource = overlap * speed;
      const ss = Math.max(0, clip.sourceInSec - earlySource);
      const trimmedEarly = clip.sourceInSec - ss;
      args.push(
        "-ss",
        ss.toFixed(3),
        "-t",
        (sourceDur + trimmedEarly).toFixed(3),
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

/** Map editor transition → FFmpeg xfade name (null = hard cut / concat). */
function xfadeTransitionName(type: TransitionType): string | null {
  switch (type) {
    case "dissolve":
      return "fade";
    case "fade":
      return "fadeblack";
    case "wipeLeft":
      return "wipeleft";
    case "wipeRight":
      return "wiperight";
    default:
      return null;
  }
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
  parts.push(`[0:v]format=rgba[base]`);
  let current = "[base]";

  // Group by track (already sorted by trackOrder, then start).
  const trackIds: string[] = [];
  const byTrack = new Map<string, { clip: RenderClipPlan; inputIndex: number }[]>();
  visuals.forEach((clip, index) => {
    const inputIndex = index + 1;
    if (!byTrack.has(clip.trackId)) {
      byTrack.set(clip.trackId, []);
      trackIds.push(clip.trackId);
    }
    byTrack.get(clip.trackId)!.push({ clip, inputIndex });
  });

  trackIds.forEach((trackId, ti) => {
    const group = byTrack.get(trackId)!;
    const trackLabel = buildTrackChain(parts, group, width, height, ti);
    const next = `[mix${ti}]`;
    parts.push(
      `${current}${trackLabel}overlay=x=0:y=0:format=rgb:eof_action=pass${next}`,
    );
    current = next;
  });

  plan.texts.forEach((text, ti) => {
    const start = Math.max(0, text.timelineStartSec);
    const end = Math.max(start + 0.01, text.timelineEndSec);
    const escaped = escapeDrawtext(text.content);
    const resolvedFont = resolveDrawtextFont(text.fontPath, fileExists);
    const fontfile = resolvedFont
      ? `:fontfile=${quoteFilterPath(resolvedFont)}`
      : "";
    const fontsize = Math.max(8, Math.round(text.fontSize));
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

/**
 * Build one video track: prepare clips, chain with xfade (matches preview transitions).
 * Returns a label like `[trk0]` whose PTS starts at timeline 0 (leading black pad if needed).
 */
function buildTrackChain(
  parts: string[],
  group: { clip: RenderClipPlan; inputIndex: number }[],
  width: number,
  height: number,
  trackIndex: number,
): string {
  const origin = group[0]!.clip.timelineStartSec;

  group.forEach(({ clip, inputIndex }, i) => {
    const start = Math.max(0, clip.timelineStartSec);
    const end = Math.max(start + 0.01, clip.timelineEndSec);
    const speed = clip.speed > 0 ? clip.speed : 1;
    const opacity = Math.min(1, Math.max(0, clip.opacity));
    const early = Math.max(0, clip.transitionOverlapSec);
    const clipDur = Math.max(0.01, end - start);
    const next = group[i + 1]?.clip;
    const hold =
      next && next.transitionIn.type !== "none"
        ? Math.max(0, next.transitionOverlapSec)
        : 0;
    const setpts =
      Math.abs(speed - 1) < 0.001
        ? "setpts=PTS-STARTPTS"
        : `setpts=(PTS-STARTPTS)/${speed}`;

    const fx = ffmpegVideoEffectsChain(clip.effects, clipDur, {
      delaySec: early,
    });
    const bits: string[] = [
      `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      setpts,
      "format=rgba",
    ];
    if (fx) bits.push(fx);

    // First clip on track with transitionIn: RGB fade from black (preview over empty stage).
    if (i === 0 && early > 0.001 && clip.transitionIn.type !== "none") {
      const inFull = transitionDurationSec(clip.transitionIn);
      if (clip.transitionIn.type === "fade") {
        bits.push(
          `fade=t=in:st=${(inFull / 2).toFixed(3)}:d=${(inFull / 2).toFixed(3)}`,
        );
      } else {
        bits.push(`fade=t=in:st=0:d=${inFull.toFixed(3)}`);
      }
    }

    if (hold > 0.001) {
      bits.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`);
    }
    if (opacity < 0.999) {
      bits.push(`colorchannelmixer=aa=${opacity.toFixed(3)}`);
    }
    parts.push(`${bits.join(",")}[c${trackIndex}_${i}]`);
  });

  let acc = `[c${trackIndex}_0]`;
  for (let i = 1; i < group.length; i += 1) {
    const curr = group[i]!.clip;
    const xname = xfadeTransitionName(curr.transitionIn.type);
    const out =
      i === group.length - 1 ? `[xf${trackIndex}_last]` : `[xf${trackIndex}_${i}]`;
    const useXfade = xname && curr.transitionOverlapSec > 0.001;

    if (useXfade) {
      const dur = transitionDurationSec(curr.transitionIn);
      const offset = Math.max(
        0,
        curr.timelineStartSec - origin - curr.transitionOverlapSec,
      );
      parts.push(
        `${acc}[c${trackIndex}_${i}]xfade=transition=${xname}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}${out}`,
      );
    } else {
      // Hard cut — concatenate (clips should abut).
      parts.push(`${acc}[c${trackIndex}_${i}]concat=n=2:v=1:a=0${out}`);
    }
    acc = out;
  }

  const trackOut = `[trk${trackIndex}]`;
  if (origin > 0.001) {
    parts.push(
      `${acc}tpad=start_mode=add:start_duration=${origin.toFixed(3)}:color=black@0${trackOut}`,
    );
  } else if (acc !== trackOut) {
    parts.push(`${acc}null${trackOut}`);
  }
  return trackOut;
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

/** FFmpeg drawtext needs a real TTF/OTF path; UI fonts like Manrope often have none. */
function resolveDrawtextFont(
  fontPath: string | null,
  fileExists: (path: string) => boolean,
): string | null {
  if (fontPath && fileExists(fontPath)) return fontPath;
  const fallbacks = [
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const candidate of fallbacks) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
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

/** Quote a filesystem path for FFmpeg filter option values (fontfile=…). */
function quoteFilterPath(path: string): string {
  return `'${escapeFilterPath(path).replace(/'/g, "\\'")}'`;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") && (trimmed.length === 7 || trimmed.length === 4)) {
    return `0x${trimmed.slice(1)}`;
  }
  return "white";
}
