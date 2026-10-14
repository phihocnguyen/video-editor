import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  cssFilterFromEffects,
  fadeOpacityMultiplier,
  ffmpegVideoEffectsChain,
  normalizeClipEffects,
  updateClipEffects,
  type MediaAsset,
} from "../../src/domain";

describe("clip effects", () => {
  it("normalizes missing fields to defaults", () => {
    expect(normalizeClipEffects(undefined).brightness).toBe(1);
    expect(normalizeClipEffects({ brightness: 1.5, grayscale: true }).grayscale).toBe(
      true,
    );
  });

  it("builds CSS filters for preview", () => {
    const css = cssFilterFromEffects(
      normalizeClipEffects({ brightness: 1.2, blur: 4, grayscale: true }),
    );
    expect(css).toContain("brightness(1.2)");
    expect(css).toContain("blur(4.0px)");
    expect(css).toContain("grayscale(1)");
  });

  it("computes fade opacity multipliers", () => {
    const fx = normalizeClipEffects({ fadeInSec: 1, fadeOutSec: 1 });
    expect(fadeOpacityMultiplier(fx, 0, 5)).toBeCloseTo(0);
    expect(fadeOpacityMultiplier(fx, 0.5, 5)).toBeCloseTo(0.5);
    expect(fadeOpacityMultiplier(fx, 2.5, 5)).toBeCloseTo(1);
    expect(fadeOpacityMultiplier(fx, 4.5, 5)).toBeCloseTo(0.5);
  });

  it("emits FFmpeg eq/gblur/fade chain", () => {
    const chain = ffmpegVideoEffectsChain(
      normalizeClipEffects({
        brightness: 1.2,
        contrast: 1.1,
        saturation: 0.8,
        blur: 2,
        grayscale: true,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
      }),
      4,
    );
    expect(chain).toContain("eq=brightness=0.200");
    expect(chain).toContain("gblur=sigma=2.00");
    expect(chain).toContain("hue=s=0");
    expect(chain).toContain("fade=t=in:st=0.000:d=0.500:alpha=1");
    expect(chain).toContain("fade=t=out:st=3.500:d=0.500:alpha=1");
  });

  it("includes effects in render plan and filter_complex", () => {
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
    project = addMediaClip(project, "a1");
    const clipId = project.clips[0].id;
    project = updateClipEffects(project, clipId, { grayscale: true, blur: 3 });
    const plan = buildRenderPlan(project, "720", "draft");
    expect(plan.clips[0].effects.grayscale).toBe(true);
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("gblur=sigma=3.00");
    expect(filter).toContain("hue=s=0");
  });
});
