import { describe, expect, it } from "vitest";
import {
  createSpeedPoint,
  getRampProfile,
  hasActiveRamp,
  isFlatRamp,
  MAX_RAMP_SPEED,
  normalizeSpeedRamp,
  phaseLockedRate,
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
    expect(r.points[0].speed).toBe(MAX_RAMP_SPEED);
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

describe("getRampProfile cache", () => {
  it("returns the same profile for the same stored ramp object", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.5, speed: 2 },
      { atProgress: 1, speed: 1 },
    ]);
    expect(getRampProfile(r)).toBe(getRampProfile(r));
  });

  it("rebuilds after an immutable ramp edit", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 1, speed: 2 },
    ]);
    const next: SpeedRamp = {
      points: r.points.map((p) => (p.atProgress === 1 ? { ...p, speed: 0.5 } : p)),
    };
    expect(getRampProfile(next)).not.toBe(getRampProfile(r));
    expect(getRampProfile(next)!.speedAtProgress(1)).toBeCloseTo(0.5, 5);
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

  it("holds the boundary anchor speed outside the anchors", () => {
    const profile = getRampProfile(
      ramp([
        { atProgress: 0.3, speed: 0.5 },
        { atProgress: 0.7, speed: 2 },
      ]),
    )!;
    // First anchor's speed is held from the clip start to that anchor…
    expect(profile.speedAtProgress(0)).toBeCloseTo(0.5, 5);
    expect(profile.speedAtProgress(0.15)).toBeCloseTo(0.5, 5);
    expect(profile.speedAtProgress(0.3)).toBeCloseTo(0.5, 5);
    expect(profile.speedAtProgress(0.7)).toBeCloseTo(2, 5);
    // …and the last anchor's speed to the clip end.
    expect(profile.speedAtProgress(0.95)).toBeCloseTo(2, 5);
    expect(profile.speedAtProgress(1)).toBeCloseTo(2, 5);
  });
});

describe("full slow motion", () => {
  it("an all-slow ramp is slow across the whole clip", () => {
    // Two slow anchors anywhere → the whole clip plays at ~0.5× (2× longer).
    const profile = getRampProfile(
      ramp([
        { atProgress: 0.3, speed: 0.5 },
        { atProgress: 0.7, speed: 0.5 },
      ]),
    )!;
    expect(profile.durationFactor).toBeCloseTo(2, 5);
    for (let p = 0; p <= 1.0001; p += 0.05) {
      expect(profile.speedAtProgress(p)).toBeCloseTo(0.5, 5);
    }
  });

  it("holds a slow tail past the last anchor", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.4, speed: 0.5 },
    ]);
    const profile = getRampProfile(r)!;
    expect(profile.speedAtProgress(0.7)).toBeCloseTo(0.5, 5);
    expect(profile.speedAtProgress(1)).toBeCloseTo(0.5, 5);
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
      { atProgress: 0, speed: 2 },
      { atProgress: 1, speed: 2 },
    ]);
    expect(rampDurationTicks(r, 10_000_000)).toBe(5_000_000);
  });
});

describe("speed curve interpolation", () => {
  it("does not overshoot between anchors (monotone)", () => {
    const r = ramp([
      { atProgress: 0, speed: 1 },
      { atProgress: 0.5, speed: MAX_RAMP_SPEED },
      { atProgress: 1, speed: 1 },
    ]);
    const profile = getRampProfile(r)!;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = profile.speedAtProgress(p);
      expect(v).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(v).toBeLessThanOrEqual(MAX_RAMP_SPEED + 1e-6);
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

describe("phaseLockedRate", () => {
  it("returns the nominal rate inside the drift deadband", () => {
    expect(phaseLockedRate(1, 0)).toBe(1);
    expect(phaseLockedRate(0.5, 0.02)).toBe(0.5);
    expect(phaseLockedRate(2, -0.03)).toBe(2);
  });

  it("speeds up when the element is behind, slows down when ahead", () => {
    expect(phaseLockedRate(1, 0.3)).toBeGreaterThan(1);
    expect(phaseLockedRate(1, -0.3)).toBeLessThan(1);
  });

  it("caps the trim so speed never deviates too far", () => {
    // Huge drift is capped at +35% of nominal.
    expect(phaseLockedRate(1, 100)).toBeCloseTo(1.35, 5);
    expect(phaseLockedRate(1, -100)).toBeCloseTo(0.65, 5);
  });

  it("scales the trim with the nominal speed", () => {
    // Slow motion: a large drift only trims relative to the small rate.
    expect(phaseLockedRate(0.2, 100)).toBeCloseTo(0.27, 5);
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
