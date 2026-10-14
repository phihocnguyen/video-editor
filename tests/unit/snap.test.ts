import { describe, expect, it } from "vitest";
import { addMediaClip, createEmptyProject, projectDurationTicks, snapTicks, type MediaAsset } from "../../src/domain";

describe("snapTicks", () => {
  it("snaps near clip edges", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "x",
      name: "x",
      durationTicks: 5_000_000,
      width: 100,
      height: 100,
      frameRate: 30,
      hasAudio: false,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 2_000_000 });
    expect(snapTicks(2_100_000, project.clips, { thresholdTicks: 200_000 })).toBe(2_000_000);
    expect(snapTicks(6_900_000, project.clips, { thresholdTicks: 200_000 })).toBe(7_000_000);
    expect(
      snapTicks(3_050_000, project.clips, {
        thresholdTicks: 200_000,
        extraTargets: [3_000_000],
      }),
    ).toBe(3_000_000);
  });

  it("computes project duration from clips", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "x",
      name: "x",
      durationTicks: 4_000_000,
      width: null,
      height: null,
      frameRate: null,
      hasAudio: false,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 1_000_000 });
    expect(projectDurationTicks(project.clips, 1_000_000)).toBeGreaterThanOrEqual(7_000_000);
  });
});
