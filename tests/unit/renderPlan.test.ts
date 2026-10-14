import { describe, expect, it } from "vitest";
import { addMediaClip, buildRenderPlan, createEmptyProject, type MediaAsset } from "../../src/domain";

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
    const plan = buildRenderPlan(project, "720");
    expect(plan.height).toBe(720);
    expect(plan.clips).toHaveLength(1);
    expect(plan.texts).toHaveLength(0);
    expect(plan.clips[0].timelineStartSec).toBeCloseTo(1);
    expect(plan.durationSec).toBeCloseTo(6);
    expect(plan.missingAssetIds).toEqual([]);
  });
});
