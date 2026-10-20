import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  clipVisibleWithTransition,
  createEmptyProject,
  DEFAULT_CLIP_EFFECTS,
  incomingTransitionProgress,
  normalizeClipTransition,
  playheadInTransitionWindow,
  TRANSITION_DEFS,
  transitionDef,
  transitionOpacityPair,
  transitionPreview,
  updateClipTransition,
  type Clip,
  type MediaAsset,
} from "../../src/domain";

describe("transitions", () => {
  it("normalizes transition defaults", () => {
    expect(normalizeClipTransition(undefined).type).toBe("none");
    expect(normalizeClipTransition({ type: "dissolve", durationTicks: 800_000 }).type).toBe(
      "dissolve",
    );
  });

  it("computes dissolve opacity pair", () => {
    expect(transitionOpacityPair("dissolve", 0)).toEqual({ prev: 1, curr: 0 });
    expect(transitionOpacityPair("dissolve", 1)).toEqual({ prev: 0, curr: 1 });
    expect(transitionOpacityPair("fade", 0.25).curr).toBe(0);
    expect(transitionOpacityPair("fade", 0.75).prev).toBe(0);
  });

  it("is mid-blend at the cut marker", () => {
    const clip: Clip = {
      id: "c1",
      trackId: "t1",
      assetId: "a1",
      kind: "media",
      startTicks: 1_000_000,
      sourceInTicks: 0,
      sourceOutTicks: 2_000_000,
      speed: 1,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      volume: 1,
      effects: { ...DEFAULT_CLIP_EFFECTS },
      transitionIn: normalizeClipTransition({
        type: "dissolve",
        durationTicks: 600_000,
      }),
      text: null,
    };
    const atCut = incomingTransitionProgress(clip, 1_000_000);
    expect(atCut).not.toBeNull();
    expect(atCut!.progress).toBeCloseTo(0.5, 5);
    const before = incomingTransitionProgress(clip, 1_000_000 - 300_000);
    expect(before!.progress).toBeCloseTo(0, 5);
    const after = incomingTransitionProgress(clip, 1_000_000 + 300_000);
    expect(after!.progress).toBeCloseTo(1, 5);
  });

  it("adds overlap into render plan and filter when clips abut", () => {
    let project = createEmptyProject();
    const mk = (id: string, name: string): MediaAsset => ({
      id,
      kind: "video",
      path: `C:/media/${name}`,
      name,
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: false,
      missing: false,
    });
    project = { ...project, assets: [mk("a1", "a.mp4"), mk("a2", "b.mp4")] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    // Transitions blend same-lane neighbors — pin both clips to one track
    // (the default add flow would spread them across lanes).
    const laneId = project.clips.find((c) => c.assetId === "a1")!.trackId;
    project = addMediaClip(project, "a2", { trackId: laneId, startTicks: 3_000_000 });
    const second = project.clips.find((c) => c.assetId === "a2")!;
    project = updateClipTransition(project, second.id, {
      type: "dissolve",
      durationTicks: 600_000,
    });
    const plan = buildRenderPlan(project, "720", "draft");
    const b = plan.clips.find((c) => c.clipId === second.id)!;
    expect(b.transitionIn.type).toBe("dissolve");
    // Centered on cut → only D/2 early overlap
    expect(b.transitionOverlapSec).toBeCloseTo(0.3, 1);
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fade");
    expect(filter).toContain("tpad=stop_mode=clone");
    expect(filter).toContain("format=rgba[base]");
    expect(filter).toContain("offset=2.700");
  });

  it("keeps transition overlap even when clips have a small gap", () => {
    let project = createEmptyProject();
    const mk = (id: string, name: string): MediaAsset => ({
      id,
      kind: "video",
      path: `C:/media/${name}`,
      name,
      durationTicks: 2_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: false,
      missing: false,
    });
    project = { ...project, assets: [mk("a1", "a.mp4"), mk("a2", "b.mp4")] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    project = addMediaClip(project, "a2", { startTicks: 2_200_000 }); // 0.2s gap
    const second = project.clips.find((c) => c.assetId === "a2")!;
    project = updateClipTransition(project, second.id, {
      type: "dissolve",
      durationTicks: 600_000,
    });
    const plan = buildRenderPlan(project, "720", "draft");
    const b = plan.clips.find((c) => c.clipId === second.id)!;
    expect(b.transitionOverlapSec).toBeGreaterThan(0.2);
  });

  it("normalizes fade-family transition types", () => {
    for (const def of TRANSITION_DEFS) {
      expect(normalizeClipTransition({ type: def.type }).type).toBe(def.type);
    }
    expect(TRANSITION_DEFS).toHaveLength(12);
    expect(new Set(TRANSITION_DEFS.map((d) => d.type)).size).toBe(12);
    expect(transitionDef("dissolve").xfade).toBe("fade");
    expect(transitionDef("fade").xfade).toBe("fadeblack");
    expect(transitionDef("fadeWhite").xfade).toBe("fadewhite");
    expect(transitionDef("none").xfade).toBeNull();
    expect(transitionDef("wipeLeft").xfade).toBe("wipeleft");
    expect(transitionDef("slideLeft").xfade).toBe("slideleft");
    // Unknown / legacy types collapse to a hard cut.
    expect(normalizeClipTransition({ type: "cubeSpin" as never }).type).toBe("none");
  });

  it("preview visual is opacity-only", () => {
    const mid = transitionPreview("dissolve", 0.5);
    expect(mid.opacity).toBeGreaterThan(0.4);
    expect(mid.opacity).toBeLessThan(0.6);
    expect(transitionPreview("fade", 0).opacity).toBe(0);
    expect(transitionPreview("fade", 1).opacity).toBe(1);
  });

  it("wipe reveals via clip-path and slide offsets both layers", async () => {
    const { transitionVisualPair } = await import("../../src/domain/transitions");
    const wipe = transitionVisualPair("wipeLeft", 0.5);
    expect(wipe.curr.clipPath).toContain("inset(");
    expect(wipe.prev.opacity).toBe(1);
    expect(wipe.curr.opacity).toBe(1);
    const slide = transitionVisualPair("slideLeft", 0);
    expect(slide.curr.offsetXPct).toBeCloseTo(100, 5);
    expect(slide.prev.offsetXPct).toBeCloseTo(0, 5);
    const slideEnd = transitionVisualPair("slideLeft", 1);
    expect(slideEnd.curr.offsetXPct).toBeCloseTo(0, 5);
    expect(slideEnd.prev.offsetXPct).toBeCloseTo(-100, 5);
  });

  it("text animations combine fades and slide offsets", async () => {
    const { textAnimVisual, DEFAULT_TEXT_ANIMATION } = await import(
      "../../src/domain/project"
    );
    const base = textAnimVisual(null, { fadeInSec: 1, fadeOutSec: 0 }, 0.5, 4);
    expect(base.opacity).toBeCloseTo(0.5, 5);
    const slide = textAnimVisual(
      { ...DEFAULT_TEXT_ANIMATION, in: "slideUp", inDurationSec: 1 },
      { fadeInSec: 0, fadeOutSec: 0 },
      0.5,
      4,
    );
    expect(slide.offsetY).toBeGreaterThan(0);
    expect(slide.opacity).toBeLessThan(1);
    const settled = textAnimVisual(
      { ...DEFAULT_TEXT_ANIMATION, in: "slideUp", inDurationSec: 1 },
      { fadeInSec: 0, fadeOutSec: 0 },
      2,
      4,
    );
    expect(settled.offsetY).toBe(0);
    expect(settled.opacity).toBe(1);
  });

  it("text wipes reveal with clip-path and fade-white flashes", async () => {
    const { textAnimVisual, DEFAULT_TEXT_ANIMATION } = await import(
      "../../src/domain/project"
    );
    const wipe = textAnimVisual(
      { ...DEFAULT_TEXT_ANIMATION, in: "wipeRight", inDurationSec: 1 },
      { fadeInSec: 0, fadeOutSec: 0 },
      0.5,
      4,
    );
    expect(wipe.clipPath).toContain("inset(");
    expect(wipe.opacity).toBe(1);
    const white = textAnimVisual(
      { ...DEFAULT_TEXT_ANIMATION, in: "fadeWhite", inDurationSec: 1 },
      { fadeInSec: 0, fadeOutSec: 0 },
      0.5,
      4,
    );
    expect(white.whiteFlash).toBeGreaterThan(0);
    expect(white.clipPath).toBeNull();
  });

  it("hands visibility from clip1 to clip2 across a centered dissolve", () => {
    let project = createEmptyProject();
    const mk = (id: string, name: string): MediaAsset => ({
      id,
      kind: "video",
      path: `C:/media/${name}`,
      name,
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: false,
      missing: false,
    });
    project = { ...project, assets: [mk("a1", "a.mp4"), mk("a2", "b.mp4")] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const laneId = project.clips.find((c) => c.assetId === "a1")!.trackId;
    project = addMediaClip(project, "a2", { trackId: laneId, startTicks: 3_000_000 });
    const first = project.clips.find((c) => c.assetId === "a1")!;
    const second = project.clips.find((c) => c.assetId === "a2")!;
    project = updateClipTransition(project, second.id, {
      type: "dissolve",
      durationTicks: 600_000,
    });

    // Before window — only clip 1.
    expect(clipVisibleWithTransition(first, 2_500_000, project)).toBe(true);
    expect(clipVisibleWithTransition(second, 2_500_000, project)).toBe(false);
    expect(playheadInTransitionWindow(project, 2_500_000)).toBe(false);

    // Mid-transition — both visible, cut-centered.
    expect(clipVisibleWithTransition(first, 3_000_000, project)).toBe(true);
    expect(clipVisibleWithTransition(second, 3_000_000, project)).toBe(true);
    expect(playheadInTransitionWindow(project, 3_000_000)).toBe(true);

    // After window — only clip 2 (this was the stuck-on-clip-1 bug).
    expect(clipVisibleWithTransition(first, 3_400_000, project)).toBe(false);
    expect(clipVisibleWithTransition(second, 3_400_000, project)).toBe(true);
    expect(playheadInTransitionWindow(project, 3_400_000)).toBe(false);
  });

  it("maps fade transitions to xfade names in the export graph", () => {
    let project = createEmptyProject();
    const mk = (id: string, name: string): MediaAsset => ({
      id,
      kind: "video",
      path: `C:/media/${name}`,
      name,
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: false,
      missing: false,
    });
    project = { ...project, assets: [mk("a1", "a.mp4"), mk("a2", "b.mp4")] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const laneId = project.clips.find((c) => c.assetId === "a1")!.trackId;
    project = addMediaClip(project, "a2", { trackId: laneId, startTicks: 3_000_000 });
    const second = project.clips.find((c) => c.assetId === "a2")!;
    project = updateClipTransition(project, second.id, {
      type: "fade",
      durationTicks: 600_000,
    });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=fadeblack");
  });
});
