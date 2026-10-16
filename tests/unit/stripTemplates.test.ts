import { describe, expect, it } from "vitest";
import {
  containFitBox,
  coverTransform,
  cropClipPath,
  slotToPixels,
} from "../../src/domain/mediaTransform";
import {
  STRIP_CANVAS,
  STRIP_DURATION_TICKS,
  applyStripTemplate,
  getStripTemplate,
} from "../../src/domain/stripTemplates";
import { clipDurationTicks } from "../../src/domain/timelineCommands";
import { buildFfmpegArgs, mediaPlacementFilters } from "../../src/domain/ffmpegArgs";
import { DEFAULT_CLIP_EFFECTS } from "../../src/domain/effects";
import type { RenderClipPlan } from "../../src/domain/renderPlan";

function asset(i: number, w: number, h: number, dur = 5_000_000) {
  return {
    id: `a${i}`,
    kind: "video" as const,
    width: w,
    height: h,
    durationTicks: dur,
  };
}

describe("coverTransform", () => {
  const canvas = { width: 1080, height: 1920 };
  const cell = { x: 43.2, y: 76.8, w: 453.6, h: 800 };
  for (const [label, w, h] of [
    ["wide", 1920, 1080],
    ["tall", 1080, 1920],
    ["square", 1000, 1000],
  ] as const) {
    it(`${label} photo covers the cell and stays centered`, () => {
      const cov = coverTransform(cell, { width: w, height: h }, canvas);
      expect(cov.x).toBeCloseTo(cell.x + cell.w / 2, 6);
      expect(cov.y).toBeCloseTo(cell.y + cell.h / 2, 6);
      const fit = containFitBox(canvas.width, canvas.height, w, h);
      expect(cov.scale).toBeCloseTo(
        Math.max(cell.w / fit.width, cell.h / fit.height),
        6,
      );
      // Covered: scaled box spans the cell on both axes.
      expect(fit.width * cov.scale).toBeGreaterThanOrEqual(cell.w - 1e-6);
      expect(fit.height * cov.scale).toBeGreaterThanOrEqual(cell.h - 1e-6);
    });
  }
});

describe("cropClipPath", () => {
  it("clips the layer box to the cell, not a corner of the canvas", () => {
    const canvas = { width: 1080, height: 1920 };
    const slot = { x: 0.04, y: 0.04, w: 0.451, h: 0.451 };
    const cell = slotToPixels(slot, canvas.width, canvas.height);
    const media = { width: 1920, height: 1080 };
    const cov = coverTransform(cell, media, canvas);
    const fit = containFitBox(canvas.width, canvas.height, media.width, media.height);
    const path = cropClipPath(
      slot,
      {
        centerX: cov.x,
        centerY: cov.y,
        fitWidth: fit.width,
        fitHeight: fit.height,
        scaleX: cov.scale,
        scaleY: cov.scale,
      },
      canvas.width,
      canvas.height,
    );
    const parts = path.match(/inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)/);
    expect(parts).not.toBeNull();
    const top = Number(parts![1]);
    const right = Number(parts![2]);
    const bottom = Number(parts![3]);
    const left = Number(parts![4]);
    const sx = cov.scale;
    const sy = cov.scale;
    const x0 = cov.x + ((left / 100) * fit.width - fit.width / 2) * sx;
    const y0 = cov.y + ((top / 100) * fit.height - fit.height / 2) * sy;
    const x1 = cov.x + (((100 - right) / 100) * fit.width - fit.width / 2) * sx;
    const y1 = cov.y + (((100 - bottom) / 100) * fit.height - fit.height / 2) * sy;
    expect(x0).toBeCloseTo(cell.x, 1);
    expect(y0).toBeCloseTo(cell.y, 1);
    expect(x1).toBeCloseTo(cell.x + cell.w, 1);
    expect(y1).toBeCloseTo(cell.y + cell.h, 1);
  });
});

