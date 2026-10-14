import { describe, expect, it } from "vitest";
import {
  TICKS_PER_SECOND,
  framesToTicks,
  secondsToTicks,
  ticksToFrames,
  ticksToSeconds,
} from "../../src/domain/time";

describe("time conversions", () => {
  it("round-trips seconds through ticks", () => {
    const ticks = secondsToTicks(1.5);
    expect(ticks).toBe(1.5 * TICKS_PER_SECOND);
    expect(ticksToSeconds(ticks)).toBeCloseTo(1.5);
  });

  it("converts frames at 30fps", () => {
    const ticks = framesToTicks(30, 30);
    expect(ticksToSeconds(ticks)).toBeCloseTo(1);
    expect(ticksToFrames(ticks, 30)).toBe(30);
  });
});
