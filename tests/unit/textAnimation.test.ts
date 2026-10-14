import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_ANIMATION,
  ffmpegTextAnim,
  normalizeTextAnimation,
  TEXT_ANIM_PRESETS,
  textAnimationIsDefault,
  textAnimationVisual,
} from "../../src/domain";

describe("textAnimation", () => {
  it("normalizes unknown presets to none", () => {
    const anim = normalizeTextAnimation({
      in: "definitely-not-a-preset" as never,
      out: "fade",
      durationTicks: 400_000,
    });
    expect(anim.in).toBe("none");
    expect(anim.out).toBe("fade");
    expect(anim.durationTicks).toBe(400_000);
  });

  it("clamps the duration window", () => {
    expect(normalizeTextAnimation({ durationTicks: 10 }).durationTicks).toBe(100_000);
    expect(normalizeTextAnimation({ durationTicks: 99_000_000 }).durationTicks).toBe(
      5_000_000,
    );
  });

  it("detects the default (no animation)", () => {
    expect(textAnimationIsDefault(DEFAULT_TEXT_ANIMATION)).toBe(true);
    expect(
      textAnimationIsDefault({ in: "fade", out: "none", durationTicks: 600_000 }),
    ).toBe(false);
  });

  it("fades text opacity from 0 to 1 across its window", () => {
    const anim = { in: "fade" as const, out: "none" as const, durationTicks: 1_000_000 };
    const atStart = textAnimationVisual(anim, 0, 10);
    const mid = textAnimationVisual(anim, 0.5, 10);
    const after = textAnimationVisual(anim, 2, 10);
    expect(atStart.opacity).toBeLessThan(0.05);
    expect(mid.opacity).toBeGreaterThan(0.4);
    expect(after.opacity).toBeCloseTo(1);
  });

  it("applies a transform for slide/zoom presets", () => {
    const slide = textAnimationVisual(
      { in: "slide", out: "none", durationTicks: 1_000_000 },
      0,
      10,
    );
    expect(slide.transform).toContain("translateX");
    const zoom = textAnimationVisual(
      { in: "expand", out: "none", durationTicks: 1_000_000 },
      0,
      10,
    );
    expect(zoom.transform).toContain("scale");
  });

  it("applies a clip-path for mask presets", () => {
    const wipe = textAnimationVisual(
      { in: "wipe", out: "none", durationTicks: 1_000_000 },
      0,
      10,
    );
    expect(wipe.clipPath).toContain("inset");
  });

  it("exports a plain identity when there is no animation", () => {
    const out = ffmpegTextAnim(null, 0, 4);
    expect(out).toEqual({ alpha: "1", dx: "0", dy: "0", scale: "1" });
    const dflt = ffmpegTextAnim(DEFAULT_TEXT_ANIMATION, 0, 4);
    expect(dflt.alpha).toBe("1");
  });

  it("emits time expressions for an animated export", () => {
    const out = ffmpegTextAnim(
      { in: "pop", out: "fade", durationTicks: 800_000 },
      1,
      5,
    );
    expect(out.alpha).toContain("if(lt(t");
    expect(out.scale).not.toBe("1");
  });

  it("ships the full CapCut-style preset set", () => {
    // 14 named effects + the "none" sentinel.
    const named = TEXT_ANIM_PRESETS.filter((p) => p.id !== "none");
    expect(named).toHaveLength(14);
    expect(new Set(TEXT_ANIM_PRESETS.map((p) => p.id)).size).toBe(
      TEXT_ANIM_PRESETS.length,
    );
  });
});
