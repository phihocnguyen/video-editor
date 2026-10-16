import { describe, expect, it } from "vitest";
import {
  addFilterOverlay,
  addMediaClip,
  clipDurationTicks,
  createEmptyProject,
  FILTER_TEMPLATES,
  findMatchingFilterTemplate,
  fitFilterFull,
  normalizeClipEffects,
  recolorFilterClip,
  removeFilterClips,
  type MediaAsset,
} from "../../src/domain";

function videoAsset(): MediaAsset {
  return {
    id: "vid",
    kind: "video",
    path: "C:/media/clip.mp4",
    name: "clip.mp4",
    durationTicks: 4_000_000,
    width: 1280,
    height: 720,
    frameRate: 30,
    hasAudio: false,
    missing: false,
  };
}

describe("filter templates", () => {
  it("uses a vertical wash for every city, with no shared gradient", () => {
    const cities = FILTER_TEMPLATES.filter((template) => template.id !== "none");
    const keys = new Set<string>();
    for (const template of cities) {
      expect(template.patch.tintBlend).toBe("normal");
      expect(template.patch.tintAmount).toBe(0.78);
      expect(template.patch.tintGradient).toHaveLength(5);
      expect(template.swatch.startsWith("linear-gradient(to bottom")).toBe(true);
      keys.add(template.patch.tintGradient!.join(","));
    }
    expect(keys.size).toBe(cities.length);
  });

  it("lists the city looks", () => {
    const labels = FILTER_TEMPLATES.map((template) => template.label);
    expect(labels).toContain("Rio de Janeiro");
    expect(labels).toContain("New York");
    expect(labels).toContain("Original");
  });

  it("puts the wash on a new track and leaves the media clip alone", () => {
    let project = createEmptyProject();
    project = { ...project, assets: [...project.assets, videoAsset()] };
    project = addMediaClip(project, "vid", { startTicks: 0 });
    const media = project.clips[project.clips.length - 1]!;
    const before = normalizeClipEffects(media.effects);

    const added = addFilterOverlay(project, "rio", media.startTicks, clipDurationTicks(media));
    const wash = added.project.clips.find((item) => item.id === added.clipId)!;
    const mediaAfter = added.project.clips.find((item) => item.id === media.id)!;
    const lane = added.project.tracks.find((track) => track.id === wash.trackId)!;

    expect(wash.kind).toBe("filter");
    expect(lane.name).toBe("Filter");
    expect(lane.order).toBeLessThan(
      added.project.tracks.find((track) => track.id === media.trackId)!.order,
    );
    expect(wash.effects.tintGradient[0]?.toLowerCase()).toBe("#4e2022");
    expect(findMatchingFilterTemplate(wash.effects)?.id).toBe("rio");
    expect(mediaAfter.effects.tintAmount).toBe(before.tintAmount);
    expect(clipDurationTicks(wash)).toBe(clipDurationTicks(media));
  });

  it("reuses the filter lane for a later section and stacks when they overlap", () => {
    let project = createEmptyProject();
    const first = addFilterOverlay(project, "rio", 0, 2_000_000);
    project = first.project;
    const second = addFilterOverlay(project, "tokyo", 3_000_000, 1_000_000);
    expect(second.project.clips.find((clip) => clip.id === second.clipId)!.trackId).toBe(
      first.project.clips.find((clip) => clip.id === first.clipId)!.trackId,
    );
    const third = addFilterOverlay(second.project, "paris", 500_000, 1_000_000);
    const thirdClip = third.project.clips.find((clip) => clip.id === third.clipId)!;
    expect(thirdClip.trackId).not.toBe(
      first.project.clips.find((clip) => clip.id === first.clipId)!.trackId,
    );
    expect(third.project.tracks.find((track) => track.id === thirdClip.trackId)!.name).toBe(
      "Filter 2",
    );
  });

  it("original removes the filter clip and the empty lane", () => {
    let project = createEmptyProject();
    const added = addFilterOverlay(project, "newyork", 0, 2_000_000);
    project = recolorFilterClip(added.project, added.clipId, "none");
    expect(project.clips.some((clip) => clip.kind === "filter")).toBe(false);
    expect(project.tracks.some((track) => track.name === "Filter")).toBe(false);
    expect(removeFilterClips(added.project, [added.clipId]).clips).toHaveLength(0);
  });

  it("full stretches a filter to the media clip underneath", () => {
    let project = createEmptyProject();
    project = { ...project, assets: [...project.assets, videoAsset()] };
    project = addMediaClip(project, "vid", { startTicks: 1_000_000 });
    const media = project.clips[project.clips.length - 1]!;
    const added = addFilterOverlay(project, "rio", 1_500_000, 500_000);
    const fitted = fitFilterFull(added.project, added.clipId);
    const wash = fitted.clips.find((clip) => clip.id === added.clipId)!;
    expect(wash.startTicks).toBe(media.startTicks);
    expect(clipDurationTicks(wash)).toBe(clipDurationTicks(media));

    const fromMedia = fitFilterFull(added.project, media.id);
    const washFromMedia = fromMedia.clips.find((clip) => clip.id === added.clipId)!;
    expect(washFromMedia.startTicks).toBe(media.startTicks);
    expect(clipDurationTicks(washFromMedia)).toBe(clipDurationTicks(media));
  });
});
