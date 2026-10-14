import {
  createDefaultTextStyle,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type TextStyle,
  type Track,
  type TrackKind,
} from "./project";
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
  const source = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, Math.round(source / speed));
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

export function addTextClip(
  project: ProjectDocument,
  options?: {
    trackId?: string;
    startTicks?: Tick;
    durationTicks?: Tick;
    text?: Partial<TextStyle>;
  },
): ProjectDocument {
  const track =
    (options?.trackId
      ? project.tracks.find((t) => t.id === options.trackId)
      : undefined) ?? project.tracks.find((t) => t.kind === "video" && !t.locked);

  if (!track) throw new Error("No video track for text");
  if (track.locked) throw new Error("Track is locked");
  if (track.kind !== "video") throw new Error("Text clips require a video track");

  const duration = Math.max(1, options?.durationTicks ?? 5_000_000);
  const text = { ...createDefaultTextStyle(), ...options?.text };
  const clip: Clip = {
    id: crypto.randomUUID(),
    trackId: track.id,
    assetId: null,
    kind: "text",
    startTicks: Math.max(0, options?.startTicks ?? 0),
    sourceInTicks: 0,
    sourceOutTicks: duration,
    speed: 1,
    transform: {
      ...DEFAULT_TRANSFORM,
      x: project.canvas.width / 2,
      y: project.canvas.height / 2,
    },
    volume: 1,
    text,
  };

  return withUpdatedClips(project, [...project.clips, clip]);
}

export function updateClipText(
  project: ProjectDocument,
  clipId: string,
  text: TextStyle,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    if (clip.kind !== "text") throw new Error("Clip is not a text clip");
    return { ...clip, text };
  });
}

export function updateClipTransform(
  project: ProjectDocument,
  clipId: string,
  transform: Clip["transform"],
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({ ...clip, transform }));
}

export function updateClipVolume(
  project: ProjectDocument,
  clipId: string,
  volume: number,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    volume: Math.min(2, Math.max(0, volume)),
  }));
}

export function updateClipSpeed(
  project: ProjectDocument,
  clipId: string,
  speed: number,
): ProjectDocument {
  if (!(speed > 0) || !Number.isFinite(speed)) {
    throw new Error("Speed must be a positive number");
  }
  return mapClip(project, clipId, (clip) => {
    if (clip.kind === "text") throw new Error("Text clips do not support speed");
    return { ...clip, speed: Math.min(8, Math.max(0.1, speed)) };
  });
}

export function addTrack(
  project: ProjectDocument,
  kind: TrackKind,
  options?: { name?: string },
): ProjectDocument {
  const sameKind = project.tracks.filter((t) => t.kind === kind);
  const index = sameKind.length + 1;
  const track: Track = {
    id: crypto.randomUUID(),
    kind,
    name: options?.name ?? (kind === "video" ? `V${index}` : `A${index}`),
    order: project.tracks.reduce((max, t) => Math.max(max, t.order), -1) + 1,
    muted: false,
    visible: true,
    locked: false,
    volume: 1,
  };
  return {
    ...project,
    tracks: [...project.tracks, track],
    updatedAt: new Date().toISOString(),
  };
}

export function removeTrack(
  project: ProjectDocument,
  trackId: string,
): ProjectDocument {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("Unknown trackId");
  const remainingSameKind = project.tracks.filter(
    (t) => t.kind === track.kind && t.id !== trackId,
  );
  if (remainingSameKind.length === 0) {
    throw new Error(`Cannot remove the last ${track.kind} track`);
  }
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    clips: project.clips.filter((c) => c.trackId !== trackId),
    updatedAt: new Date().toISOString(),
  };
}

export function updateTrack(
  project: ProjectDocument,
  trackId: string,
  patch: Partial<Pick<Track, "muted" | "visible" | "locked" | "volume" | "name">>,
): ProjectDocument {
  let found = false;
  const tracks = project.tracks.map((track) => {
    if (track.id !== trackId) return track;
    found = true;
    return {
      ...track,
      ...patch,
      volume:
        patch.volume != null
          ? Math.min(2, Math.max(0, patch.volume))
          : track.volume,
    };
  });
  if (!found) throw new Error("Unknown trackId");
  return { ...project, tracks, updatedAt: new Date().toISOString() };
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
