import {
  DEFAULT_CLIP_EFFECTS,
  effectsAreDefault,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";
import {
  cloneEffectKeyframes,
  findKeyframeNear,
  getParamTrack,
  normalizeEffectKeyframes,
  setParamTrackEasing,
  paramHasKeyframes,
  progressFromTicks,
  readBaseParam,
  removeParamKeyframeNear,
  sliceEffectKeyframes,
  upsertParamKeyframe,
  writeBaseParam,
  type EffectKeyframes,
  type EffectParamKey,
} from "./effectKeyframes";
import type { EasingType } from "./easing";
import {
  cloneTransformKeyframes,
  findTransformKeyframeNear,
  getTransformTrack,
  paramHasTransformKeyframes,
  progressFromTransformTicks,
  readTransformParam,
  removeTransformKeyframeNear,
  sliceTransformKeyframes,
  transformAtProgress,
  upsertTransformKeyframe,
  type TransformParamKey,
} from "./transformKeyframes";
import { mediaCenter } from "./mediaTransform";
import {
  createDefaultTextStyle,
  normalizeLetterbox,
  normalizeTextStyle,
  type Clip,
  type Letterbox,
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
import {
  clampRampSpeed,
  createSpeedPoint,
  getRampProfile,
  isFlatRamp,
  normalizeSpeedRamp,
  rampDurationTicks,
  sliceRamp,
  timelineOffsetForSourceOffset,
  type SpeedRamp,
} from "./speedRamp";
import type { Tick } from "./time";

const DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  blendMode: "normal" as const,
};

/**
 * Effective timeline duration of a clip.
 * A non-flat speed ramp supersedes the constant `speed` field.
 */
export function clipDurationTicks(clip: Clip): Tick {
  const source = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
  const profile = getRampProfile(clip.speedRamp);
  if (profile) {
    return rampDurationTicks(clip.speedRamp!, source);
  }
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const natural = Math.max(0, Math.round(source / speed));
  const span = clip.spanTicks;
  if (typeof span === "number" && Number.isFinite(span) && span > natural) {
    return Math.round(span);
  }
  return natural;
}

/** Effective constant-equivalent speed used for export/fallback paths. */
export function effectiveClipSpeed(clip: Clip): number {
  const profile = getRampProfile(clip.speedRamp);
  if (profile) return profile.averageSpeed;
  return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

/**
 * Source offset (ticks from sourceIn) for a local timeline offset (ticks from
 * clip start), honoring a ramp when present.
 */
export function sourceOffsetForClipTimelineOffset(
  clip: Clip,
  timelineOffsetTicks: number,
): number {
  const span = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
  if (clip.speedRamp) {
    const profile = getRampProfile(clip.speedRamp);
    if (profile) {
      const total = span * profile.durationFactor;
      if (timelineOffsetTicks <= 0) return 0;
      if (timelineOffsetTicks >= total) return span;
      return profile.progressAtIntegralFactor(timelineOffsetTicks / span) * span;
    }
  }
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, timelineOffsetTicks * speed);
}

/** Local timeline offset (ticks from clip start) for a source offset. */
export function clipTimelineOffsetForSourceOffset(
  clip: Clip,
  sourceOffsetTicks: number,
): number {
  const span = Math.max(0, clip.sourceOutTicks - clip.sourceInTicks);
  if (clip.speedRamp) {
    return timelineOffsetForSourceOffset(clip.speedRamp, span, sourceOffsetTicks);
  }
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, sourceOffsetTicks / speed);
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

/** Empty unlocked lane of `kind`. `prefer: "bottom"` = main lane; `"top"` = overlay. */
export function findEmptyTrack(
  project: ProjectDocument,
  kind: TrackKind,
  prefer: "top" | "bottom" = "bottom",
): Track | undefined {
  const occupied = new Set(project.clips.map((c) => c.trackId));
  const empty = project.tracks.filter(
    (t) => t.kind === kind && !t.locked && !occupied.has(t.id),
  );
  return [...empty].sort((a, b) =>
    prefer === "top" ? a.order - b.order : b.order - a.order,
  )[0];
}

/**
 * Remove a track when it has no clips left, keeping at least one track per kind.
 * No-op if the track still has clips, is unknown, or is the last of its kind.
 */
export function pruneEmptyTrack(
  project: ProjectDocument,
  trackId: string,
): ProjectDocument {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  if (project.clips.some((c) => c.trackId === trackId)) return project;
  const remainingSameKind = project.tracks.filter(
    (t) => t.kind === track.kind && t.id !== trackId,
  );
  if (remainingSameKind.length === 0) return project;
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    updatedAt: new Date().toISOString(),
  };
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

  const kind = compatibleTrackKind(asset);
  let working = project;
  let track: Track | undefined =
    options?.trackId != null
      ? working.tracks.find((t) => t.id === options.trackId)
      : undefined;

  const duration = defaultClipDuration(asset);
  const startTicks = Math.max(0, options?.startTicks ?? 0);

  // No explicit track → reuse an empty lane; otherwise create a new overlay.
  if (!options?.trackId) {
    track = findEmptyTrack(working, kind);
    if (!track) {
      const beforeIds = new Set(working.tracks.map((t) => t.id));
      working = addTrack(working, kind);
      track = working.tracks.find((t) => !beforeIds.has(t.id));
    }
  }

  if (!track) {
    throw new Error("No compatible track for asset");
  }
  if (track.locked) {
    throw new Error("Track is locked");
  }
  if (kind !== track.kind) {
    throw new Error("Asset kind does not match track kind");
  }
  const clip: Clip = {
    id: crypto.randomUUID(),
    trackId: track.id,
    assetId: asset.id,
    kind: "media",
    startTicks,
    sourceInTicks: 0,
    sourceOutTicks: duration,
    speed: 1,
    // Media default = centred; contain-fit box is applied by the renderer.
    transform: {
      ...DEFAULT_TRANSFORM,
      x: working.canvas.width / 2,
      y: working.canvas.height / 2,
    },
    volume: 1,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text: null,
  };

  let next = withUpdatedClips(working, [...working.clips, clip]);
  if (asset.kind === "video" && asset.extractedAudioAssetId) {
    const audio = next.assets.find(
      (a) => a.id === asset.extractedAudioAssetId && a.kind === "audio",
    );
    if (audio) next = detachVideoAudio(next, clip.id, audio.id);
  }
  return next;
}

