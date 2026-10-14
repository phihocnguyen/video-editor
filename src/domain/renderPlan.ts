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

export interface RenderPlan {
  width: number;
  height: number;
  frameRate: number;
  durationSec: number;
  clips: RenderClipPlan[];
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

  for (const clip of project.clips) {
    if (clip.kind !== "media" || !clip.assetId) continue;
    const asset = assetsById.get(clip.assetId);
    if (!asset) continue;
    const end = clip.startTicks + clipDurationTicks(clip);
    durationTicks = Math.max(durationTicks, end);
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
    durationSec: ticksToSeconds(durationTicks),
    clips,
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
    width: Math.round(targetHeight * ratio / 2) * 2,
    height: targetHeight,
  };
}
