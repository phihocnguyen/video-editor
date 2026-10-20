import { describe, expect, it } from "vitest";
import {
  EASING_OPTIONS,
  easeProgress,
  ffmpegEaseExpr,
  normalizeEasing,
} from "../../src/domain";

describe("keyframe easing", () => {
  it("keeps linear identity and normalizes unknown curves", () => {
    expect(easeProgress(0.5, "linear")).toBeCloseTo(0.5);
    expect(normalizeEasing("easeIn")).toBe("easeIn");
    expect(normalizeEasing("bounce")).toBeNull();
    expect(EASING_OPTIONS.map((o) => o.id)).toContain("hold");
  });

  it("eases in slowly and out quickly", () => {
    expect(easeProgress(0.5, "easeIn")).toBeLessThan(0.2);
    expect(easeProgress(0.5, "easeOut")).toBeGreaterThan(0.8);
    expect(easeProgress(0.5, "easeInOut")).toBeCloseTo(0.5);
    expect(easeProgress(1, "easeIn")).toBeCloseTo(1);
  });

  it("emits escaped FFmpeg expressions for curves", () => {
    expect(ffmpegEaseExpr("p", "linear")).toBe("p");
    expect(ffmpegEaseExpr("p", "easeIn")).toBe("pow(p\\,3)");
    expect(ffmpegEaseExpr("p", "easeInOut")).toContain("if(lt(p\\,0.5)");
  });
});
