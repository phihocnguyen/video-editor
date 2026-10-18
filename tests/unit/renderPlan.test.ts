import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addTextClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  updateClipTransform,
  type MediaAsset,
} from "../../src/domain";

describe("buildRenderPlan", () => {
  it("builds clip timing from the project", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/a.mp4",
      name: "a.mp4",
      durationTicks: 5_000_000,
      width: 1920,
      height: 1080,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 1_000_000 });
    const plan = buildRenderPlan(project, "720", "high");
    // 1080x1920 canvas, short side scaled to 720 → 720x1280.
    expect(plan.width).toBe(720);
    expect(plan.height).toBe(1280);
    expect(plan.clips).toHaveLength(1);
    expect(plan.texts).toHaveLength(0);
    expect(plan.clips[0].timelineStartSec).toBeCloseTo(1);
    expect(plan.clips[0].opacity).toBe(1);
    expect(plan.clips[0].speed).toBe(1);
    expect(plan.clips[0].includeAudio).toBe(true);
    project = {
      ...project,
      clips: project.clips.map((c) => ({ ...c, suppressEmbeddedAudio: true })),
    };
    expect(buildRenderPlan(project, "720", "high").clips[0].includeAudio).toBe(false);
    expect(plan.videoBitrate).toBe("12M");
    expect(plan.durationSec).toBeCloseTo(6);
    expect(plan.missingAssetIds).toEqual([]);
  });

  it("scales text overlays from canvas to export resolution", () => {
    let project = createEmptyProject();
    expect(project.canvas.width).toBe(1080);
    expect(project.canvas.height).toBe(1920);
    project = addTextClip(project, { text: { content: "Hello", fontSize: 72 } });
    const textClip = project.clips.find((c) => c.kind === "text")!;
    project = updateClipTransform(project, textClip.id, {
      ...textClip.transform,
      x: 960,
      y: 900,
    });
    const plan = buildRenderPlan(project, "720", "standard");
    expect(plan.width).toBe(720);
    expect(plan.height).toBe(1280);
    expect(plan.texts).toHaveLength(1);
    expect(plan.texts[0].x).toBeCloseTo(640);
    expect(plan.texts[0].y).toBeCloseTo(600);
    expect(plan.texts[0].fontSize).toBeCloseTo(48);
    expect(plan.texts[0].fontWeight).toBe(700);
    expect(plan.texts[0].slideDist).toBeCloseTo(32);
  });

  it("passes font weight through and snaps export faces by weight", () => {
    let project = createEmptyProject();
    project = addTextClip(project, {
      text: { content: "Light", fontSize: 48, fontWeight: 400 },
    });
    const plan = buildRenderPlan(project, "source", "draft");
    expect(plan.texts[0].fontWeight).toBe(400);
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fontfile='public/fonts/Manrope-Variable.ttf'");
  });
});
