import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIP_EFFECTS,
  effectsAtProgress,
  ffmpegKeyframeExpr,
  ffmpegVideoEffectsChainAnimated,
  normalizeEffectKeyframes,
  progressFromTicks,
  removeParamKeyframeNear,
  steppedOnWindows,
  upsertParamKeyframe,
  type EffectKeyframes,
} from "../../src/domain";

describe("effect keyframes", () => {
  it("holds each keyframe value until the next (no linear blend)", () => {
    const kf = normalizeEffectKeyframes({
      tracks: [
        {
          param: "blur",
          points: [
            { id: "a", atProgress: 0, value: 0 },
            { id: "b", atProgress: 1, value: 10 },
          ],
        },
      ],
    });
    // Hold 0 until the second keyframe fires at progress 1.
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0).blur).toBeCloseTo(0, 5);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.5).blur).toBeCloseTo(0, 5);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 1).blur).toBeCloseTo(10, 5);
  });

  it("applies from a mid keyframe and turns off at the next", () => {
    const kf = normalizeEffectKeyframes({
      tracks: [
        {
          param: "strobeFrames",
          points: [
            { id: "on", atProgress: 0.2, value: 5 },
            { id: "off", atProgress: 0.8, value: 0 },
          ],
        },
      ],
    });
    // Before first KF → base (0 / off)
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.1).strobeFrames).toBe(0);
    // From on KF until off KF → 5
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.2).strobeFrames).toBe(5);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.5).strobeFrames).toBe(5);
    // From off KF → 0
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.8).strobeFrames).toBe(0);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.95).strobeFrames).toBe(0);
  });

  it("falls back to base effects when a param has no track", () => {
    const kf = normalizeEffectKeyframes({
      tracks: [
        {
          param: "brightness",
          points: [{ id: "a", atProgress: 0.5, value: 1.4 }],
        },
      ],
    });
    const resolved = effectsAtProgress(
      { ...DEFAULT_CLIP_EFFECTS, brightness: 1, contrast: 1.2 },
      kf,
      0.5,
    );
    expect(resolved.brightness).toBeCloseTo(1.4, 5);
    expect(resolved.contrast).toBeCloseTo(1.2, 5);
    // Before first brightness KF → base brightness
    expect(
      effectsAtProgress(
        { ...DEFAULT_CLIP_EFFECTS, brightness: 1, contrast: 1.2 },
        kf,
        0.2,
      ).brightness,
    ).toBeCloseTo(1, 5);
  });

  it("upserts and removes keyframes near a progress", () => {
    let kf: EffectKeyframes | null = upsertParamKeyframe(null, "vignette", 0.25, 0.6);
    expect(getCount(kf, "vignette")).toBe(1);
    kf = upsertParamKeyframe(kf, "vignette", 0.26, 0.8);
    expect(getCount(kf, "vignette")).toBe(1);
    expect(kf!.tracks[0]!.points[0]!.value).toBeCloseTo(0.8, 5);
    kf = removeParamKeyframeNear(kf, "vignette", 0.26);
    expect(kf).toBeNull();
  });

  it("maps playhead ticks to progress", () => {
    expect(progressFromTicks(1_000_000, 4_000_000, 3_000_000)).toBeCloseTo(0.5, 5);
    expect(progressFromTicks(0, 2_000_000, -1)).toBe(0);
    expect(progressFromTicks(0, 2_000_000, 9_000_000)).toBe(1);
  });

  it("builds an escaped FFmpeg hold expression", () => {
    const expr = ffmpegKeyframeExpr(
      [
        { id: "a", atProgress: 0, value: 0 },
        { id: "b", atProgress: 1, value: 1 },
      ],
      2,
      0,
      (v) => v,
    );
    expect(expr).toContain("if(lt(t\\,");
    expect(expr).toContain("0.0000");
    expect(expr).toContain("1.0000");
    // Hold — no linear blend term
    expect(expr).not.toContain("*(t-");
  });

  it("resolves strobeFrames from keyframes with hold", () => {
    const kf = normalizeEffectKeyframes({
      tracks: [
        {
          param: "strobeFrames",
          points: [
            { id: "a", atProgress: 0, value: 0 },
            { id: "b", atProgress: 1, value: 10 },
          ],
        },
      ],
    });
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0).strobeFrames).toBe(0);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 0.5).strobeFrames).toBe(0);
    expect(effectsAtProgress(DEFAULT_CLIP_EFFECTS, kf, 1).strobeFrames).toBe(10);
  });

  it("gates stepped filters to the keyframe window (no head coverage)", () => {
    // Blur keyframe at 50%: export must not blur the clip head like preview.
    const points = [
      { atProgress: 0.5, value: 10 },
      { atProgress: 1, value: 10 },
    ];
    const windows = steppedOnWindows(points, 4, 0, 0.05, 0);
    expect(windows.length).toBe(1);
    expect(windows[0]!.t0).toBeCloseTo(2, 3);
    expect(windows[0]!.t1).toBeCloseTo(4, 3);
  });

  it("keeps base-value head when the first keyframe is mid-clip", () => {
    // Base blur 0, keyframes turn blur on at 25% and off at 75%.
    const kf = normalizeEffectKeyframes({
      tracks: [
        {
          param: "blur",
          points: [
            { id: "a", atProgress: 0.25, value: 8 },
            { id: "b", atProgress: 0.75, value: 0 },
          ],
        },
      ],
    });
    const chain = ffmpegVideoEffectsChainAnimated(
      DEFAULT_CLIP_EFFECTS,
      4,
      { delaySec: 0, keyframes: kf },
    );
    expect(chain).toContain("gblur=");
    // Blur window starts at 1.0s (25% of 4s), not at 0.
    expect(chain).toContain("between(t\\,1.000\\,3.000)");
    expect(chain).not.toContain("between(t\\,0.000\\,");
  });
});

function getCount(kf: EffectKeyframes | null, param: string): number {
  return kf?.tracks.find((t) => t.param === param)?.points.length ?? 0;
}