function mutualLockedPartner(project: ProjectDocument, clip: Clip): Clip | null {
  if (!clip.linkedClipId) return null;
  const partner = project.clips.find((c) => c.id === clip.linkedClipId);
  if (!partner || partner.linkedClipId !== clip.id) return null;
  // Only an explicit unlock stops the pair. Clips saved before link-by-default
  // have linkLocked false and no linkFollow, and still move together.
  if (clip.linkFollow === false || partner.linkFollow === false) return null;
  return partner;
}

function rangesOverlap(startA: number, durA: number, startB: number, durB: number): boolean {
  return startA < startB + durB && startB < startA + durA;
}

function linkPair(
  project: ProjectDocument,
  aId: string,
  bId: string,
  locked: boolean,
): ProjectDocument {
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (clip.id === aId) {
        return { ...clip, linkedClipId: bId, linkLocked: locked, linkFollow: locked };
      }
      if (clip.id === bId) {
        return { ...clip, linkedClipId: aId, linkLocked: locked, linkFollow: locked };
      }
      return clip;
    }),
  };
}

/**
 * Place the extracted soundtrack on an audio track, linked to the video clip.
 * The video clip stops playing its embedded stream so preview and export
 * don't double the sound. Locked by default, so trim, split, move, and
 * delete follow both sides until Unlink or an Alt-click edit.
 */
export function detachVideoAudio(
  project: ProjectDocument,
  videoClipId: string,
  audioAssetId: string,
): ProjectDocument {
  const video = project.clips.find((c) => c.id === videoClipId);
  if (!video) throw new Error("Unknown clipId");
  const audioAsset = project.assets.find((a) => a.id === audioAssetId);
  if (!audioAsset || audioAsset.kind !== "audio") {
    throw new Error("Audio asset required");
  }
  if (video.linkedClipId) {
    const existing = project.clips.find((c) => c.id === video.linkedClipId);
    if (existing) {
      return linkPair(
        {
          ...project,
          clips: project.clips.map((c) =>
            c.id === video.id ? { ...c, suppressEmbeddedAudio: true } : c,
          ),
          assets: project.assets.map((a) =>
            a.id === video.assetId && !a.extractedAudioAssetId
              ? { ...a, extractedAudioAssetId: audioAsset.id }
              : a,
          ),
        },
        video.id,
        existing.id,
        video.linkFollow !== false && existing.linkFollow !== false,
      );
    }
  }

  let working = project;
  let track = findEmptyTrack(working, "audio");
  if (!track) {
    const beforeIds = new Set(working.tracks.map((t) => t.id));
    working = addTrack(working, "audio");
    track = working.tracks.find((t) => !beforeIds.has(t.id));
  }
  if (!track || track.locked) throw new Error("No unlocked audio track");

  const audioDur =
    audioAsset.durationTicks != null && audioAsset.durationTicks > 0
      ? audioAsset.durationTicks
      : video.sourceOutTicks;
  let sourceIn = Math.max(0, Math.min(video.sourceInTicks, audioDur - 1));
  let sourceOut = Math.min(video.sourceOutTicks, audioDur);
  if (sourceOut <= sourceIn) {
    sourceIn = 0;
    sourceOut = Math.max(1, audioDur);
  }

  const audioClip: Clip = {
    id: crypto.randomUUID(),
    trackId: track.id,
    assetId: audioAsset.id,
    kind: "media",
    startTicks: video.startTicks,
    sourceInTicks: sourceIn,
    sourceOutTicks: sourceOut,
    speed: video.speed,
    transform: {
      ...DEFAULT_TRANSFORM,
      x: working.canvas.width / 2,
      y: working.canvas.height / 2,
    },
    volume: video.volume,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text: null,
    speedRamp: video.speedRamp
      ? { points: video.speedRamp.points.map((p) => ({ ...p })) }
      : null,
    linkedClipId: video.id,
    linkLocked: true,
  };

  working = {
    ...working,
    assets: working.assets.map((a) =>
      a.id === video.assetId ? { ...a, extractedAudioAssetId: audioAsset.id } : a,
    ),
    clips: [
      ...working.clips.map((c) =>
        c.id === video.id
          ? { ...c, linkedClipId: audioClip.id, linkLocked: true, suppressEmbeddedAudio: true }
          : c,
      ),
      audioClip,
    ],
  };
  return withUpdatedClips(working, working.clips);
}

/** Lock or unlock a detached A/V pair so edits follow both sides. */
export function setClipLinkLocked(
  project: ProjectDocument,
  clipId: string,
  locked: boolean,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.linkedClipId) return project;
  const partner = project.clips.find((c) => c.id === clip.linkedClipId);
  if (!partner) return project;
  return linkPair(project, clip.id, partner.id, locked);
}

/**
 * Clip a shift-click range starts from. The clip the user already selected
 * wins over whichever clip happens to sit under the playhead.
 */
export function shiftRangeAnchorId(
  ordered: readonly { id: string }[],
  selectedIds: readonly string[],
  storedAnchorId: string | null,
  playheadClipId: string | null,
): string | null {
  const selected = new Set(selectedIds);
  const onTrack = (id: string | null): id is string =>
    id != null && ordered.some((clip) => clip.id === id);
  if (onTrack(storedAnchorId) && selected.has(storedAnchorId)) return storedAnchorId;
  const selectedOnTrack = ordered.find((clip) => selected.has(clip.id));
  if (selectedOnTrack) return selectedOnTrack.id;
  return onTrack(playheadClipId) ? playheadClipId : null;
}

/** Inclusive media clips from the selected anchor through the shift-clicked clip. */
export function clipsInShiftRange<T extends { id: string }>(
  ordered: readonly T[],
  targetId: string,
  anchorId: string,
): T[] {
  const anchorIndex = ordered.findIndex((clip) => clip.id === anchorId);
  const targetIndex = ordered.findIndex((clip) => clip.id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ordered.slice(start, end + 1);
}

/** The clip plus its locked partner, for selection that should move together. */
export function linkedClipIds(project: ProjectDocument, clipId: string): string[] {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const partner = mutualLockedPartner(project, clip);
  return partner ? [clip.id, partner.id] : [clip.id];
}

/** Break a linked pair so each side can be edited on its own. */
export function unlinkClip(project: ProjectDocument, clipId: string): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip?.linkedClipId) return project;
  const partnerId = clip.linkedClipId;
  return withUpdatedClips(
    project,
    project.clips.map((c) =>
      c.id === clip.id || c.id === partnerId
        ? { ...c, linkedClipId: null, linkLocked: false }
        : c,
    ),
  );
}

/** Link two clips and lock them so later edits follow both. */
export function linkClips(
  project: ProjectDocument,
  clipId: string,
  partnerId: string,
): ProjectDocument {
  return linkPair(project, clipId, partnerId, true);
}

