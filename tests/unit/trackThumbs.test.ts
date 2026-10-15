import { describe, expect, it } from "vitest";
import { quantizeThumbTime, readTrackThumb, thumbKeyFor } from "../../src/lib/trackThumbs";

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
});
