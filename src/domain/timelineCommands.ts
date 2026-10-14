import type { Clip, MediaAsset, ProjectDocument, Track, TrackKind } from "./project";
import type { Tick } from "./time";

const DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

export function clipDurationTicks(clip: Clip): Tick {
  return Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
}

export function defaultClipDuration(asset: MediaAsset): Tick {
  if (asset.durationTicks != null && asset.durationTicks > 0) {
    return asset.durationTicks;
  }
  // Still images default to 5s
  return 5_000_000;
}

export function compatibleTrackKind(asset: MediaAsset): TrackKind {
  return asset.kind === "audio" ? "audio" : "video";
}

export function findTrackForAsset(project: ProjectDocument, asset: MediaAsset): Track | undefined {
  const kind = compatibleTrackKind(asset);
  return project.tracks.find((t) => t.kind === kind && !t.locked);
}

export function addMediaClip(
  project: ProjectDocument,
  assetId: string,
  options?: { trackId?: string; startTicks?: Tick },
): ProjectDocument {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) {
    throw new Error("Unknown assetId");
  }

  const track =
    (options?.trackId
      ? project.tracks.find((t) => t.id === options.trackId)
      : undefined) ?? findTrackForAsset(project, asset);

  if (!track) {
    throw new Error("No compatible track for asset");
  }
  if (track.locked) {
    throw new Error("Track is locked");
  }
  if (compatibleTrackKind(asset) !== track.kind) {
    throw new Error("Asset kind does not match track kind");
  }

  const duration = defaultClipDuration(asset);
  const clip: Clip = {
    id: crypto.randomUUID(),
    trackId: track.id,
    assetId: asset.id,
    kind: "media",
    startTicks: Math.max(0, options?.startTicks ?? 0),
    sourceInTicks: 0,
    sourceOutTicks: duration,
    speed: 1,
    transform: { ...DEFAULT_TRANSFORM },
    volume: 1,
    text: null,
  };

  return withUpdatedClips(project, [...project.clips, clip]);
}

export function deleteClips(project: ProjectDocument, clipIds: string[]): ProjectDocument {
  const idSet = new Set(clipIds);
  return withUpdatedClips(
    project,
    project.clips.filter((c) => !idSet.has(c.id)),
  );
}

export function moveClip(
  project: ProjectDocument,
  clipId: string,
  startTicks: Tick,
  trackId?: string,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const nextTrackId = trackId ?? clip.trackId;
    const track = project.tracks.find((t) => t.id === nextTrackId);
    if (!track) throw new Error("Unknown trackId");
    if (track.locked) throw new Error("Track is locked");
    return {
      ...clip,
      trackId: nextTrackId,
      startTicks: Math.max(0, startTicks),
    };
  });
}

export function trimClip(
  project: ProjectDocument,
  clipId: string,
  sourceInTicks: Tick,
  sourceOutTicks: Tick,
): ProjectDocument {
  if (sourceOutTicks <= sourceInTicks) {
    throw new Error("Invalid trim range");
  }
  if (sourceInTicks < 0) {
    throw new Error("sourceInTicks cannot be negative");
  }

  return mapClip(project, clipId, (clip) => ({
    ...clip,
    sourceInTicks,
    sourceOutTicks,
  }));
}

/** Split clip at an absolute timeline position. Returns unchanged project if split is invalid. */
export function splitClipAt(
  project: ProjectDocument,
  clipId: string,
  timelineTicks: Tick,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");

  const duration = clipDurationTicks(clip);
  const local = timelineTicks - clip.startTicks;
  if (local <= 0 || local >= duration) {
    return project;
  }

  const left: Clip = {
    ...clip,
    sourceOutTicks: clip.sourceInTicks + local,
  };
  const right: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    startTicks: timelineTicks,
    sourceInTicks: clip.sourceInTicks + local,
  };

  return withUpdatedClips(
    project,
    project.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
  );
}

export function relinkAsset(
  project: ProjectDocument,
  assetId: string,
  newPath: string,
  options?: { name?: string; missing?: boolean },
): ProjectDocument {
  const assets = project.assets.map((asset) =>
    asset.id === assetId
      ? {
          ...asset,
          path: newPath,
          name: options?.name ?? asset.name,
          missing: options?.missing ?? false,
        }
      : asset,
  );
  return {
    ...project,
    assets,
    updatedAt: new Date().toISOString(),
  };
}

function mapClip(
  project: ProjectDocument,
  clipId: string,
  map: (clip: Clip) => Clip,
): ProjectDocument {
  let found = false;
  const clips = project.clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    found = true;
    return map(clip);
  });
  if (!found) throw new Error("Unknown clipId");
  return withUpdatedClips(project, clips);
}

function withUpdatedClips(project: ProjectDocument, clips: Clip[]): ProjectDocument {
  return {
    ...project,
    clips,
    updatedAt: new Date().toISOString(),
  };
}
