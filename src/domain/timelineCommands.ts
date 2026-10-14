import {
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";
import {
  createDefaultTextStyle,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type TextStyle,
  type Track,
  type TrackKind,
} from "./project";
import {
  DEFAULT_CLIP_TRANSITION,
  normalizeClipTransition,
  type ClipTransition,
} from "./transitions";
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
    effects: { ...DEFAULT_CLIP_EFFECTS },
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
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

/** Deep-ish snapshot of clips for the editor clipboard (ids kept as templates). */
export function snapshotClipsForClipboard(
  project: ProjectDocument,
  clipIds: string[],
): Clip[] {
  const idSet = new Set(clipIds);
  return project.clips
    .filter((c) => idSet.has(c.id))
    .sort((a, b) => a.startTicks - b.startTicks)
    .map(cloneClipData);
}

function cloneClipData(clip: Clip): Clip {
  return {
    ...clip,
    transform: { ...clip.transform },
    effects: { ...clip.effects },
    transitionIn: { ...clip.transitionIn },
    text: clip.text ? { ...clip.text } : null,
  };
}

function resolvePasteTrack(
  project: ProjectDocument,
  template: Clip,
): Track | undefined {
  const preferred = project.tracks.find((t) => t.id === template.trackId && !t.locked);
  if (preferred) return preferred;
  if (template.kind === "text") {
    return project.tracks.find((t) => t.kind === "video" && !t.locked);
  }
  if (template.assetId) {
    const asset = project.assets.find((a) => a.id === template.assetId);
    if (asset) {
      const kind = compatibleTrackKind(asset);
      return project.tracks.find((t) => t.kind === kind && !t.locked);
    }
  }
  return project.tracks.find((t) => !t.locked);
}

/**
 * Paste clipboard clips so the leftmost starts at `atTicks`,
 * preserving relative time and preferred tracks.
 */
export function pasteClips(
  project: ProjectDocument,
  clipboard: Clip[],
  atTicks: Tick,
): { project: ProjectDocument; newIds: string[] } {
  if (clipboard.length === 0) return { project, newIds: [] };
  const origin = Math.min(...clipboard.map((c) => c.startTicks));
  const newIds: string[] = [];
  const added: Clip[] = [];

  for (const template of clipboard) {
    const track = resolvePasteTrack(project, template);
    if (!track) {
      throw new Error("No unlocked track to paste onto");
    }
    if (template.kind === "media" && template.assetId) {
      const asset = project.assets.find((a) => a.id === template.assetId);
      if (!asset) throw new Error("Clipboard media asset missing from project");
      if (compatibleTrackKind(asset) !== track.kind) {
        throw new Error("Asset kind does not match track kind");
      }
    }
    if (template.kind === "text" && track.kind !== "video") {
      throw new Error("Text clips require a video track");
    }
    const id = crypto.randomUUID();
    newIds.push(id);
    added.push({
      ...cloneClipData(template),
      id,
      trackId: track.id,
      startTicks: Math.max(0, Math.round(atTicks + (template.startTicks - origin))),
    });
  }

  return {
    project: withUpdatedClips(project, [...project.clips, ...added]),
    newIds,
  };
}

/** Duplicate selection in place, shifted slightly later on the same tracks. */
export function duplicateClips(
  project: ProjectDocument,
  clipIds: string[],
  gapTicks = 200_000,
): { project: ProjectDocument; newIds: string[] } {
  const snaps = snapshotClipsForClipboard(project, clipIds);
  if (snaps.length === 0) return { project, newIds: [] };
  const end = Math.max(
    ...snaps.map((c) => c.startTicks + clipDurationTicks(c)),
  );
  return pasteClips(project, snaps, end + gapTicks);
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
    if (clip.kind === "text" && track.kind !== "video") {
      throw new Error("Text clips require a video track");
    }
    if (clip.kind === "media" && clip.assetId) {
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (asset && compatibleTrackKind(asset) !== track.kind) {
        throw new Error("Asset kind does not match track kind");
      }
    }
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

  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const sourceDelta = Math.round(local * speed);
  const splitSource = clip.sourceInTicks + sourceDelta;
  if (splitSource <= clip.sourceInTicks || splitSource >= clip.sourceOutTicks) {
    return project;
  }

  const left: Clip = {
    ...clip,
    sourceOutTicks: splitSource,
  };
  const right: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    startTicks: timelineTicks,
    sourceInTicks: splitSource,
    // Incoming transition belongs to the cut into this piece — clear by default.
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
  };

  return withUpdatedClips(
    project,
    project.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
  );
}

