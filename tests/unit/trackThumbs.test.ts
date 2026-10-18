import { describe, expect, it } from "vitest";
import {
  primeTrackThumb,
  quantizeThumbTime,
  readNearestTrackThumb,
  readTrackThumb,
  stableFilmstripProgress,
  thumbKeyFor,
} from "../../src/lib/trackThumbs";

describe("trackThumbs keys", () => {
  it("quantizes times to a stable 0.5s grid", () => {
    expect(quantizeThumbTime(1.24)).toBe(1.0);
    expect(quantizeThumbTime(1.26)).toBe(1.5);
    expect(quantizeThumbTime(-3)).toBe(0);
    // Zoom jitter around the same frame maps to one slot.
    expect(quantizeThumbTime(2.11)).toBe(quantizeThumbTime(2.19));
  });

  it("builds stable cache keys per asset and slot", () => {
    expect(thumbKeyFor("a1", 2.11)).toBe(thumbKeyFor("a1", 2.19));
    expect(thumbKeyFor("a1", 2.11)).not.toBe(thumbKeyFor("a2", 2.11));
    expect(thumbKeyFor("a1", 1.0)).not.toBe(thumbKeyFor("a1", 2.0));
  });

  it("reads null for uncached slots without touching the decoder", () => {
    expect(readTrackThumb("missing@0.0")).toBeNull();
  });

  it("keeps coarser filmstrip slots when the strip grows", () => {
    const wide = stableFilmstripProgress(10);
    for (let count = 1; count < 10; count += 1) {
      for (const progress of stableFilmstripProgress(count)) {
        expect(wide.some((point) => Math.abs(point - progress) < 1e-6)).toBe(true);
      }
    }
    expect(stableFilmstripProgress(2)).toHaveLength(2);
    expect(stableFilmstripProgress(1)[0]).toBeCloseTo(0.5, 5);
  });

  it("shows the nearest cached frame instead of a blank slot", () => {
    primeTrackThumb("asset-cache", 2.0, "data:image/gif;base64,cached");
    expect(readTrackThumb(thumbKeyFor("asset-cache", 2.0))).toBe(
      "data:image/gif;base64,cached",
    );
    expect(readNearestTrackThumb("asset-cache", 2.4)).toBe("data:image/gif;base64,cached");
    expect(readNearestTrackThumb("other-asset", 2.0)).toBeNull();
  });
});
