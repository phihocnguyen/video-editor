import { describe, expect, it } from "vitest";
import {
  createSpeedPoint,
  getRampProfile,
  hasActiveRamp,
  isFlatRamp,
  normalizeSpeedRamp,
  rampDurationTicks,
  sliceRamp,
  sourceOffsetForTimelineOffset,
  speedAtSourceOffset,
  timelineOffsetForSourceOffset,
  type SpeedRamp,
} from "../../src/domain/speedRamp";

function ramp(points: { atProgress: number; speed: number }[]): SpeedRamp {
  return {
    points: points.map((p) => createSpeedPoint(p.atProgress, p.speed)),
  };
}

describe("normalizeSpeedRamp", () => {
  it("returns null without points", () => {
    expect(normalizeSpeedRamp(null)).toBeNull();
    expect(normalizeSpeedRamp({ points: [] })).toBeNull();
  });

  it("keeps only user anchors (no forced clip-edge endpoints)", () => {
    const r = normalizeSpeedRamp(
      ramp([
        { atProgress: 0.25, speed: 1 },
        { atProgress: 0.75, speed: 2 },
      ]),
    )!;
    expect(r.points.map((p) => p.atProgress)).toEqual([0.25, 0.75]);
    expect(r.points[0].speed).toBe(1);
    expect(r.points[1].speed).toBe(2);
  });

  it("returns null with a single anchor (need 2 for a curve)", () => {
    expect(normalizeSpeedRamp(ramp([{ atProgress: 0.6, speed: 2 }]))).toBeNull();
  });

  it("clamps out-of-range speeds", () => {
    const r = normalizeSpeedRamp(
      ramp([
        { atProgress: 0, speed: 100 },
        { atProgress: 1, speed: 0.001 },
      ]),
    )!;
    expect(r.points[0].speed).toBe(8);
    expect(r.points[1].speed).toBe(0.1);
  });

  it("drops anchors that crowd each other", () => {
    const r = normalizeSpeedRamp(
      ramp([
        { atProgress: 0.2, speed: 1 },
        { atProgress: 0.5, speed: 2 },
        { atProgress: 0.501, speed: 3 },
        { atProgress: 0.9, speed: 1 },
      ]),
    )!;
    expect(r.points.length).toBe(3);
    expect(r.points[1].speed).toBe(2);
  });
});

describe("isFlatRamp / hasActiveRamp", () => {
  it("treats all-1.0 ramps as flat", () => {
    expect(
      isFlatRamp(
        ramp([
          { atProgress: 0.2, speed: 1 },
          { atProgress: 0.8, speed: 1 },
        ]),
      ),
    ).toBe(true);
    expect(hasActiveRamp(ramp([{ atProgress: 0.5, speed: 1 }]))).toBe(false);
  });

  it("detects an active ramp", () => {
    expect(
      hasActiveRamp(
        ramp([
          { atProgress: 0.25, speed: 1 },
          { atProgress: 0.75, speed: 2 },
        ]),
      ),
    ).toBe(true);
  });

  it("holds 1× outside the user curve region", () => {
    const profile = getRampProfile(
      ramp([
        { atProgress: 0.3, speed: 0.5 },
        { atProgress: 0.7, speed: 2 },
      ]),
    )!;
    expect(profile.speedAtProgress(0)).toBeCloseTo(1, 5);
    expect(profile.speedAtProgress(0.1)).toBeCloseTo(1, 5);
    expect(profile.speedAtProgress(0.3)).toBeCloseTo(0.5, 5);
    expect(profile.speedAtProgress(0.7)).toBeCloseTo(2, 5);
    expect(profile.speedAtProgress(0.95)).toBeCloseTo(1, 5);
  });
});

describe("constant-speed equivalence", () => {
  it("duration factor equals 1/speed for a flat ramp", () => {
    const profile = getRampProfile(
      ramp([
        { atProgress: 0, speed: 2 },
        { atProgress: 1, speed: 2 },
      ]),
    )!;
    expect(profile.durationFactor).toBeCloseTo(0.5, 5);
    expect(profile.averageSpeed).toBeCloseTo(2, 4);
  });

  it("scales ticks by the constant speed", () => {
    const r = ramp([
      { atProgress: 0, speed: 4 },
      { atProgress: 1, speed: 4 },
    ]);
    expect(rampDurationTicks(r, 10_000_000)).toBe(2_500_000);
  });
});