/**
 * Premiere-style: change speed only inside a timeline range of a media clip.
 * Splits at the range edges, sets speed on the middle segment, and slides the
 * trailing segment so source media stays continuous.
 */
export function applySpeedToRange(
  project: ProjectDocument,
  clipId: string,
  rangeStartTicks: Tick,
  rangeEndTicks: Tick,
  speed: number,
): { project: ProjectDocument; midClipId: string } {
  if (!(speed > 0) || !Number.isFinite(speed)) {
    throw new Error("Speed must be a positive number");
  }
  const clampedSpeed = Math.min(8, Math.max(0.1, speed));

  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  if (clip.kind !== "media") {
    throw new Error("Speed range only applies to media clips");
  }

  const clipEnd = clip.startTicks + clipDurationTicks(clip);
  const start = Math.max(clip.startTicks, Math.min(rangeStartTicks, rangeEndTicks));
  const end = Math.min(clipEnd, Math.max(rangeStartTicks, rangeEndTicks));
  if (end - start < 100_000) {
    throw new Error("Speed range is too short — widen Mark In/Out");
  }

  let next = project;
  let targetId = clipId;

  // Split at range start (if interior).
  if (start > clip.startTicks + 50_000) {
    next = splitClipAt(next, targetId, start);
    const right = next.clips.find(
      (c) =>
        c.trackId === clip.trackId &&
        c.startTicks === start &&
        c.id !== targetId,
    );
    if (!right) throw new Error("Split at range start failed");
    targetId = right.id;
  }

  const midBefore = next.clips.find((c) => c.id === targetId);
  if (!midBefore) throw new Error("Range clip missing after start split");
  const midEndBefore = midBefore.startTicks + clipDurationTicks(midBefore);

  // Split at range end (if interior).
  let trailingId: string | null = null;
  if (end < midEndBefore - 50_000) {
    next = splitClipAt(next, targetId, end);
    const right = next.clips.find(
      (c) =>
        c.trackId === clip.trackId &&
        c.startTicks === end &&
        c.id !== targetId,
    );
    if (!right) throw new Error("Split at range end failed");
    trailingId = right.id;
  }

  next = updateClipSpeed(next, targetId, clampedSpeed);

  // After speed change, duration of mid changes — park trailing piece after it.
  if (trailingId) {
    const mid = next.clips.find((c) => c.id === targetId)!;
    const newMidEnd = mid.startTicks + clipDurationTicks(mid);
    next = moveClip(next, trailingId, newMidEnd);
  }

  return { project: next, midClipId: targetId };
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
    effects: { ...DEFAULT_CLIP_EFFECTS },
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text,
  };

  return withUpdatedClips(project, [...project.clips, clip]);
}

export function updateClipEffects(
  project: ProjectDocument,
  clipId: string,
  effects: ClipEffects | Partial<ClipEffects>,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    effects: normalizeClipEffects({ ...clip.effects, ...effects }),
  }));
}

export function updateClipTransition(
  project: ProjectDocument,
  clipId: string,
  transitionIn: ClipTransition | Partial<ClipTransition>,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    transitionIn: normalizeClipTransition({
      ...normalizeClipTransition(clip.transitionIn),
      ...transitionIn,
    }),
  }));
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

/** Swap order with the previous/next track of the same kind (V↑/V↓ or A↑/A↓). */
export function moveTrack(
  project: ProjectDocument,
  trackId: string,
  direction: "up" | "down",
): ProjectDocument {
  const sorted = [...project.tracks].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((t) => t.id === trackId);
  if (idx < 0) throw new Error("Unknown trackId");
  const track = sorted[idx];
  const neighbor =
    direction === "up"
      ? [...sorted]
          .slice(0, idx)
          .reverse()
          .find((t) => t.kind === track.kind)
      : sorted.slice(idx + 1).find((t) => t.kind === track.kind);
  if (!neighbor) {
    throw new Error(
      direction === "up" ? "Already at the top" : "Already at the bottom",
    );
  }
  const orderA = track.order;
  const orderB = neighbor.order;
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      if (t.id === track.id) return { ...t, order: orderB };
      if (t.id === neighbor.id) return { ...t, order: orderA };
      return t;
    }),
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