export function deleteClips(
  project: ProjectDocument,
  clipIds: string[],
  options?: { followLink?: boolean },
): ProjectDocument {
  const idSet = new Set(clipIds);
  const followLink = options?.followLink !== false;
  for (const id of clipIds) {
    const clip = project.clips.find((c) => c.id === id);
    const partner = followLink && clip ? mutualLockedPartner(project, clip) : null;
    if (partner) idSet.add(partner.id);
  }
  return withUpdatedClips(
    project,
    project.clips
      .filter((c) => !idSet.has(c.id))
      .map((c) =>
        c.linkedClipId && idSet.has(c.linkedClipId)
          ? { ...c, linkedClipId: null, linkLocked: false }
          : c,
      ),
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
    effectKeyframes: cloneEffectKeyframes(clip.effectKeyframes ?? null),
    transformKeyframes: cloneTransformKeyframes(clip.transformKeyframes ?? null),
    transitionIn: { ...clip.transitionIn },
    text: clip.text ? { ...clip.text } : null,
    speedRamp: clip.speedRamp
      ? { points: clip.speedRamp.points.map((p) => ({ ...p })) }
      : clip.speedRamp,
  };
}

function resolvePasteTrack(
  project: ProjectDocument,
  template: Clip,
): Track | undefined {
  const preferred = project.tracks.find((t) => t.id === template.trackId && !t.locked);
  if (preferred) return preferred;
  if (template.kind === "text" || template.kind === "filter") {
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
  const templateIds = new Set(clipboard.map((c) => c.id));
  const idMap = new Map<string, string>();
  for (const template of clipboard) idMap.set(template.id, crypto.randomUUID());
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
    if ((template.kind === "text" || template.kind === "filter") && track.kind !== "video") {
      throw new Error("Text clips require a video track");
    }
    const id = idMap.get(template.id)!;
    const linked =
      template.linkedClipId && templateIds.has(template.linkedClipId)
        ? (idMap.get(template.linkedClipId) ?? null)
        : null;
    newIds.push(id);
    added.push({
      ...cloneClipData(template),
      id,
      trackId: track.id,
      startTicks: Math.max(0, Math.round(atTicks + (template.startTicks - origin))),
      linkedClipId: linked,
      linkLocked: linked ? Boolean(template.linkLocked) : false,
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
  options?: { pruneEmptySource?: boolean; followLink?: boolean },
): ProjectDocument {
  return moveClipInner(
    project,
    clipId,
    startTicks,
    trackId,
    options,
    options?.followLink !== false,
  );
}

function moveClipInner(
  project: ProjectDocument,
  clipId: string,
  startTicks: Tick,
  trackId: string | undefined,
  options: { pruneEmptySource?: boolean } | undefined,
  followLink: boolean,
): ProjectDocument {
  const source = project.clips.find((c) => c.id === clipId);
  const sourceTrackId = source?.trackId;
  const nextTrackId = trackId ?? sourceTrackId;
  const oldStart = source?.startTicks ?? 0;

  let next = mapClip(project, clipId, (clip) => {
    const destId = trackId ?? clip.trackId;
    const track = project.tracks.find((t) => t.id === destId);
    if (!track) throw new Error("Unknown trackId");
    if (track.locked) throw new Error("Track is locked");
    if ((clip.kind === "text" || clip.kind === "filter") && track.kind !== "video") {
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
      trackId: destId,
      startTicks: Math.max(0, startTicks),
    };
  });

  if (
    options?.pruneEmptySource &&
    sourceTrackId &&
    nextTrackId &&
    sourceTrackId !== nextTrackId
  ) {
    next = pruneEmptyTrack(next, sourceTrackId);
  }

  if (followLink && source) {
    const partner = mutualLockedPartner(project, source);
    if (partner) {
      const moved = next.clips.find((c) => c.id === clipId);
      const delta = (moved?.startTicks ?? oldStart) - oldStart;
      if (delta !== 0) {
        next = moveClipInner(
          next,
          partner.id,
          Math.max(0, partner.startTicks + delta),
          undefined,
          undefined,
          false,
        );
      }
    }
  }
  return next;
}

export interface VideoGap {
  trackId: string;
  leftClipId: string;
  rightClipId: string;
  gapStartTicks: number;
  gapEndTicks: number;
}

function videoMediaClipsOnTrack(project: ProjectDocument, trackId: string): Clip[] {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== "video") return [];
  return project.clips
    .filter((clip) => {
      if (clip.trackId !== trackId || clip.kind !== "media") return false;
      const asset = clip.assetId
        ? project.assets.find((item) => item.id === clip.assetId)
        : null;
      return asset?.kind !== "audio";
    })
    .slice()
    .sort((a, b) => a.startTicks - b.startTicks);
}

/** Gap between two adjacent video clips that contains the playhead. */
export function findVideoGapAtPlayhead(
  project: ProjectDocument,
  playheadTicks: number,
  preferredTrackId?: string | null,
): VideoGap | null {
  const videoTracks = project.tracks.filter((track) => track.kind === "video");
  const ordered = preferredTrackId
    ? [
        ...videoTracks.filter((track) => track.id === preferredTrackId),
        ...videoTracks.filter((track) => track.id !== preferredTrackId),
      ]
    : videoTracks;
  for (const track of ordered) {
    const lane = videoMediaClipsOnTrack(project, track.id);
    for (let i = 0; i < lane.length - 1; i += 1) {
      const left = lane[i]!;
      const right = lane[i + 1]!;
      const leftEnd = left.startTicks + clipDurationTicks(left);
      if (playheadTicks > leftEnd && playheadTicks < right.startTicks) {
        return {
          trackId: track.id,
          leftClipId: left.id,
          rightClipId: right.id,
          gapStartTicks: leftEnd,
          gapEndTicks: right.startTicks,
        };
      }
    }
  }
  return null;
}

/**
 * Pull the clip on the right of the playhead gap, and every later clip on
 * that track, left until it touches the clip on the left. Linked audio follows.
 */
export function closeGapAtPlayhead(
  project: ProjectDocument,
  playheadTicks: number,
  preferredTrackId?: string | null,
): ProjectDocument {
  const gap = findVideoGapAtPlayhead(project, playheadTicks, preferredTrackId);
  if (!gap) return project;
  const delta = gap.gapEndTicks - gap.gapStartTicks;
  if (delta <= 0) return project;
  const movers = project.clips
    .filter((clip) => clip.trackId === gap.trackId && clip.startTicks >= gap.gapEndTicks)
    .slice()
    .sort((a, b) => a.startTicks - b.startTicks);
  let next = project;
  for (const clip of movers) {
    next = moveClip(next, clip.id, clip.startTicks - delta, undefined, {
      followLink: true,
    });
  }
  return next;
}

export function trimClip(
  project: ProjectDocument,
  clipId: string,
  sourceInTicks: Tick,
  sourceOutTicks: Tick,
  options?: { followLink?: boolean },
): ProjectDocument {
  if (sourceOutTicks <= sourceInTicks) {
    throw new Error("Invalid trim range");
  }
  if (sourceInTicks < 0) {
    throw new Error("sourceInTicks cannot be negative");
  }

  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  const dIn = sourceInTicks - clip.sourceInTicks;
  const dOut = sourceOutTicks - clip.sourceOutTicks;
  let next = mapClip(project, clipId, (current) => ({
    ...current,
    sourceInTicks,
    sourceOutTicks,
    spanTicks: current.spanTicks ? null : current.spanTicks,
  }));
  const partner =
    options?.followLink === false ? null : mutualLockedPartner(project, clip);
  if (partner && (dIn !== 0 || dOut !== 0)) {
    const pIn = partner.sourceInTicks + dIn;
    const pOut = partner.sourceOutTicks + dOut;
    if (pIn >= 0 && pOut > pIn) {
      next = mapClip(next, partner.id, (current) => ({
        ...current,
        sourceInTicks: pIn,
        sourceOutTicks: pOut,
      }));
    }
  }
  return next;
}

/** Split clip at an absolute timeline position. Returns unchanged project if split is invalid. */
export function splitClipAt(
  project: ProjectDocument,
  clipId: string,
  timelineTicks: Tick,
  options?: { followLink?: boolean },
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  const partner =
    options?.followLink === false ? null : mutualLockedPartner(project, clip);
  const split = splitClipCore(project, clipId, timelineTicks);
  if (!split.rightId) return project;

  if (partner) {
    const partnerDur = clipDurationTicks(partner);
    const partnerLocal = timelineTicks - partner.startTicks;
    const partnerCanSplit = partnerLocal > 0 && partnerLocal < partnerDur;
    if (partnerCanSplit) {
      const partnerSplit = splitClipCore(split.project, partner.id, timelineTicks);
      if (partnerSplit.rightId) {
        let linked = linkPair(partnerSplit.project, clip.id, partner.id, true);
        linked = linkPair(linked, split.rightId, partnerSplit.rightId, true);
        return linked;
      }
    }
  }

  return relinkAfterSplit(split.project, clip.id, split.rightId);
}

function splitClipCore(
  project: ProjectDocument,
  clipId: string,
  timelineTicks: Tick,
): { project: ProjectDocument; rightId: string | null } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");

  const duration = clipDurationTicks(clip);
  const local = timelineTicks - clip.startTicks;
  if (local <= 0 || local >= duration) {
    return { project, rightId: null };
  }

  // Where in the source range the cut lands — ramp-aware when a curve is set.
  const splitSourceOffset = sourceOffsetForClipTimelineOffset(clip, local);
  const splitSource = Math.round(clip.sourceInTicks + splitSourceOffset);
  if (splitSource <= clip.sourceInTicks || splitSource >= clip.sourceOutTicks) {
    return { project, rightId: null };
  }

  const span = Math.max(1, clip.sourceOutTicks - clip.sourceInTicks);
  const splitProgress = (splitSource - clip.sourceInTicks) / span;
  const rampSplit = clip.speedRamp ? sliceRamp(clip.speedRamp, 0, splitProgress) : null;
  const rampRight = clip.speedRamp ? sliceRamp(clip.speedRamp, splitProgress, 1) : null;
  const timelineSplit = local / duration;
  const fxLeft = sliceEffectKeyframes(clip.effectKeyframes ?? null, 0, timelineSplit);
  const fxRight = sliceEffectKeyframes(clip.effectKeyframes ?? null, timelineSplit, 1);
  const tfLeft = sliceTransformKeyframes(clip.transformKeyframes ?? null, 0, timelineSplit);
  const tfRight = sliceTransformKeyframes(clip.transformKeyframes ?? null, timelineSplit, 1);
  const rightId = crypto.randomUUID();

  const left: Clip = {
    ...clip,
    sourceOutTicks: splitSource,
    ...(rampSplit ? { speedRamp: rampSplit } : {}),
    effectKeyframes: fxLeft,
    transformKeyframes: tfLeft,
  };
  const right: Clip = {
    ...clip,
    id: rightId,
    startTicks: timelineTicks,
    sourceInTicks: splitSource,
    ...(rampRight ? { speedRamp: rampRight } : {}),
    effectKeyframes: fxRight,
    transformKeyframes: tfRight,
    // Incoming transition belongs to the cut into this piece — clear by default.
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    linkedClipId: null,
    linkLocked: false,
  };

  return {
    project: withUpdatedClips(
      project,
      project.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
    ),
    rightId,
  };
}

/** Keep the link on the piece that still overlaps the partner; unlink the other. */
function relinkAfterSplit(
  project: ProjectDocument,
  leftId: string,
  rightId: string,
): ProjectDocument {
  const left = project.clips.find((c) => c.id === leftId);
  const right = project.clips.find((c) => c.id === rightId);
  if (!left) return project;
  const partnerId = left.linkedClipId;
  const partner = partnerId ? project.clips.find((c) => c.id === partnerId) : null;
  if (!partner) {
    return {
      ...project,
      clips: project.clips.map((c) =>
        c.id === leftId || c.id === rightId
          ? { ...c, linkedClipId: null, linkLocked: false }
          : c,
      ),
    };
  }
  const pDur = clipDurationTicks(partner);
  const leftOverlaps = rangesOverlap(
    left.startTicks,
    clipDurationTicks(left),
    partner.startTicks,
    pDur,
  );
  const rightOverlaps =
    right != null &&
    rangesOverlap(right.startTicks, clipDurationTicks(right), partner.startTicks, pDur);
  const keepId = leftOverlaps ? leftId : rightOverlaps ? rightId : null;
  const locked = Boolean(left.linkLocked && partner.linkLocked);
  return {
    ...project,
    clips: project.clips.map((c) => {
      if (c.id === partner.id) {
        return keepId
          ? { ...c, linkedClipId: keepId, linkLocked: locked }
          : { ...c, linkedClipId: null, linkLocked: false };
      }
      if (c.id === leftId || c.id === rightId) {
        if (c.id === keepId) return { ...c, linkedClipId: partner.id, linkLocked: locked };
        return { ...c, linkedClipId: null, linkLocked: false };
      }
      return c;
    }),
  };
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
  const clampedSpeed = clampRampSpeed(speed);

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
    transform?: Partial<Clip["transform"]>;
  },
): ProjectDocument {
  let working = project;
  let track: Track | undefined =
    options?.trackId != null
      ? working.tracks.find((t) => t.id === options.trackId)
      : undefined;

  // Text is an overlay: reuse an empty top lane, never share a V lane with media.
  if (!options?.trackId) {
    track = findEmptyTrack(working, "video", "top");
    if (!track) {
      const beforeIds = new Set(working.tracks.map((t) => t.id));
      working = addTrack(working, "video");
      track = working.tracks.find((t) => !beforeIds.has(t.id));
    }
  }

  if (!track) throw new Error("No video track for text");
  if (track.locked) throw new Error("Track is locked");
  if (track.kind !== "video") throw new Error("Text clips require a video track");

  const duration = Math.max(1, options?.durationTicks ?? 5_000_000);
  const text = normalizeTextStyle({
    ...createDefaultTextStyle(),
    ...options?.text,
  });
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
      x: working.canvas.width / 2,
      y: working.canvas.height / 2,
      ...options?.transform,
    },
    volume: 1,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text,
  };

  return withUpdatedClips(working, [...working.clips, clip]);
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