describe("speed curve interpolation", () => {
  it("does not overshoot between anchors (monotone)", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.5, speed: 8 },
      { atProgress: 1, speed: 1 },
    ]);
    const profile = getRampProfile(r)!;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = profile.speedAtProgress(p);
      expect(v).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(v).toBeLessThanOrEqual(8 + 1e-6);
    }
  });

  it("recovers anchor speeds exactly at anchor positions", () => {
    const r = ramp([
      { atProgress: 0, speed: 0.5 },
      { atProgress: 0.35, speed: 3 },
      { atProgress: 0.8, speed: 1.25 },
      { atProgress: 1, speed: 2 },
    ]);
    const profile = getRampProfile(r)!;
    expect(profile.speedAtProgress(0)).toBeCloseTo(0.5, 6);
    expect(profile.speedAtProgress(0.35)).toBeCloseTo(3, 6);
    expect(profile.speedAtProgress(0.8)).toBeCloseTo(1.25, 6);
    expect(profile.speedAtProgress(1)).toBeCloseTo(2, 6);
  });
});

describe("integral and inverse agree", () => {
  it.each([
    ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.5, speed: 0.5 },
      { atProgress: 1, speed: 1 },
    ]),
    ramp([
      { atProgress: 0, speed: 2 },
      { atProgress: 0.4, speed: 0.25 },
      { atProgress: 1, speed: 4 },
    ]),
    ramp([
      { atProgress: 0, speed: 0.1 },
      { atProgress: 1, speed: 8 },
    ]),
  ])("round-trips timeline ↔ source", (r) => {
    const span = 6_000_000;
    for (let frac = 0; frac <= 1.0001; frac += 0.05) {
      const timelineOffset = frac * rampDurationTicks(r, span);
      const sourceOffset = sourceOffsetForTimelineOffset(r, span, timelineOffset);
      const back = timelineOffsetForSourceOffset(r, span, sourceOffset);
      expect(back).toBeCloseTo(timelineOffset, -2); // within ~1e-2 ticks of rounding
    }
  });

  it("is monotone in the source offset", () => {
    const r = ramp([
      { atProgress: 0, speed: 0.5 },
      { atProgress: 0.5, speed: 4 },
      { atProgress: 1, speed: 1 },
    ]);
    const span = 10_000_000;
    let prev = -1;
    for (let frac = 0; frac <= 1.0001; frac += 0.02) {
      const t = timelineOffsetForSourceOffset(r, span, frac * span);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = t;
    }
  });
});

describe("slow-motion stretches, fast-forward shrinks", () => {
  it("a slow middle section lengthens the clip", () => {
    const base = getRampProfile(
      ramp([
        { atProgress: 0, speed: 1 },
        { atProgress: 1, speed: 1 },
      ]),
    )!;
    const slow = getRampProfile(
      ramp([
        { atProgress: 0, speed: 1 },
        { atProgress: 0.5, speed: 0.5 },
        { atProgress: 1, speed: 1 },
      ]),
    )!;
    expect(slow.durationFactor).toBeGreaterThan(base.durationFactor);
  });
});

describe("speedAtSourceOffset", () => {
  it("reports the ramp speed at a source offset", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 1, speed: 2 },
    ]);
    expect(speedAtSourceOffset(r, 4_000_000, 0)).toBeCloseTo(1, 5);
    expect(speedAtSourceOffset(r, 4_000_000, 4_000_000)).toBeCloseTo(2, 5);
    expect(speedAtSourceOffset(r, 4_000_000, 2_000_000)).toBeCloseTo(1.5, 5);
  });
});

describe("sliceRamp", () => {
  it("keeps the curve shape over a sub-range", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.5, speed: 2 },
      { atProgress: 1, speed: 1 },
    ]);
    const half = sliceRamp(r, 0, 0.5)!;
    const profile = getRampProfile(half)!;
    // Source midpoint of the slice corresponds to progress 0.5 of the whole.
    expect(profile.speedAtProgress(1)).toBeCloseTo(2, 4);
    expect(profile.speedAtProgress(0)).toBeCloseTo(1, 4);
  });
});
