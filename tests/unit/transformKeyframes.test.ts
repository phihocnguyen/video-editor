import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  ffmpegLinearExpr,
  sliceTransformKeyframes,
  transformAtProgress,
  upsertTransformKeyframe,
  type MediaAsset,
} from "../../src/domain";
import type { ClipTransform } from "../../src/domain/project";

const base: ClipTransform = {
  x: 100,
  y: 200,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

describe("transformAtProgress", () => {
  it("blends linearly and keeps the base before the first point", () => {
    let kf = upsertTransformKeyframe(null, "opacity", 0.25, 1);
    kf = upsertTransformKeyframe(kf, "opacity", 0.75, 0);
    expect(transformAtProgress(base, kf, 0).opacity).toBeCloseTo(1);
    expect(transformAtProgress(base, kf, 0.25).opacity).toBeCloseTo(1);
    expect(transformAtProgress(base, kf, 0.5).opacity).toBeCloseTo(0.5);
    expect(transformAtProgress(base, kf, 1).opacity).toBeCloseTo(0);
    expect(transformAtProgress(base, kf, 0.5).x).toBe(100);
  });

  it("remaps points when a clip is split", () => {
    let kf = upsertTransformKeyframe(null, "x", 0, 0);
    kf = upsertTransformKeyframe(kf, "x", 1, 100);
    const right = sliceTransformKeyframes(kf, 0.5, 1);
    const atStart = transformAtProgress(base, right, 0).x;
    expect(atStart).toBeCloseTo(50, 0);
  });
});

describe("ffmpeg linear placement", () => {
  it("emits a time blend for position and opacity", () => {
    const points = [
      { id: "a", atProgress: 0, value: 10 },
      { id: "b", atProgress: 1, value: 90 },
    ];
    const expr = ffmpegLinearExpr(points, 4, 10) ?? "";
    expect(expr).toContain("*(t-");
    expect(expr).not.toContain("*(t-t");

    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "image",
      path: "C:/media/pic.png",
      name: "pic.png",
      durationTicks: 4_000_000,
      width: 1000,
      height: 500,
      frameRate: null,
      hasAudio: false,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const clip = project.clips[0]!;
    let kf = upsertTransformKeyframe(null, "x", 0, 100);
    kf = upsertTransformKeyframe(kf, "x", 1, 800);
    kf = upsertTransformKeyframe(kf, "opacity", 0, 1);
    kf = upsertTransformKeyframe(kf, "opacity", 1, 0);
    project = {
      ...project,
      clips: [{ ...clip, transformKeyframes: kf }],
    };
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4");
    const filter = built.args[built.args.indexOf("-filter_complex") + 1] ?? "";
    expect(filter).toContain("eval=frame");
    expect(filter).toContain("*(t-");
    expect(filter).toContain("geq=");
    expect(filter).toContain("alpha(X,Y)");
  });
});
