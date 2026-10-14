import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  containFitBox,
  createEmptyProject,
  mediaGeometry,
  updateCanvas,
  updateClipTransform,
  type MediaAsset,
} from "../../src/domain";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
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
    ...overrides,
  };
}

describe("containFitBox", () => {
  it("fits a wide source by width", () => {
    const box = containFitBox(1920, 1080, 2000, 500);
    expect(box.width).toBeCloseTo(1920);
    expect(box.height).toBeCloseTo(480);
  });

  it("fits a tall source by height", () => {
    const box = containFitBox(1920, 1080, 500, 2000);
    expect(box.height).toBeCloseTo(1080);
    expect(box.width).toBeCloseTo(270);
  });
});

describe("mediaGeometry", () => {
  it("treats a legacy 0/0 transform as the canvas centre and fits the source", () => {
    const geom = mediaGeometry(
      { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      1920,
      1080,
      { width: 1000, height: 500 },
    );
    expect(geom.centerX).toBeCloseTo(960);
    expect(geom.centerY).toBeCloseTo(540);
    expect(geom.boxWidth).toBeCloseTo(1920);
    expect(geom.boxHeight).toBeCloseTo(960);
  });

  it("applies scale on top of the fitted box", () => {
    const geom = mediaGeometry(
      { x: 960, y: 540, scaleX: 0.5, scaleY: 0.5, rotation: 0, opacity: 1 },
      1920,
      1080,
      { width: 1000, height: 500 },
    );
    expect(geom.boxWidth).toBeCloseTo(960);
    expect(geom.boxHeight).toBeCloseTo(480);
  });
});

describe("updateCanvas", () => {
  it("updates resolution, fps and background", () => {
    const project = updateCanvas(createEmptyProject(), {
      width: 1080,
      height: 1920,
      frameRate: 60,
      backgroundColor: "#112233",
    });
    expect(project.canvas).toEqual({
      width: 1080,
      height: 1920,
      frameRate: 60,
      backgroundColor: "#112233",
    });
  });

  it("clamps out-of-range values", () => {
    const project = updateCanvas(createEmptyProject(), {
      width: -100,
      frameRate: 9999,
    });
    expect(project.canvas.width).toBe(2);
    expect(project.canvas.frameRate).toBe(240);
  });
});

describe("media transform export", () => {
  it("emits transform-aware placement and the background base colour", () => {
    let project = createEmptyProject();
    project = updateCanvas(project, { backgroundColor: "#112233" });
    const image = asset();
    project = { ...project, assets: [image] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const clip = project.clips[0]!;
    project = updateClipTransform(project, clip.id, {
      ...clip.transform,
      x: 480,
      y: 270,
      scaleX: 0.5,
      scaleY: 0.5,
      rotation: 0,
    });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(built.args.join(" ")).toContain("color=c=0x112233");
    // Fitted 1000x500 into 1920x1080 → 1920x960; x0.5 → 960x480 in output space.
    expect(filter).toContain("scale=960:480:force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=1920:1080");
  });

  it("rotates when the transform carries a rotation", () => {
    let project = createEmptyProject();
    const image = asset({ width: 400, height: 400 });
    project = { ...project, assets: [image] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const clip = project.clips[0]!;
    project = updateClipTransform(project, clip.id, {
      ...clip.transform,
      x: 960,
      y: 540,
      rotation: 45,
    });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("rotate=");
  });
});
