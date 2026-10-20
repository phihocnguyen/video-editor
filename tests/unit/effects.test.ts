import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  cssFilterFromEffects,
  DEFAULT_CLIP_EFFECTS,
  EFFECT_PRESETS,
  applyEffectPreset,
  effectsMatchPreset,
  findMatchingEffectPreset,
  fadeOpacityMultiplier,
  ffmpegVideoEffectsChain,
  normalizeClipEffects,
  shakeAt,
  shakeScaleAt,
  strobeFlashOpacity,
  strobeIsFlashFrame,
  updateClipEffects,
  zoomScaleAt,
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

  it("scales CSS blur px to the stage so preview matches export sigma", () => {
    // blur 12 canvas-px on a stage at 1/3 scale → 4.0 stage px.
    const css = cssFilterFromEffects(normalizeClipEffects({ blur: 12 }), 1 / 3);
    expect(css).toContain("blur(4.0px)");
  });

  it("boosts contrast in CSS when sharpen is set", () => {
    const css = cssFilterFromEffects(normalizeClipEffects({ sharpen: 1 }));
    expect(css).toMatch(/contrast\(/);
  });

  it("normalizes vignette and sharpen ranges", () => {
    expect(normalizeClipEffects({ vignette: 2, sharpen: 9 }).vignette).toBe(1);
    expect(normalizeClipEffects({ vignette: 2, sharpen: 9 }).sharpen).toBe(2);
    expect(normalizeClipEffects(undefined).vignette).toBe(0);
  });

  it("computes fade opacity multipliers", () => {
    const fx = normalizeClipEffects({ fadeInSec: 1, fadeOutSec: 1 });
    expect(fadeOpacityMultiplier(fx, 0, 5)).toBeCloseTo(0);
    expect(fadeOpacityMultiplier(fx, 0.5, 5)).toBeCloseTo(0.5);
    expect(fadeOpacityMultiplier(fx, 2.5, 5)).toBeCloseTo(1);
    expect(fadeOpacityMultiplier(fx, 4.5, 5)).toBeCloseTo(0.5);
  });

  it("flashes one frame every N frames", () => {
    const fx = normalizeClipEffects({ strobeFrames: 5 });
    // 30fps: flash on frames 4, 9, 14… (0-based)
    expect(strobeIsFlashFrame(fx, 0, 30)).toBe(false);
    expect(strobeIsFlashFrame(fx, 4 / 30, 30)).toBe(true);
    expect(strobeIsFlashFrame(fx, 5 / 30, 30)).toBe(false);
    expect(strobeIsFlashFrame(normalizeClipEffects({ strobeFrames: 0 }), 0, 30)).toBe(
      false,
    );
  });

  it("samples deterministic shake and hides its edges with overscan", () => {
    const fx = normalizeClipEffects({ shake: 0.05, shakeSpeed: 8, shakeRotation: 4 });
    const a = shakeAt(fx, 0.25);
    const b = shakeAt(fx, 0.25);
    expect(a).toEqual(b);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(a.rotation)).toBeLessThanOrEqual(4);
    expect(shakeScaleAt(fx)).toBeGreaterThan(1);
    expect(shakeAt(normalizeClipEffects({}), 1)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
    });
  });

  it("emits frame-strobe drawbox with a soft decay tail", () => {
    const chain = ffmpegVideoEffectsChain(
      normalizeClipEffects({ strobeFrames: 5, strobeColor: "#FF0000" }),
      4,
    );
    expect(chain).toContain("drawbox=");
    expect(chain).toContain("color=FF0000@1");
    expect(chain).toContain("color=FF0000@0.35");
    expect(chain).toContain("mod(n\\,5)");
  });

  it("fades the strobe tail over the following frame", () => {
    const fx = normalizeClipEffects({ strobeFrames: 5 });
    expect(strobeFlashOpacity(fx, 4 / 30, 30)).toBe(1);
    expect(strobeFlashOpacity(fx, 4.5 / 30, 30)).toBeCloseTo(0.675);
    expect(strobeFlashOpacity(fx, 5 / 30, 30)).toBeCloseTo(0.35);
    expect(strobeFlashOpacity(fx, 6 / 30, 30)).toBe(0);
    expect(strobeFlashOpacity(normalizeClipEffects({ strobeFrames: 1 }), 0.5, 30)).toBe(1);
  });

  it("normalizes and samples the frame-driven zoom", () => {
    expect(normalizeClipEffects({ zoom: 0.9, zoomFrames: 200 }).zoom).toBe(0.5);
    expect(normalizeClipEffects({ zoom: -1, zoomFrames: 200 }).zoom).toBe(0);
    expect(normalizeClipEffects({ zoom: 0.2, zoomFrames: 200 }).zoomFrames).toBe(120);
    const steady = normalizeClipEffects({ zoom: 0.2 });
    expect(zoomScaleAt(steady, 0, 30)).toBeCloseTo(1.2);
    const pulsed = normalizeClipEffects({ zoom: 0.2, zoomFrames: 10 });
    expect(zoomScaleAt(pulsed, 0, 30)).toBeCloseTo(1);
    expect(zoomScaleAt(pulsed, 5 / 30, 30)).toBeCloseTo(1.2);
    expect(zoomScaleAt(pulsed, 10 / 30, 30)).toBeCloseTo(1);
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

  it("emits sepia, hue, and tint wash in the FFmpeg chain", () => {
    const chain = ffmpegVideoEffectsChain(
      normalizeClipEffects({
        sepia: 0.5,
        hueRotate: -12,
        tintColor: "#F4A04A",
        tintAmount: 0.4,
        tintBlend: "soft-light",
      }),
      4,
    );
    expect(chain).toContain("colorchannelmixer=rr=");
    expect(chain).toContain("hue=h=-12.0");
    expect(chain).toContain("geq=r=");
    expect(chain).toContain("244.00");
  });

  it("emits a vertical gradient wash for story-style tints", () => {
    const chain = ffmpegVideoEffectsChain(
      normalizeClipEffects({
        tintGradient: ["#4E2022", "#281E41"],
        tintAmount: 0.78,
        tintBlend: "normal",
      }),
      4,
    );
    expect(chain).toContain("Y/H");
    expect(chain).toContain("78.00");
    expect(chain).toContain("40.00");
  });

  it("adds sepia and hue-rotate to the preview CSS filter", () => {
    const css = cssFilterFromEffects(
      normalizeClipEffects({ sepia: 0.4, hueRotate: 12 }),
    );
    expect(css).toContain("sepia(0.40)");
    expect(css).toContain("hue-rotate(12.0deg)");
  });

  it("emits unsharp and vignette in FFmpeg chain", () => {
    const chain = ffmpegVideoEffectsChain(
      normalizeClipEffects({ sharpen: 1, vignette: 0.6 }),
      4,
    );
    expect(chain).toContain("unsharp=");
    expect(chain).toContain("vignette=");
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

  it("exports shake as animated offsets and rotation", () => {
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
    project = updateClipEffects(project, clipId, {
      shake: 0.08,
      shakeSpeed: 12,
      shakeRotation: 5,
    });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("sin(2*PI*(t*12.0000))");
    expect(filter).toContain("rotate=");
    expect(filter).toContain("eval=frame");
  });

  it("exports frame-driven zoom as an animated scale expression", () => {
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
    project = updateClipEffects(project, clipId, { zoom: 0.2, zoomFrames: 10 });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/x.mp4", { fileExists: () => true });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("scale=w=");
    expect(filter).toContain("eval=frame");
    expect(filter).toContain("cos(2*PI*mod(t*30.0000\\,10)/10)");
  });

  it("matches and applies montage and cyber effect presets", () => {
    const montage = EFFECT_PRESETS.find((p) => p.id === "montage");
    expect(montage).toBeDefined();
    const applied = applyEffectPreset(DEFAULT_CLIP_EFFECTS, montage!);
    expect(applied.contrast).toBe(1.25);
    expect(applied.vignette).toBe(0.55);
    expect(applied.sharpen).toBe(0.45);
    expect(effectsMatchPreset(applied, montage!)).toBe(true);
    expect(findMatchingEffectPreset(applied)?.id).toBe("montage");

    const cyber = EFFECT_PRESETS.find((p) => p.id === "cyber");
    expect(cyber).toBeDefined();
    const cyberApplied = applyEffectPreset(DEFAULT_CLIP_EFFECTS, cyber!);
    expect(cyberApplied.saturation).toBe(1.45);
    expect(cyberApplied.vignette).toBe(0.6);
    expect(effectsMatchPreset(cyberApplied, cyber!)).toBe(true);
    expect(findMatchingEffectPreset(cyberApplied)?.id).toBe("cyber");
  });
});