/**
 * Set an Adjustment param. If that param is keyframed, upserts a keyframe at
 * the playhead; otherwise updates the static `effects` base.
 */
export function setEffectParamAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  param: EffectParamKey,
  value: number,
  playheadTicks: Tick,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const progress = progressFromTicks(
      clip.startTicks,
      clipDurationTicks(clip),
      playheadTicks,
    );
    if (paramHasKeyframes(clip.effectKeyframes, param)) {
      return {
        ...clip,
        effectKeyframes: upsertParamKeyframe(
          clip.effectKeyframes,
          param,
          progress,
          value,
        ),
      };
    }
    return {
      ...clip,
      effects: normalizeClipEffects({
        ...clip.effects,
        ...writeBaseParam(clip.effects, param, value),
      }),
    };
  });
}

/**
 * CapCut ◇ toggle: add keyframe at playhead (seeded from current value) or
 * remove one near the playhead.
 */
export function toggleEffectKeyframeAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  param: EffectParamKey,
  playheadTicks: Tick,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const progress = progressFromTicks(
      clip.startTicks,
      clipDurationTicks(clip),
      playheadTicks,
    );
    const track = getParamTrack(clip.effectKeyframes, param);
    if (track && findKeyframeNear(track.points, progress)) {
      return {
        ...clip,
        effectKeyframes: removeParamKeyframeNear(
          clip.effectKeyframes,
          param,
          progress,
        ),
      };
    }
    // New keyframes always start from the neutral default — never inherit
    // the previous keyframe's held value.
    const value = readBaseParam(DEFAULT_CLIP_EFFECTS, param);
    // First keyframe mid-clip: reset base to default so the look applies
    // *from* this keyframe onward (before = neutral / base default).
    const isFirstForParam = !track?.points.length;
    if (isFirstForParam && progress > 0.02) {
      const defaults = DEFAULT_CLIP_EFFECTS;
      const neutral =
        param === "grayscale" ? 0 : (defaults[param] as number);
      return {
        ...clip,
        effects: normalizeClipEffects({
          ...clip.effects,
          ...writeBaseParam(clip.effects, param, neutral),
        }),
        effectKeyframes: upsertParamKeyframe(
          clip.effectKeyframes,
          param,
          progress,
          value,
        ),
      };
    }
    return {
      ...clip,
      effectKeyframes: upsertParamKeyframe(
        clip.effectKeyframes,
        param,
        progress,
        value,
      ),
    };
  });
}

