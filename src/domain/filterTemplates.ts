import {
  applyEffectPreset,
  effectsMatchPreset,
  type EffectPreset,
} from "./effectPresets";
import { DEFAULT_CLIP_EFFECTS, type ClipEffects } from "./effects";
import type { EffectKeyframes } from "./effectKeyframes";
import type { Clip, ProjectDocument } from "./project";
import { DEFAULT_CLIP_TRANSITION } from "./transitions";
import {
  addTrack,
  clipDurationTicks,
  deleteClips,
  pruneEmptyTrack,
  setClipEffectKeyframes,
  updateClipEffects,
} from "./timelineCommands";

export type FilterTemplateGroup = "warm" | "cool" | "film";

export interface FilterTemplate extends EffectPreset {
  group: FilterTemplateGroup;
  hint: string;
}

const NEUTRAL: Partial<ClipEffects> = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
  grayscale: false,
  vignette: 0,
  sharpen: 0,
  sepia: 0,
  hueRotate: 0,
  tintColor: "#000000",
  tintGradient: [],
  tintAmount: 0,
  tintBlend: "soft-light",
};

const WASH_AMOUNT = 0.78;

/** Same cover as Rio: a vertical story wash, no photo, no extra grade. */
function storyWash(
  id: string,
  label: string,
  group: FilterTemplateGroup,
  hint: string,
  stops: readonly [string, string, string, string, string],
): FilterTemplate {
  return {
    id,
    label,
    group,
    hint,
    swatch: `linear-gradient(to bottom, ${stops
      .map((color, index) => `${color} ${index * 25}%`)
      .join(", ")})`,
    patch: {
      ...NEUTRAL,
      tintColor: stops[0],
      tintGradient: [...stops],
      tintAmount: WASH_AMOUNT,
      tintBlend: "normal",
    },
  };
}

/** Instagram-style color washes. Click applies the look onto a video or image clip. */
export const FILTER_TEMPLATES: FilterTemplate[] = [
  {
    id: "none",
    label: "Original",
    group: "film",
    hint: "Clear the color wash",
    swatch: "linear-gradient(160deg, #d7dbe3 0%, #8d93a0 100%)",
    patch: { ...NEUTRAL },
  },
  storyWash("rio", "Rio de Janeiro", "warm", "Dusk red into deep violet", [
    "#4E2022",
    "#461B2F",
    "#3F1A34",
    "#33183B",
    "#281E41",
  ]),
  storyWash("newyork", "New York", "cool", "Steel blue into midnight", [
    "#2C3A4A",
    "#243448",
    "#1E2C44",
    "#18243C",
    "#121C34",
  ]),
  storyWash("losangeles", "Los Angeles", "warm", "Coral dusk into wine", [
    "#6A3428",
    "#5C2A32",
    "#4A2038",
    "#361830",
    "#241428",
  ]),
  storyWash("tokyo", "Tokyo", "cool", "Cyan night into indigo", [
    "#1E4A58",
    "#243868",
    "#2A2870",
    "#241858",
    "#181040",
  ]),
  storyWash("paris", "Paris", "film", "Rose into plum", [
    "#5A3038",
    "#4E2838",
    "#402038",
    "#321830",
    "#241428",
  ]),
  storyWash("london", "London", "cool", "Fog green into slate", [
    "#3A4848",
    "#324044",
    "#2A3840",
    "#222E38",
    "#1A242C",
  ]),
  storyWash("miami", "Miami", "film", "Teal into magenta", [
    "#1A5854",
    "#1E4860",
    "#3A3868",
    "#5A2860",
    "#3A1848",
  ]),
  storyWash("sahara", "Sahara", "warm", "Ochre into umber", [
    "#6A4A2C",
    "#5A3A24",
    "#4A2C1C",
    "#362018",
    "#241410",
  ]),
  storyWash("nordic", "Nordic", "cool", "Ice blue into fjord", [
    "#2A4A5C",
    "#244454",
    "#1E3A4C",
    "#183044",
    "#122438",
  ]),
  storyWash("brooklyn", "Brooklyn", "film", "Warm brown into charcoal", [
    "#4A3A30",
    "#40322C",
    "#342828",
    "#282024",
    "#1C181C",
  ]),
  storyWash("havana", "Havana", "warm", "Gold into burnt sienna", [
    "#6A5428",
    "#5A4024",
    "#4A3020",
    "#382018",
    "#241410",
  ]),
  storyWash("seoul", "Seoul", "cool", "Blush into lilac", [
    "#5A3848",
    "#4E3054",
    "#402860",
    "#322058",
    "#241848",
  ]),
  storyWash("venice", "Venice", "warm", "Amber into lagoon teal", [
    "#5A4830",
    "#4A3C38",
    "#3A3848",
    "#2C3848",
    "#1C3040",
  ]),
  storyWash("cairo", "Cairo", "warm", "Terracotta into maroon", [
    "#6A3424",
    "#5A2C22",
    "#4A221C",
    "#381818",
    "#241410",
  ]),
];

