import type { ProjectDocument } from "./project";
import { clipDurationTicks } from "./timelineCommands";
import { ticksToSeconds } from "./time";

export type RenderResolutionPreset = "source" | "720" | "1080";

export interface RenderClipPlan {
  clipId: string;
  trackId: string;
  assetPath: string;
  timelineStartSec: number;
  timelineEndSec: number;
  sourceInSec: number;
  sourceOutSec: number;
  volume: number;
  kind: "video" | "audio" | "image";
}

export interface RenderTextPlan {
  clipId: string;
  content: string;
  fontFamily: string;
  fontPath: string | null;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  timelineStartSec: number;
  timelineEndSec: number;
}

export interface RenderPlan {
  width: number;
  height: number;
  frameRate: number;
  durationSec: number;
  clips: RenderClipPlan[];
  texts: RenderTextPlan[];
  missingAssetIds: string[];
}

export function buildRenderPlan(
  project: ProjectDocument,
  preset: RenderResolutionPreset = "1080",
): RenderPlan {
  const missingAssetIds = project.assets.filter((a) => a.missing).map((a) => a.id);
  const assetsById = new Map(project.assets.map((a) => [a.id, a]));

  let durationTicks = 0;
  const clips: RenderClipPlan[] = [];
  const texts: RenderTextPlan[] = [];

  for (const clip of project.clips) {
    const end = clip.startTicks + clipDurationTicks(clip);
    durationTicks = Math.max(durationTicks, end);

    if (clip.kind === "text" && clip.text) {
      texts.push({
        clipId: clip.id,
        content: clip.text.content,
        fontFamily: clip.text.fontFamily,
        fontPath: clip.text.fontPath,
        fontSize: clip.text.fontSize,
        color: clip.text.color,
        align: clip.text.align,
        x: clip.transform.x,
        y: clip.transform.y,
        timelineStartSec: ticksToSeconds(clip.startTicks),
        timelineEndSec: ticksToSeconds(end),
      });
      continue;
    }

    if (clip.kind !== "media" || !clip.assetId) continue;
    const asset = assetsById.get(clip.assetId);
    if (!asset) continue;
    clips.push({
      clipId: clip.id,
      trackId: clip.trackId,
      assetPath: asset.path,
      timelineStartSec: ticksToSeconds(clip.startTicks),
      timelineEndSec: ticksToSeconds(end),
      sourceInSec: ticksToSeconds(clip.sourceInTicks),
      sourceOutSec: ticksToSeconds(clip.sourceOutTicks),
      volume: clip.volume,
      kind: asset.kind,
    });
  }

  const { width, height } = resolveSize(project, preset);

  return {
    width,
    height,
    frameRate: project.canvas.frameRate,
    durationSec: Math.max(ticksToSeconds(durationTicks), 0.1),
    clips,
    texts,
    missingAssetIds,
  };
}

function resolveSize(
  project: ProjectDocument,
  preset: RenderResolutionPreset,
): { width: number; height: number } {
  if (preset === "source") {
    return { width: project.canvas.width, height: project.canvas.height };
  }
  if (preset === "720") {
    return scaleToHeight(project.canvas.width, project.canvas.height, 720);
  }
  return scaleToHeight(project.canvas.width, project.canvas.height, 1080);
}

function scaleToHeight(width: number, height: number, targetHeight: number) {
  const ratio = width / Math.max(1, height);
  return {
    width: Math.round((targetHeight * ratio) / 2) * 2,
    height: targetHeight,
  };
}