export function setEffectKeyframeEasing(
  project: ProjectDocument,
  clipId: string,
  param: EffectParamKey,
  easing: EasingType,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    effectKeyframes: setParamTrackEasing(clip.effectKeyframes, param, easing),
  }));
}

export function setClipEffectKeyframes(
  project: ProjectDocument,
  clipId: string,
  keyframes: EffectKeyframes | null,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    effectKeyframes: normalizeEffectKeyframes(keyframes),
  }));
}

export function setTransformParamAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  param: TransformParamKey,
  value: number,
  playheadTicks: Tick,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const progress = progressFromTransformTicks(
      clip.startTicks,
      clipDurationTicks(clip),
      playheadTicks,
    );
    if (!paramHasTransformKeyframes(clip.transformKeyframes, param)) {
      return {
        ...clip,
        transform: { ...clip.transform, [param]: value },
      };
    }
    return {
      ...clip,
      transformKeyframes: upsertTransformKeyframe(
        clip.transformKeyframes,
        param,
        progress,
        value,
      ),
    };
  });
}

/** Diamond toggle. Seeds the current resolved value and does not reset the base. */
export function toggleTransformKeyframeAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  param: TransformParamKey,
  playheadTicks: Tick,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const progress = progressFromTransformTicks(
      clip.startTicks,
      clipDurationTicks(clip),
      playheadTicks,
    );
    const track = getTransformTrack(clip.transformKeyframes, param);
    if (track && findTransformKeyframeNear(track.points, progress)) {
      return {
        ...clip,
        transformKeyframes: removeTransformKeyframeNear(
          clip.transformKeyframes,
          param,
          progress,
        ),
      };
    }
    const resolved = transformAtProgress(clip.transform, clip.transformKeyframes, progress);
    let seed = readTransformParam(resolved, param);
    if (
      (param === "x" || param === "y") &&
      !paramHasTransformKeyframes(clip.transformKeyframes, "x") &&
      !paramHasTransformKeyframes(clip.transformKeyframes, "y") &&
      clip.transform.x === 0 &&
      clip.transform.y === 0
    ) {
      const center = mediaCenter(clip.transform, project.canvas.width, project.canvas.height);
      seed = param === "x" ? center.x : center.y;
    }
    return {
      ...clip,
      transformKeyframes: upsertTransformKeyframe(
        clip.transformKeyframes,
        param,
        progress,
        seed,
      ),
    };
  });
}

/** Write transform fields, upserting any param that already has a keyframe track. */
export function applyTransformPatch(
  project: ProjectDocument,
  clipId: string,
  patch: Partial<Clip["transform"]>,
  playheadTicks: Tick,
): ProjectDocument {
  const keys = Object.keys(patch) as (keyof Clip["transform"])[];
  let next = project;
  for (const key of keys) {
    const value = patch[key];
    if (typeof value !== "number") {
      if (key === "blendMode" && patch.blendMode) {
        next = mapClip(next, clipId, (clip) => ({
          ...clip,
          transform: { ...clip.transform, blendMode: patch.blendMode },
        }));
      }
      continue;
    }
    if (!TRANSFORM_PATCH_PARAMS.includes(key as TransformParamKey)) {
      continue;
    }
    next = setTransformParamAtPlayhead(
      next,
      clipId,
      key as TransformParamKey,
      value,
      playheadTicks,
    );
  }
  return next;
}

