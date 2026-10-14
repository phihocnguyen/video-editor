import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  type MediaAsset,
} from "../../src/domain";

describe("buildFfmpegArgs", () => {
  it("builds a filter_complex mapping outv", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/media/clip.mp4",
      name: "clip.mp4",
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    expect(built.program).toBe("ffmpeg");
    expect(built.args).toContain("-filter_complex");
    expect(built.args).toContain("[outv]");
    expect(built.args).toContain("libx264");
    expect(built.tempOutput).toMatch(/\.tmp\.mp4$/i);
  });
});
