import { describe, expect, it } from "vitest";
import { fitMinSizeToWindow, fitWindowToScreen } from "../../src/lib/windowShell";

describe("fitWindowToScreen", () => {
  it("keeps the desired size on large screens", () => {
    expect(fitWindowToScreen(1440, 900, { width: 1920, height: 1080 })).toEqual({
      width: 1440,
      height: 900,
    });
  });

  it("shrinks 1440x900 to fit a 1366x768 laptop screen", () => {
    const fitted = fitWindowToScreen(1440, 900, { width: 1366, height: 768 });
    expect(fitted.width).toBeLessThanOrEqual(Math.floor(1366 * 0.96));
    expect(fitted.height).toBeLessThanOrEqual(Math.floor(768 * 0.94));
    expect(fitted.width).toBeLessThan(1440);
    expect(fitted.height).toBeLessThan(900);
  });

  it("shrinks to fit a 1280x720 screen", () => {
    const fitted = fitWindowToScreen(1440, 900, { width: 1280, height: 720 });
    expect(fitted.width).toBeLessThanOrEqual(1280);
    expect(fitted.height).toBeLessThanOrEqual(720);
  });

  it("falls back to the desired size when the monitor is unknown", () => {
    expect(fitWindowToScreen(1440, 900, null)).toEqual({ width: 1440, height: 900 });
  });
});

describe("fitMinSizeToWindow", () => {
  it("keeps configured minimums when the window is large enough", () => {
    expect(
      fitMinSizeToWindow(960, 620, { width: 1311, height: 721 }),
    ).toEqual({ width: 960, height: 620 });
  });

  it("never lets the minimum exceed the fitted window size", () => {
    expect(fitMinSizeToWindow(960, 620, { width: 800, height: 500 })).toEqual({
      width: 800,
      height: 500,
    });
  });
});
