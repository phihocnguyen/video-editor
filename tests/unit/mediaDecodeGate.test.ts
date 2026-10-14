import { describe, expect, it, beforeEach } from "vitest";
import {
  beginPlaybackDecodeHold,
  beginMediaQuietPeriod,
  currentDecodeEpoch,
  endPlaybackDecodeHold,
  isDecodeEpochStale,
  preemptDecodersNow,
  whenDecodeSlotFree,
} from "../../src/lib/mediaDecodeGate";

describe("mediaDecodeGate epoch", () => {
  beforeEach(() => {
    // Drain any lingering hold from a previous test.
    endPlaybackDecodeHold();
  });

  it("bumps the epoch synchronously on playback hold", () => {
    const before = currentDecodeEpoch();
    beginPlaybackDecodeHold();
    expect(isDecodeEpochStale(before)).toBe(true);
    expect(currentDecodeEpoch()).toBe(before + 1);
    endPlaybackDecodeHold();
  });

  it("invalidates in-flight jobs from a new epoch", () => {
    const epoch = currentDecodeEpoch();
    preemptDecodersNow();
    expect(isDecodeEpochStale(epoch)).toBe(true);
  });

  it("quiet period also advances the epoch", () => {
    const epoch = currentDecodeEpoch();
    beginMediaQuietPeriod(1000);
    expect(isDecodeEpochStale(epoch)).toBe(true);
  });

  it("resolves whenDecodeSlotFree once the hold is released", async () => {
    beginPlaybackDecodeHold();
    const pending = whenDecodeSlotFree();
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    endPlaybackDecodeHold();
    await pending;
    expect(done).toBe(true);
  });
});
