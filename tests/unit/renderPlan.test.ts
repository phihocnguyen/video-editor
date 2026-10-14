import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addTextClip,
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
    expect(plan.height).toBe(720);
    expect(plan.clips).toHaveLength(1);
    expect(plan.texts).toHaveLength(0);
    expect(plan.clips[0].timelineStartSec).toBeCloseTo(1);
    expect(plan.clips[0].opacity).toBe(1);
    expect(plan.clips[0].speed).toBe(1);
    expect(plan.clips[0].includeAudio).toBe(true);
    expect(plan.videoBitrate).toBe("12M");
    expect(plan.durationSec).toBeCloseTo(6);
    expect(plan.missingAssetIds).toEqual([]);
  });

  it("scales text overlays from canvas to export resolution", () => {
    let project = createEmptyProject();
    expect(project.canvas.width).toBe(1920);
    expect(project.canvas.height).toBe(1080);
    project = addTextClip(project, { text: { content: "Hello", fontSize: 72 } });
    const textClip = project.clips.find((c) => c.kind === "text")!;
    project = updateClipTransform(project, textClip.id, {
      ...textClip.transform,
      x: 960,
      y: 900,
    });
    const plan = buildRenderPlan(project, "720", "standard");
    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(720);
    expect(plan.texts).toHaveLength(1);
    expect(plan.texts[0].x).toBeCloseTo(640);
    expect(plan.texts[0].y).toBeCloseTo(600);
    expect(plan.texts[0].fontSize).toBeCloseTo(48);
  });
});
