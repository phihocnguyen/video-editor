import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addTextClip,
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

  it("quotes Windows fontfile paths for drawtext", () => {
    let project = createEmptyProject();
    project = addTextClip(project, { text: { content: "Hi" } });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: (p) =>
        p === "C:/Windows/Fonts/arial.ttf" || p.endsWith(".mp4") || true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawtext=text='Hi'");
    expect(filter).toContain("fontfile='C\\:/Windows/Fonts/arial.ttf'");
  });
});