describe("applyStripTemplate", () => {
  it("strip-4: canvas size, 10s, one track per cell, no audio clips", () => {
    const t = getStripTemplate("strip-4")!;
    const project = applyStripTemplate(
      t,
      [asset(0, 1920, 1080), asset(1, 1080, 1920), asset(2, 800, 800), asset(3, 640, 480)],
    );
    expect(project.canvas.width).toBe(STRIP_CANVAS.width);
    expect(project.canvas.height).toBe(STRIP_CANVAS.height);
    expect(project.canvas.frameRate).toBe(30);
    expect(project.tracks.filter((tr) => tr.kind === "audio")).toHaveLength(1);
    expect(project.clips.every((c) => c.kind === "media")).toBe(true);
    const cells = project.clips.filter((c) => c.slotId);
    expect(cells).toHaveLength(4);
    // Row-major: clip i sits in slot i with matching crop.
    cells.forEach((clip, i) => {
      expect(clip.crop).toMatchObject(t.slots[i]!);
      expect(clip.startTicks).toBe(0);
    });
    // Every cell transform covers its slot.
    const dims: Record<string, { width: number; height: number }> = {
      a0: { width: 1920, height: 1080 },
      a1: { width: 1080, height: 1920 },
      a2: { width: 800, height: 800 },
      a3: { width: 640, height: 480 },
    };
    for (const clip of cells) {
      const slot = clip.crop!;
      const px = {
        x: slot.x * project.canvas.width,
        y: slot.y * project.canvas.height,
        w: slot.w * project.canvas.width,
        h: slot.h * project.canvas.height,
      };
      const cov = coverTransform(px, dims[clip.assetId!]!, project.canvas);
      expect(clip.transform.x).toBeCloseTo(px.x + px.w / 2, 3);
      expect(clip.transform.y).toBeCloseTo(px.y + px.h / 2, 3);
      expect(clip.transform.scaleX).toBeCloseTo(cov.scale, 6);
      void clip;
    }
  });

  it("too few files leave empty cells; too many files are not placed", () => {
    const t = getStripTemplate("strip-8")!;
    const few = applyStripTemplate(t, [asset(0, 1920, 1080)]);
    expect(few.clips.filter((c) => c.slotId)).toHaveLength(1);
    const many = applyStripTemplate(
      t,
      Array.from({ length: 12 }, (_, i) => asset(i, 1920, 1080)),
    );
    const placedIds = many.clips.filter((c) => c.slotId).map((c) => c.assetId);
    expect(placedIds).toHaveLength(8);
    expect(placedIds).toEqual(Array.from({ length: 8 }, (_, i) => `a${i}`));
  });

  it("images hold the full 10 seconds", () => {
    const t = getStripTemplate("strip-4")!;
    const project = applyStripTemplate(t, [
      { id: "img", kind: "image", width: 1200, height: 800, durationTicks: null },
    ]);
    const clip = project.clips.find((c) => c.slotId)!;
    expect(clipDurationTicks(clip)).toBe(STRIP_DURATION_TICKS);
  });

  it("film-pair-8: n assets → 2n clips, only left is grayscale", () => {
    const t = getStripTemplate("film-pair-8")!;
    const files = Array.from({ length: 8 }, (_, i) => asset(i, 1920, 1080));
    const project = applyStripTemplate(t, files);
    const cells = project.clips.filter((c) => c.slotId);
    expect(cells).toHaveLength(16);
    const left = cells.slice(0, 8);
    const right = cells.slice(8);
    expect(left.every((c) => c.effects.grayscale)).toBe(true);
    expect(right.every((c) => !c.effects.grayscale)).toBe(true);
    // File i is in left cell i and the matching right cell.
    left.forEach((clip, i) => expect(clip.assetId).toBe(`a${i}`));
    right.forEach((clip, i) => expect(clip.assetId).toBe(`a${i}`));
    // Frame sits on locked order-0 track above the cells.
    const frameTrack = project.tracks.find((tr) => tr.name === "Frame")!;
    expect(frameTrack.order).toBe(0);
    expect(frameTrack.locked).toBe(true);
  });
});

describe("strip export", () => {
  function stripClip(): RenderClipPlan {
    return {
      clipId: "strip-clip-0",
      trackId: "strip-track-0",
      trackOrder: 1,
      assetPath: "C:/media/v0.mp4",
      timelineStartSec: 0,
      timelineEndSec: 10,
      sourceInSec: 0,
      sourceOutSec: 2,
      volume: 1,
      opacity: 1,
      speed: 1,
      speedRamp: null,
      includeAudio: false,
      kind: "video",
      effects: { ...DEFAULT_CLIP_EFFECTS },
      effectKeyframes: null,
      transformKeyframes: null,
      transitionIn: { type: "none", durationTicks: 0 },
      transitionOverlapSec: 0,
      transform: {
        x: 270,
        y: 480,
        scaleX: 0.5,
        scaleY: 0.5,
        rotation: 0,
        opacity: 1,
      },
      canvasWidth: 1080,
      canvasHeight: 1920,
      mediaWidth: 1920,
      mediaHeight: 1080,
      crop: { x: 0.04, y: 0.04, w: 0.44, h: 0.44 },
    };
  }

  it("placement crops the cell and re-pads to full frame", () => {
    const filters = mediaPlacementFilters(stripClip(), 540, 960);
    expect(filters).toContain("crop=");
    expect(filters).toContain("pad=540:960");
  });

  it("short video in a 10s slot holds its last frame", () => {
    const clip = stripClip();
    const built = buildFfmpegArgs(
      {
        width: 540,
        height: 960,
        frameRate: 30,
        backgroundColor: "#000000",
        letterbox: {
          enabled: false,
          topPct: 0,
          bottomPct: 0,
          leftPct: 0,
          rightPct: 0,
          color: "#000000",
        },
        durationSec: 10,
        videoBitrate: "6M",
        audioBitrate: "192k",
        clips: [clip],
        texts: [],
        washes: [],
        missingAssetIds: [],
      },
      "C:/out/strip.mp4",
      { fileExists: () => true },
    );
    const filter = built.args[built.args.indexOf("-filter_complex") + 1]!;
    // 10s timeline − 2s source = ~8s of cloned hold.
    expect(filter).toContain("tpad=stop_mode=clone:stop_duration=8.000");
  });
});