export const FILTER_TEMPLATE_GROUPS: { id: "all" | FilterTemplateGroup; label: string }[] = [
  { id: "all", label: "All" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "film", label: "Film" },
];

export function filterTemplateById(id: string): FilterTemplate | null {
  return FILTER_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function findMatchingFilterTemplate(effects: ClipEffects): FilterTemplate | null {
  for (const template of FILTER_TEMPLATES) {
    if (template.id === "none") continue;
    if (effectsMatchPreset(effects, template)) return template;
  }
  const original = FILTER_TEMPLATES[0];
  if (original && effectsMatchPreset(effects, original)) return original;
  return null;
}

const COLOR_PARAM_KEYS = new Set([
  "brightness",
  "contrast",
  "saturation",
  "blur",
  "vignette",
  "sharpen",
  "grayscale",
]);

const DEFAULT_WASH_TICKS = 5_000_000;

function isFilterLane(project: ProjectDocument, trackId: string): boolean {
  const clips = project.clips.filter((clip) => clip.trackId === trackId);
  return clips.length > 0 && clips.every((clip) => clip.kind === "filter");
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

function laneOverlaps(
  project: ProjectDocument,
  trackId: string,
  start: number,
  end: number,
): boolean {
  return project.clips.some((clip) => {
    if (clip.trackId !== trackId) return false;
    const otherEnd = clip.startTicks + clipDurationTicks(clip);
    return rangesOverlap(start, end, clip.startTicks, otherEnd);
  });
}

function nextFilterTrackName(project: ProjectDocument): string {
  const names = new Set(project.tracks.map((track) => track.name));
  if (!names.has("Filter")) return "Filter";
  let index = 2;
  while (names.has(`Filter ${index}`)) index += 1;
  return `Filter ${index}`;
}

/**
 * Drop a wash onto its own video track above the picture. Trim that clip to
 * cover only the section that should be filtered. A free Filter lane is reused;
 * an overlapping one gets a new lane on top.
 */
export function addFilterOverlay(
  project: ProjectDocument,
  templateId: string,
  startTicks: number,
  durationTicks: number,
): { project: ProjectDocument; clipId: string } {
  const template = filterTemplateById(templateId);
  if (!template || template.id === "none") return { project, clipId: "" };

  const start = Math.max(0, Math.round(startTicks));
  const duration = Math.max(100_000, Math.round(durationTicks || DEFAULT_WASH_TICKS));
  const end = start + duration;

  const lanes = project.tracks
    .filter((track) => track.kind === "video" && !track.locked && isFilterLane(project, track.id))
    .sort((a, b) => a.order - b.order);
  let working = project;
  let track = lanes.find((lane) => !laneOverlaps(working, lane.id, start, end));
  if (!track) {
    const before = new Set(working.tracks.map((item) => item.id));
    working = addTrack(working, "video", {
      name: nextFilterTrackName(working),
      position: "top",
    });
    track = working.tracks.find((item) => !before.has(item.id));
  }
  if (!track) return { project, clipId: "" };

  const clipId = crypto.randomUUID();
  const clip: Clip = {
    id: clipId,
    trackId: track.id,
    assetId: null,
    kind: "filter",
    startTicks: start,
    sourceInTicks: 0,
    sourceOutTicks: duration,
    speed: 1,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      blendMode: "normal",
    },
    volume: 0,
    effects: applyEffectPreset({ ...DEFAULT_CLIP_EFFECTS }, template),
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text: null,
  };
  return {
    clipId,
    project: {
      ...working,
      clips: [...working.clips, clip],
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Stretch a filter clip so it covers one whole media clip on the timeline. */
export function fitFilterFull(project: ProjectDocument, clipId: string): ProjectDocument {
  const clip = project.clips.find((item) => item.id === clipId);
  if (!clip) return project;

  if (clip.kind === "filter") {
    const media = visualMediaUnder(project, clip);
    if (!media) return project;
    return setFilterSpan(project, clip.id, media.startTicks, clipDurationTicks(media));
  }

  if (!isVisualMediaClip(project, clip)) return project;
  const filter = topFilterOver(project, clip);
  if (!filter) return project;
  return setFilterSpan(project, filter.id, clip.startTicks, clipDurationTicks(clip));
}

export function canFitFilterFull(project: ProjectDocument, clipId: string | undefined): boolean {
  if (!clipId) return false;
  const clip = project.clips.find((item) => item.id === clipId);
  if (!clip) return false;
  if (clip.kind === "filter") return visualMediaUnder(project, clip) != null;
  if (!isVisualMediaClip(project, clip)) return false;
  return topFilterOver(project, clip) != null;
}

function isVisualMediaClip(project: ProjectDocument, clip: Clip): boolean {
  if (clip.kind !== "media" || !clip.assetId) return false;
  const asset = project.assets.find((item) => item.id === clip.assetId);
  if (!asset || asset.kind === "audio") return false;
  const track = project.tracks.find((item) => item.id === clip.trackId);
  return track?.kind !== "audio";
}

function clipEndTicks(clip: Clip): number {
  return clip.startTicks + clipDurationTicks(clip);
}

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function visualMediaUnder(project: ProjectDocument, filter: Clip): Clip | null {
  const start = filter.startTicks;
  const end = clipEndTicks(filter);
  let best: Clip | null = null;
  let bestOverlap = 0;
  for (const clip of project.clips) {
    if (!isVisualMediaClip(project, clip)) continue;
    const overlap = overlapLength(start, end, clip.startTicks, clipEndTicks(clip));
    if (overlap > bestOverlap) {
      best = clip;
      bestOverlap = overlap;
    }
  }
  return best;
}

function topFilterOver(project: ProjectDocument, media: Clip): Clip | null {
  const order = new Map(project.tracks.map((track) => [track.id, track.order]));
  const start = media.startTicks;
  const end = clipEndTicks(media);
  const hits = project.clips.filter(
    (clip) =>
      clip.kind === "filter" &&
      overlapLength(start, end, clip.startTicks, clipEndTicks(clip)) > 0,
  );
  hits.sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  return hits[0] ?? null;
}

function setFilterSpan(
  project: ProjectDocument,
  filterId: string,
  startTicks: number,
  durationTicks: number,
): ProjectDocument {
  const duration = Math.max(100_000, Math.round(durationTicks));
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    clips: project.clips.map((clip) =>
      clip.id === filterId && clip.kind === "filter"
        ? {
            ...clip,
            startTicks: Math.max(0, Math.round(startTicks)),
            sourceInTicks: 0,
            sourceOutTicks: duration,
            speed: 1,
            speedRamp: null,
          }
        : clip,
    ),
  };
}

/** Change the wash on an existing filter clip. Original removes the clip. */
export function recolorFilterClip(
  project: ProjectDocument,
  clipId: string,
  templateId: string,
): ProjectDocument {
  const template = filterTemplateById(templateId);
  const clip = project.clips.find((item) => item.id === clipId);
  if (!template || !clip || clip.kind !== "filter") return project;
  if (template.id === "none") return removeFilterClips(project, [clipId]);
  let next = updateClipEffects(project, clipId, applyEffectPreset(clip.effects, template));
  const updated = next.clips.find((item) => item.id === clipId);
  const kept = (updated?.effectKeyframes?.tracks ?? []).filter(
    (track) => !COLOR_PARAM_KEYS.has(track.param),
  );
  if (updated?.effectKeyframes) {
    const keyframes: EffectKeyframes | null = kept.length > 0 ? { tracks: kept } : null;
    next = setClipEffectKeyframes(next, clipId, keyframes);
  }
  return next;
}

/** Delete filter clips and drop a Filter lane once it is empty. */
export function removeFilterClips(
  project: ProjectDocument,
  clipIds: readonly string[],
): ProjectDocument {
  const ids = clipIds.filter((id) => {
    const clip = project.clips.find((item) => item.id === id);
    return clip?.kind === "filter";
  });
  if (ids.length === 0) return project;
  const trackIds = new Set(
    ids.map((id) => project.clips.find((item) => item.id === id)?.trackId).filter(Boolean) as string[],
  );
  let next = deleteClips(project, ids);
  for (const trackId of trackIds) next = pruneEmptyTrack(next, trackId);
  return next;
}

/** Topmost filter clip covering a timeline time, if any. */
export function filterClipAt(
  project: ProjectDocument,
  ticks: number,
): Clip | null {
  const order = new Map(project.tracks.map((track) => [track.id, track.order]));
  const covered = project.clips.filter((clip) => {
    if (clip.kind !== "filter") return false;
    const end = clip.startTicks + clipDurationTicks(clip);
    return ticks >= clip.startTicks && ticks < end;
  });
  covered.sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  return covered[0] ?? null;
}
