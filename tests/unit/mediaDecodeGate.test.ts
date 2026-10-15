import { describe, expect, it, beforeEach } from "vitest";
import {
  beginPlaybackDecodeHold,
  beginMediaQuietPeriod,
  currentDecodeEpoch,
  endPlaybackDecodeHold,
  ensurePlaybackDecodeHold,
  isDecodeEpochStale,
  isPlaybackDecodeHeld,
  preemptDecodersNow,
  releasePlaybackDecodeHold,
  whenDecodeSlotFree,
} from "../../src/lib/mediaDecodeGate";

describe("mediaDecodeGate epoch", () => {
  beforeEach(() => {
    releasePlaybackDecodeHold();
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

  it("ensurePlaybackDecodeHold is idempotent", () => {
    expect(isPlaybackDecodeHeld()).toBe(false);
    ensurePlaybackDecodeHold();
    expect(isPlaybackDecodeHeld()).toBe(true);
    const epoch = currentDecodeEpoch();
    ensurePlaybackDecodeHold();
    expect(currentDecodeEpoch()).toBe(epoch);
    expect(isPlaybackDecodeHeld()).toBe(true);
    endPlaybackDecodeHold();
    expect(isPlaybackDecodeHeld()).toBe(false);
  });

  it("releasePlaybackDecodeHold clears nested holds", () => {
    beginPlaybackDecodeHold();
    beginPlaybackDecodeHold();
    expect(isPlaybackDecodeHeld()).toBe(true);
    releasePlaybackDecodeHold();
    expect(isPlaybackDecodeHeld()).toBe(false);
  });
});
