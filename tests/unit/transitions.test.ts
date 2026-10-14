import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  DEFAULT_CLIP_EFFECTS,
  incomingTransitionProgress,
  normalizeClipTransition,
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
    project = addMediaClip(project, "a2", { startTicks: 3_000_000 });
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

  it("normalizes every grouped transition type", () => {
    for (const def of TRANSITION_DEFS) {
      expect(normalizeClipTransition({ type: def.type }).type).toBe(def.type);
    }
    // Unique ids, and all non-cut types map to a distinct xfade (except zoomOut/whipPan).
    expect(new Set(TRANSITION_DEFS.map((d) => d.type)).size).toBe(TRANSITION_DEFS.length);
    expect(transitionDef("dissolve").xfade).toBe("fade");
    expect(transitionDef("slideLeft").xfade).toBe("slideleft");
    expect(transitionDef("circleOpen").xfade).toBe("circleopen");
    expect(transitionDef("none").xfade).toBeNull();
  });

  it("reports a rich preview visual for slides and masks", () => {
    const slide = transitionPreview("slideLeft", 0);
    expect(slide.transform).toContain("translateX");
    const wipe = transitionPreview("wipeUp", 0);
    expect(wipe.clipPath).toContain("inset");
    const blur = transitionPreview("blurDissolve", 0);
    expect(blur.filter).toContain("blur");
  });

  it("maps the new transitions to xfade names in the export graph", () => {
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
    project = addMediaClip(project, "a2", { startTicks: 3_000_000 });
    const second = project.clips.find((c) => c.assetId === "a2")!;
    project = updateClipTransition(project, second.id, {
      type: "circleOpen",
      durationTicks: 600_000,
    });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("xfade=transition=circleopen");
  });
});