const TRANSFORM_PATCH_PARAMS: TransformParamKey[] = [
  "opacity",
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
];

/** True when the clip has non-default static effects or any effect keyframes. */
export function clipHasEffectLook(clip: Clip): boolean {
  if (normalizeEffectKeyframes(clip.effectKeyframes ?? null)) return true;
  return !effectsAreDefault(normalizeClipEffects(clip.effects));
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

/** Update project/sequence canvas settings (resolution, fps, background). */
export function updateCanvas(
  project: ProjectDocument,
  patch: Omit<Partial<ProjectDocument["canvas"]>, "letterbox"> & {
    letterbox?: Partial<Letterbox> | null;
  },
): ProjectDocument {
  // Width/height stay even so the canvas (preview) always matches export dims
  // (H.264/yuv420p requires even sizes; the builders floor odd values).
  const width = clampInt(patch.width ?? project.canvas.width, 2, 7680) & ~1;
  const height = clampInt(patch.height ?? project.canvas.height, 2, 7680) & ~1;
  const frameRate = clampNum(patch.frameRate ?? project.canvas.frameRate, 1, 240);
  const backgroundColor =
    typeof patch.backgroundColor === "string" && patch.backgroundColor.length > 0
      ? patch.backgroundColor
      : project.canvas.backgroundColor;
  const letterbox: Letterbox | null | undefined =
    "letterbox" in patch
      ? patch.letterbox == null
        ? null
        : normalizeLetterbox({
            ...(project.canvas.letterbox ?? undefined),
            ...patch.letterbox,
          })
      : project.canvas.letterbox;
  return {
    ...project,
    canvas: { width, height, frameRate, backgroundColor, letterbox },
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function updateClipText(
  project: ProjectDocument,
  clipId: string,
  text: TextStyle,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    if (clip.kind !== "text") throw new Error("Clip is not a text clip");
    return {
      ...clip,
      text: normalizeTextStyle(text),
    };
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
    if (clip.kind === "text" || clip.kind === "filter") {
      throw new Error("Text clips do not support speed");
    }
    // A constant speed supersedes (and clears) any ramp so the change is visible.
    const { speedRamp: _dropped, ...rest } = clip;
    return { ...(rest as Clip), speed: clampRampSpeed(speed) };
  });
}

/**
 * Add a track. Default `position: "top"` inserts above existing same-kind
 * tracks (new overlays appear at the head of the timeline). Use `"bottom"`
 * when stacking under the current lanes (e.g. move layer down).
 */
export function addTrack(
  project: ProjectDocument,
  kind: TrackKind,
  options?: { name?: string; position?: "top" | "bottom" },
): ProjectDocument {
  const sameKind = project.tracks.filter((t) => t.kind === kind);
  const index = sameKind.length + 1;
  const position = options?.position ?? "top";
  const sorted = [...project.tracks].sort((a, b) => a.order - b.order);

  let insertOrder: number;
  if (position === "bottom") {
    insertOrder = sorted.reduce((max, t) => Math.max(max, t.order), -1) + 1;
  } else {
    // Top of same-kind stack (video → very top; audio → above existing audio).
    const firstSame = sorted.find((t) => t.kind === kind);
    if (firstSame) {
      insertOrder = firstSame.order;
    } else if (kind === "audio") {
      insertOrder = sorted.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    } else {
      insertOrder = sorted[0]?.order ?? 0;
    }
  }

  const track: Track = {
    id: crypto.randomUUID(),
    kind,
    name: options?.name ?? (kind === "video" ? `V${index}` : `A${index}`),
    order: insertOrder,
    muted: false,
    visible: true,
    locked: false,
    volume: 1,
  };

  const tracks =
    position === "bottom"
      ? [...project.tracks, track]
      : [
          ...project.tracks.map((t) =>
            t.order >= insertOrder ? { ...t, order: t.order + 1 } : t,
          ),
          track,
        ];

  return {
    ...project,
    tracks,
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

/** Insert a same-kind track just above `belowTrackId` (lower order = higher in UI). */
function insertTrackAbove(
  project: ProjectDocument,
  kind: TrackKind,
  belowTrackId: string,
): { project: ProjectDocument; trackId: string } {
  const below = project.tracks.find((t) => t.id === belowTrackId);
  if (!below) throw new Error("Unknown trackId");
  const newOrder = below.order;
  const sameKind = project.tracks.filter((t) => t.kind === kind);
  const track: Track = {
    id: crypto.randomUUID(),
    kind,
    name: kind === "video" ? `V${sameKind.length + 1}` : `A${sameKind.length + 1}`,
    order: newOrder,
    muted: false,
    visible: true,
    locked: false,
    volume: 1,
  };
  return {
    project: {
      ...project,
      tracks: [
        ...project.tracks.map((t) =>
          t.order >= newOrder ? { ...t, order: t.order + 1 } : t,
        ),
        track,
      ],
      updatedAt: new Date().toISOString(),
    },
    trackId: track.id,
  };
}

/**
 * Move a single clip one layer up/down on the timeline (to the adjacent
 * same-kind track). Creates a new track when there is no neighbor — so
 * Move layer down on a video that shares a track with text puts the video
 * on a lower track and leaves text on top.
 */
export function moveClipLayer(
  project: ProjectDocument,
  clipId: string,
  direction: "up" | "down",
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  const track = project.tracks.find((t) => t.id === clip.trackId);
  if (!track) throw new Error("Unknown trackId");
  if (track.locked) throw new Error("Track is locked");

  let kind: TrackKind = track.kind;
  if (clip.kind === "text" || clip.kind === "filter") {
    kind = "video";
  } else if (clip.kind === "media" && clip.assetId) {
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (asset) kind = compatibleTrackKind(asset);
  }

  const sorted = project.tracks
    .filter((t) => t.kind === kind)
    .sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((t) => t.id === track.id);
  if (idx < 0) throw new Error("Clip track mismatch");

  if (direction === "down") {
    if (idx < sorted.length - 1) {
      const dest = sorted[idx + 1];
      if (dest.locked) throw new Error("Destination track is locked");
      return moveClip(project, clipId, clip.startTicks, dest.id, {
        pruneEmptySource: true,
      });
    }
    const next = addTrack(project, kind, { position: "bottom" });
    const created = next.tracks.find(
      (t) => t.kind === kind && !project.tracks.some((o) => o.id === t.id),
    );
    if (!created) throw new Error("Failed to create track");
    return moveClip(next, clipId, clip.startTicks, created.id, {
      pruneEmptySource: true,
    });
  }

  if (idx > 0) {
    const dest = sorted[idx - 1];
    if (dest.locked) throw new Error("Destination track is locked");
    return moveClip(project, clipId, clip.startTicks, dest.id, {
      pruneEmptySource: true,
    });
  }
  const { project: withTrack, trackId } = insertTrackAbove(project, kind, track.id);
  return moveClip(withTrack, clipId, clip.startTicks, trackId, {
    pruneEmptySource: true,
  });
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

/* ------------------------------------------------------------- speed ramp */

/**
 * Set (or clear) a clip's speed ramp. Passing null clears the ramp and returns
 * to the constant `speed` value.
 */
/**
 * Clips that start at or after this clip's previous end slide by the duration
 * change. Source in/out of the edited clip is never touched: fast-forward
 * shortens the timeline slot, slow-motion lengthens it.
 */
function rippleAfterDurationChange(
  project: ProjectDocument,
  clipId: string,
  previousDuration: number,
  boundary: number,
  trackId: string,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return project;
  const delta = clipDurationTicks(clip) - previousDuration;
  if (Math.abs(delta) <= 1) return project;
  return {
    ...project,
    clips: project.clips.map((c) => {
      if (c.id === clipId || c.trackId !== trackId) return c;
      if (c.startTicks + 1 < boundary) return c;
      return {
        ...c,
        startTicks: Math.max(0, Math.round(c.startTicks + delta)) as Tick,
      };
    }),
  };
}

function editRamp(
  project: ProjectDocument,
  clipId: string,
  edit: (project: ProjectDocument) => ProjectDocument,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  const before = clip ? clipDurationTicks(clip) : 0;
  const boundary = clip ? clip.startTicks + before : 0;
  const trackId = clip?.trackId ?? "";
  const next = edit(project);
  if (!clip) return next;
  return rippleAfterDurationChange(next, clipId, before, boundary, trackId);
}

export function setClipRamp(
  project: ProjectDocument,
  clipId: string,
  ramp: SpeedRamp | null,
): ProjectDocument {
  return editRamp(project, clipId, (current) => mapClip(current, clipId, (clip) => {
    if (clip.kind === "text" || clip.kind === "filter") {
      throw new Error("Text clips do not support speed ramps");
    }
    const normalized = normalizeSpeedRamp(ramp);
    if (!normalized || isFlatRamp(normalized)) {
      const { speedRamp: _dropped, ...rest } = clip;
      return rest as Clip;
    }
    return { ...clip, speedRamp: normalized };
  }));
}

/**
 * Seed a new ramp with two anchors around the playhead (minimum for a curve).
 * Speeds default to 1× → 2× so the ramp is visible immediately.
 */
export function enableSpeedRamp(
  project: ProjectDocument,
  clipId: string,
  playheadTicks: Tick,
  startSpeed = 1,
  endSpeed = 2,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  if (clip.kind === "text" || clip.kind === "filter") {
    throw new Error("Text clips do not support speed ramps");
  }

  const duration = clipDurationTicks(clip);
  const local = Math.min(duration, Math.max(0, playheadTicks - clip.startTicks));
  const progress = local / Math.max(1, duration);
  const half = 0.08;
  let lo = progress - half;
  let hi = progress + half;
  if (lo < 0) {
    hi = Math.min(1, hi - lo);
    lo = 0;
  }
  if (hi > 1) {
    lo = Math.max(0, lo - (hi - 1));
    hi = 1;
  }
  if (hi - lo < 0.1) {
    lo = Math.max(0, Math.min(0.9, progress - 0.05));
    hi = Math.min(1, lo + 0.1);
  }
  return setClipRamp(project, clipId, {
    points: [createSpeedPoint(lo, startSpeed), createSpeedPoint(hi, endSpeed)],
  });
}

/**
 * Add exactly one ramp anchor at the playhead.
 * If the clip has no ramp yet, seeds the minimum 2-point ramp (a curve needs two).
 */
export function addRampPointAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  playheadTicks: Tick,
  speed?: number,
): { project: ProjectDocument; pointId: string } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  if (clip.kind === "text" || clip.kind === "filter") {
    throw new Error("Text clips do not support speed ramps");
  }

  const duration = clipDurationTicks(clip);
  const local = Math.min(duration, Math.max(0, playheadTicks - clip.startTicks));
  let progress = local / Math.max(1, duration);

  const existing = normalizeSpeedRamp(clip.speedRamp);
  if (!existing) {
    // First time: need two anchors to form a curve — not four.
    const seeded = enableSpeedRamp(
      project,
      clipId,
      playheadTicks,
      1,
      speed !== undefined ? clampRampSpeed(speed) : 2,
    );
    const ramp = normalizeSpeedRamp(
      seeded.clips.find((c) => c.id === clipId)?.speedRamp,
    )!;
    return {
      project: seeded,
      pointId: ramp.points[ramp.points.length - 1]!.id,
    };
  }

  const profile = getRampProfile(existing);
  const atSpeed =
    speed !== undefined
      ? clampRampSpeed(speed)
      : (profile?.speedAtProgress(progress) ?? 1);

  progress = Math.min(1 - MIN_RAMP_POINT_GAP, Math.max(MIN_RAMP_POINT_GAP, progress));
  for (const p of existing.points) {
    if (Math.abs(p.atProgress - progress) < MIN_RAMP_POINT_GAP) {
      throw new Error("Playhead too close to an existing ramp point");
    }
  }

  const point = createSpeedPoint(progress, atSpeed);
  const next = normalizeSpeedRamp([...existing.points, point]);
  if (!next) throw new Error("Not enough space for another ramp point");
  return {
    project: editRamp(project, clipId, (current) =>
      mapClip(current, clipId, (c) => ({ ...c, speedRamp: next })),
    ),
    pointId: point.id,
  };
}

const MIN_RAMP_POINT_GAP = 0.005;

/** Move an anchor along the clip (clamped between its neighbors / [0,1]). */
export function moveRampPoint(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  atProgress: number,
): ProjectDocument {
  return editRamp(project, clipId, (current) => mapClip(current, clipId, (clip) => {
    const ramp = normalizeSpeedRamp(clip.speedRamp);
    if (!ramp) throw new Error("Clip has no speed ramp");
    const idx = ramp.points.findIndex((p) => p.id === pointId);
    if (idx < 0) throw new Error("Unknown ramp point");

    const lo =
      idx === 0 ? 0 : ramp.points[idx - 1].atProgress + MIN_RAMP_POINT_GAP;
    const hi =
      idx === ramp.points.length - 1
        ? 1
        : ramp.points[idx + 1].atProgress - MIN_RAMP_POINT_GAP;
    const clamped = Math.min(hi, Math.max(lo, atProgress));
    const points = ramp.points.map((p) =>
      p.id === pointId ? { ...p, atProgress: clamped } : p,
    );
    return { ...clip, speedRamp: normalizeSpeedRamp(points) ?? ramp };
  }));
}

/** Change the speed carried by one anchor. */
export function setRampPointSpeed(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  speed: number,
): ProjectDocument {
  return editRamp(project, clipId, (current) => mapClip(current, clipId, (clip) => {
    const ramp = normalizeSpeedRamp(clip.speedRamp);
    if (!ramp) throw new Error("Clip has no speed ramp");
    if (!ramp.points.some((p) => p.id === pointId)) {
      throw new Error("Unknown ramp point");
    }
    const points = ramp.points.map((p) =>
      p.id === pointId ? { ...p, speed: clampRampSpeed(speed) } : p,
    );
    return { ...clip, speedRamp: normalizeSpeedRamp(points) ?? ramp };
  }));
}

/**
 * Move an anchor and/or change its speed in a single pass (same clamping as
 * `moveRampPoint` + `setRampPointSpeed`). Preferred by drag gestures so one
 * pointermove produces exactly one project update instead of two.
 */
export function updateRampPoint(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  patch: { atProgress?: number; speed?: number },
  options?: { ripple?: boolean },
): ProjectDocument {
  const apply = (current: ProjectDocument) => mapClip(current, clipId, (clip) => {
    const ramp = normalizeSpeedRamp(clip.speedRamp);
    if (!ramp) throw new Error("Clip has no speed ramp");
    const idx = ramp.points.findIndex((p) => p.id === pointId);
    if (idx < 0) throw new Error("Unknown ramp point");
    let points = ramp.points;
    if (patch.atProgress !== undefined) {
      const lo = idx === 0 ? 0 : points[idx - 1].atProgress + MIN_RAMP_POINT_GAP;
      const hi =
        idx === points.length - 1
          ? 1
          : points[idx + 1].atProgress - MIN_RAMP_POINT_GAP;
      const clamped = Math.min(hi, Math.max(lo, patch.atProgress));
      points = points.map((p) =>
        p.id === pointId ? { ...p, atProgress: clamped } : p,
      );
    }
    if (patch.speed !== undefined) {
      points = points.map((p) =>
        p.id === pointId ? { ...p, speed: clampRampSpeed(patch.speed!) } : p,
      );
    }
    return { ...clip, speedRamp: normalizeSpeedRamp(points) ?? ramp };
  });
  // Live drags skip the ripple so the timeline slot stays put until release.
  if (options?.ripple === false) return apply(project);
  return editRamp(project, clipId, apply);
}

/**
 * Restore a clip's timeline duration after a ramp edit by trimming /
 * extending `sourceOutTicks` (timeline start stays anchored — clip width
 * on the track does not grow/shrink while shaping the curve).
 *
 * Extension is capped at the asset's media end when known; hitting the cap
 * lets the duration change only if the caller does not constrain further
 * (see `updateRampPointLocked`).
 * No-op for text clips, unknown clips, or when already within a tick.
 */
export function relockClipDuration(
  project: ProjectDocument,
  clipId: string,
  lockedDurationTicks: Tick,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind === "text" || clip.kind === "filter") return project;
  if (Math.abs(clipDurationTicks(clip) - lockedDurationTicks) <= 1) {
    return project;
  }
  const profile = getRampProfile(clip.speedRamp);
  const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
  const factor = profile ? profile.durationFactor : 1 / speed;
  if (!(factor > 0)) return project;
  const asset =
    clip.assetId != null
      ? project.assets.find((a) => a.id === clip.assetId)
      : undefined;
  const maxSpan =
    asset?.durationTicks != null && asset.durationTicks > clip.sourceInTicks
      ? asset.durationTicks - clip.sourceInTicks
      : Number.POSITIVE_INFINITY;
  const span = Math.min(
    Math.max(1, Math.round(lockedDurationTicks / factor)),
    maxSpan,
  );
  if (span === clip.sourceOutTicks - clip.sourceInTicks) return project;
  return mapClip(project, clipId, (c) => ({
    ...c,
    sourceOutTicks: (c.sourceInTicks + span) as Tick,
  }));
}

/**
 * Drag-style ramp edit. The source range stays; timeline duration follows the
 * curve (fast shrinks the clip, slow lengthens it) and later clips on the
 * track shift with it. `lockedDurationTicks` is ignored — kept so older call
 * sites still compile.
 */
export function updateRampPointLocked(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  patch: { atProgress?: number; speed?: number },
  _lockedDurationTicks?: Tick,
  options?: { ripple?: boolean },
): { project: ProjectDocument; constrained: boolean } {
  return {
    project: updateRampPoint(project, clipId, pointId, patch, options),
    constrained: false,
  };
}

/**
 * Shift later clips on the same track after a ramp drag that changed duration
 * without rippling on each pointer move. `previousDuration` is the timeline
 * length from before the drag.
 */
export function settleRampLayout(
  project: ProjectDocument,
  clipId: string,
  previousDuration: number,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return project;
  return rippleAfterDurationChange(
    project,
    clipId,
    previousDuration,
    clip.startTicks + previousDuration,
    clip.trackId,
  );
}

/**
 * Remove a ramp anchor. Dropping below 2 points (or a flat curve) clears the ramp.
 */
export function removeRampPoint(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
): ProjectDocument {
  return editRamp(project, clipId, (current) => mapClip(current, clipId, (clip) => {
    const ramp = normalizeSpeedRamp(clip.speedRamp);
    if (!ramp) throw new Error("Clip has no speed ramp");
    if (!ramp.points.some((p) => p.id === pointId)) {
      throw new Error("Unknown ramp point");
    }
    const points = ramp.points.filter((p) => p.id !== pointId);
    const next = normalizeSpeedRamp(points);
    if (!next || isFlatRamp(next)) {
      const { speedRamp: _dropped, ...rest } = clip;
      return rest as Clip;
    }
    return { ...clip, speedRamp: next };
  }));
}

/** Split a ramp at a source progress; used by splitClipAt for ramped clips. */
export { sliceRamp };

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
