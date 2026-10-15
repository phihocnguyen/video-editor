import {
  DEFAULT_CLIP_EFFECTS,
  effectsAreDefault,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";
import {
  cloneEffectKeyframes,
  effectsAtProgress,
  findKeyframeNear,
  getParamTrack,
  normalizeEffectKeyframes,
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
import {
  createDefaultTextStyle,
  normalizeTextStyle,
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
  return Math.max(0, Math.round(source / speed));
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

  return withUpdatedClips(working, [...working.clips, clip]);
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
    effectKeyframes: cloneEffectKeyframes(clip.effectKeyframes ?? null),
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
  options?: { pruneEmptySource?: boolean },
): ProjectDocument {
  const source = project.clips.find((c) => c.id === clipId);
  const sourceTrackId = source?.trackId;
  const nextTrackId = trackId ?? sourceTrackId;

  let next = mapClip(project, clipId, (clip) => {
    const destId = trackId ?? clip.trackId;
    const track = project.tracks.find((t) => t.id === destId);
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
  return next;
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

  // Where in the source range the cut lands — ramp-aware when a curve is set.
  const splitSourceOffset = sourceOffsetForClipTimelineOffset(clip, local);
  const splitSource = Math.round(clip.sourceInTicks + splitSourceOffset);
  if (splitSource <= clip.sourceInTicks || splitSource >= clip.sourceOutTicks) {
    return project;
  }

  const span = Math.max(1, clip.sourceOutTicks - clip.sourceInTicks);
  const splitProgress = (splitSource - clip.sourceInTicks) / span;
  const rampSplit = clip.speedRamp
    ? sliceRamp(clip.speedRamp, 0, splitProgress)
    : null;
  const rampRight = clip.speedRamp
    ? sliceRamp(clip.speedRamp, splitProgress, 1)
    : null;
  const timelineSplit = local / duration;
  const fxLeft = sliceEffectKeyframes(clip.effectKeyframes ?? null, 0, timelineSplit);
  const fxRight = sliceEffectKeyframes(clip.effectKeyframes ?? null, timelineSplit, 1);

  const left: Clip = {
    ...clip,
    sourceOutTicks: splitSource,
    ...(rampSplit ? { speedRamp: rampSplit } : {}),
    effectKeyframes: fxLeft,
  };
  const right: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    startTicks: timelineTicks,
    sourceInTicks: splitSource,
    ...(rampRight ? { speedRamp: rampRight } : {}),
    effectKeyframes: fxRight,
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
    const resolved = effectsAtProgress(clip.effects, clip.effectKeyframes, progress);
    const value = readBaseParam(resolved, param);
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
  patch: Partial<ProjectDocument["canvas"]>,
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
  return {
    ...project,
    canvas: { width, height, frameRate, backgroundColor },
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
    if (clip.kind === "text") throw new Error("Text clips do not support speed");
    // A constant speed supersedes (and clears) any ramp so the change is visible.
    const { speedRamp: _dropped, ...rest } = clip;
    return { ...(rest as Clip), speed: Math.min(8, Math.max(0.1, speed)) };
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
  if (clip.kind === "text") {
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
export function setClipRamp(
  project: ProjectDocument,
  clipId: string,
  ramp: SpeedRamp | null,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    if (clip.kind === "text") throw new Error("Text clips do not support speed ramps");
    const normalized = normalizeSpeedRamp(ramp);
    if (!normalized || isFlatRamp(normalized)) {
      const { speedRamp: _dropped, ...rest } = clip;
      return rest as Clip;
    }
    return { ...clip, speedRamp: normalized };
  });
}

/**
 * Seed a brand-new ramp with two anchors centered on the playhead.
 * Both points are freely draggable; the curve exists only between them.
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
  if (clip.kind === "text") throw new Error("Text clips do not support speed ramps");

  const duration = clipDurationTicks(clip);
  const local = Math.min(duration, Math.max(0, playheadTicks - clip.startTicks));
  const progress = local / Math.max(1, duration);
  // ~16% window around the playhead so the curve is visibly "at" the playhead.
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
 * Create a ramp anchor at the playhead. If the clip has no ramp yet, seeds a
 * 2-point ramp around the playhead first.
 */
export function addRampPointAtPlayhead(
  project: ProjectDocument,
  clipId: string,
  playheadTicks: Tick,
  speed = 1,
): { project: ProjectDocument; pointId: string } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  if (clip.kind === "text") throw new Error("Text clips do not support speed ramps");

  const duration = clipDurationTicks(clip);
  const local = Math.min(duration, Math.max(0, playheadTicks - clip.startTicks));
  let progress = local / Math.max(1, duration);

  const existing = normalizeSpeedRamp(clip.speedRamp);
  if (!existing) {
    // Brand-new: two points spanning a window around the playhead.
    const lo = Math.max(0.02, Math.min(0.7, progress - 0.15));
    const hi = Math.min(0.98, Math.max(lo + 0.2, progress + 0.15));
    const a = createSpeedPoint(lo, 1);
    const b = createSpeedPoint(hi, speed);
    const next = normalizeSpeedRamp([a, b])!;
    return {
      project: mapClip(project, clipId, (c) => ({ ...c, speedRamp: next })),
      pointId: b.id,
    };
  }

  // Keep new points strictly between existing first/last (curve region).
  const lo = existing.points[0].atProgress + MIN_RAMP_POINT_GAP;
  const hi = existing.points[existing.points.length - 1].atProgress - MIN_RAMP_POINT_GAP;
  if (hi <= lo) throw new Error("Not enough space for another ramp point");
  progress = Math.min(hi, Math.max(lo, progress));
  const point = createSpeedPoint(progress, speed);
  const next = normalizeSpeedRamp([...existing.points, point])!;
  return {
    project: mapClip(project, clipId, (c) => ({ ...c, speedRamp: next })),
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
  return mapClip(project, clipId, (clip) => {
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
  });
}

/** Change the speed carried by one anchor. */
export function setRampPointSpeed(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  speed: number,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
    const ramp = normalizeSpeedRamp(clip.speedRamp);
    if (!ramp) throw new Error("Clip has no speed ramp");
    if (!ramp.points.some((p) => p.id === pointId)) {
      throw new Error("Unknown ramp point");
    }
    const points = ramp.points.map((p) =>
      p.id === pointId ? { ...p, speed: clampRampSpeed(speed) } : p,
    );
    return { ...clip, speedRamp: normalizeSpeedRamp(points) ?? ramp };
  });
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
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
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
}

/**
 * Restore a clip's timeline duration after a ramp edit by trimming /
 * extending `sourceOutTicks` (the timeline start stays anchored, so the
 * track never stretches while dragging — Premiere-style).
 *
 * Extension is capped at the asset's media end when known; hitting the cap
 * lets the duration change (unavoidable: no more source to consume).
 * No-op for text clips, unknown clips, or when already within a tick.
 */
export function relockClipDuration(
  project: ProjectDocument,
  clipId: string,
  lockedDurationTicks: Tick,
): ProjectDocument {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind === "text") return project;
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
 * Drag-style ramp edit that NEVER changes the timeline duration (Premiere
 * behavior): the patch is applied, then the duration is relocked. When the
 * relock would hit the media end, the patch is pulled back (bisection
 * between the current point state and the desired patch) until it fits, so
 * the point feels "blocked" at the wall instead of stretching the track.
 *
 * Returns the project plus whether the patch had to be constrained.
 */
export function updateRampPointLocked(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
  patch: { atProgress?: number; speed?: number },
  lockedDurationTicks: Tick,
): { project: ProjectDocument; constrained: boolean } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error("Unknown clipId");
  if (clip.kind === "text") throw new Error("Text clips do not support speed ramps");
  const ramp = normalizeSpeedRamp(clip.speedRamp);
  if (!ramp) throw new Error("Clip has no speed ramp");
  const current = ramp.points.find((p) => p.id === pointId);
  if (!current) throw new Error("Unknown ramp point");

  const fits = (candidate: ProjectDocument): boolean => {
    const after = candidate.clips.find((c) => c.id === clipId);
    return (
      !!after && Math.abs(clipDurationTicks(after) - lockedDurationTicks) <= 1
    );
  };
  const apply = (
    base: ProjectDocument,
    atProgress: number,
    speed: number,
  ): ProjectDocument =>
    relockClipDuration(
      updateRampPoint(base, clipId, pointId, { atProgress, speed }),
      clipId,
      lockedDurationTicks,
    );

  const wantProgress = patch.atProgress ?? current.atProgress;
  const wantSpeed = patch.speed ?? current.speed;
  const direct = apply(project, wantProgress, wantSpeed);
  if (fits(direct)) return { project: direct, constrained: false };

  // Pull the patch back toward the current state until the duration fits.
  let feasible = 0;
  let infeasible = 1;
  for (let i = 0; i < 10; i += 1) {
    const mid = (feasible + infeasible) / 2;
    const trial = apply(
      project,
      current.atProgress + (wantProgress - current.atProgress) * mid,
      current.speed + (wantSpeed - current.speed) * mid,
    );
    if (fits(trial)) feasible = mid;
    else infeasible = mid;
  }
  if (feasible <= 0) return { project, constrained: true };
  const progress =
    current.atProgress + (wantProgress - current.atProgress) * feasible;
  const speed = current.speed + (wantSpeed - current.speed) * feasible;
  // Fully blocked (the patch collapses onto the current state) or moving by
  // an imperceptible epsilon (sub-pixel): return the ORIGINAL project so
  // zustand skips notifying (no re-render storm, no thumbnail/waveform
  // recompute while the point sits at the wall).
  const sameProgress = Math.abs(progress - current.atProgress) < 0.0005;
  const sameSpeed =
    Math.abs(speed - current.speed) < Math.abs(current.speed) * 0.002 + 1e-9;
  if (sameProgress && sameSpeed) {
    return { project, constrained: true };
  }
  const pulled = apply(project, progress, speed);
  return {
    project: fits(pulled) ? pulled : project,
    constrained: feasible < 0.999,
  };
}

/**
 * Remove a ramp anchor. Dropping below 2 points (or a flat curve) clears the ramp.
 */
export function removeRampPoint(
  project: ProjectDocument,
  clipId: string,
  pointId: string,
): ProjectDocument {
  return mapClip(project, clipId, (clip) => {
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
  });
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
