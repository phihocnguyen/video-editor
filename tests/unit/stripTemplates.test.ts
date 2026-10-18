import { describe, expect, it } from "vitest";
import {
  containFitBox,
  coverTransform,
  cropClipPath,
  slotToPixels,
} from "../../src/domain/mediaTransform";
import { BOOTH_DECORS, boothDecorCenter, boothDecorsForGroups } from "../../src/domain/boothDecor";
import { BOOTH_THEMES, boothThemeById } from "../../src/domain/boothThemes";
import { BOOTH_FRAMES, BOOTH_PATTERNS } from "../../src/domain/boothOverlays";
import { boothLayout, rotatePoint } from "../../src/domain/boothStrip";
import {
  BOOTH_DURATION_TICKS,
  applyBoothTemplate,
  isStripGeneratedAsset,
  swapStripCellByClip,
} from "../../src/domain/stripTemplates";
import { clipDurationTicks } from "../../src/domain/timelineCommands";
import {
  clipVisibleWithTransition,
  transitionAwareMediaTimeSec,
} from "../../src/domain/transitions";
import { buildFfmpegArgs, mediaPlacementFilters } from "../../src/domain/ffmpegArgs";
import { buildRenderPlan } from "../../src/domain/renderPlan";
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

describe("isStripGeneratedAsset", () => {
  it("flags the booth paper, stickers, patterns and frames only", () => {
    expect(isStripGeneratedAsset("__booth-paper__")).toBe(true);
    expect(isStripGeneratedAsset("__booth-decor-note-a")).toBe(true);
    expect(isStripGeneratedAsset("__booth-pattern-dots")).toBe(true);
    expect(isStripGeneratedAsset("__booth-frame-gold")).toBe(true);
    expect(isStripGeneratedAsset("a0")).toBe(false);
    expect(isStripGeneratedAsset("imported-photo")).toBe(false);
  });
});

describe("photo booth", () => {
  it("lays a white card of four landscape cells on a chosen background", () => {
    const project = applyBoothTemplate(
      [asset(0, 1920, 1080), asset(1, 1080, 1920), asset(2, 800, 800), asset(3, 640, 480)],
      { themeId: "classic", backgroundColor: "#112233", durationTicks: 15_000_000, grayscale: true },
    );
    expect(project.canvas).toMatchObject({ width: 1080, height: 1350, backgroundColor: "#112233" });
    const cells = project.clips.filter((c) => c.slotId);
    expect(cells).toHaveLength(4);
    const layout = boothLayout({ upright: true });
    const cx = layout.canvas.width / 2;
    const cy = layout.canvas.height / 2;
    cells.forEach((clip, i) => {
      const upright = layout.cells[i]!;
      const mid = rotatePoint(
        upright.x + upright.w / 2,
        upright.y + upright.h / 2,
        cx,
        cy,
        layout.rotationDeg,
      );
      expect(clip.transform.rotation).toBe(layout.rotationDeg);
      expect(clip.transform.x).toBeCloseTo(mid.x, 3);
      expect(clip.transform.y).toBeCloseTo(mid.y, 3);
      expect(clip.effects.grayscale).toBe(true);
      expect(clipDurationTicks(clip)).toBe(15_000_000);
      expect(clip.suppressEmbeddedAudio).toBe(true);
    });
    const paper = project.clips.find((c) => c.assetId === "__booth-paper__")!;
    expect(paper.transform.rotation).toBe(layout.rotationDeg);
    expect(paper.crop).toBeNull();
    const paperTrack = project.tracks.find((tr) => tr.id === paper.trackId)!;
    expect(paperTrack.locked).toBe(true);
    // Paper paints under the photos (higher track order).
    const cellTrack = project.tracks.find((tr) => tr.id === cells[0]!.trackId)!;
    expect(paperTrack.order).toBeGreaterThan(cellTrack.order);
    expect(project.assets.some((a) => a.id.startsWith("__booth-decor-"))).toBe(false);
  });

  it("keeps the classic tilt only when upright is off", () => {
    const tilted = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "classic",
      upright: false,
    });
    const tiltedLayout = boothLayout({ upright: false });
    expect(tilted.clips.find((c) => c.slotId)!.transform.rotation).toBe(tiltedLayout.rotationDeg);

    const flat = applyBoothTemplate([asset(0, 1920, 1080)], { themeId: "classic" });
    expect(flat.clips.find((c) => c.slotId)!.transform.rotation).toBe(0);
  });

  it("shapes the card from the photo count and column count", () => {
    const two = applyBoothTemplate([asset(0, 1920, 1080), asset(1, 1920, 1080)], {
      themeId: "classic",
      photoCount: 2,
    });
    expect(two.clips.filter((c) => c.slotId)).toHaveLength(2);
    expect(two.tracks.filter((tr) => tr.name.startsWith("cell-"))).toHaveLength(2);

    const grid = applyBoothTemplate(
      Array.from({ length: 6 }, (_, i) => asset(i, 1920, 1080)),
      { themeId: "classic", photoCount: 6, columns: 2 },
    );
    expect(grid.clips.filter((c) => c.slotId)).toHaveLength(6);
    const layout = boothLayout({ upright: true, photos: 6, columns: 2 });
    expect(layout.columns).toBe(2);
    expect(layout.cells).toHaveLength(6);
    // Extra files past the photo count are ignored.
    const extra = applyBoothTemplate(
      Array.from({ length: 4 }, (_, i) => asset(i, 1920, 1080)),
      { themeId: "classic", photoCount: 2 },
    );
    expect(extra.clips.filter((c) => c.slotId)).toHaveLength(2);
  });

  it("draws a background pattern behind the card", () => {
    const pattern = BOOTH_PATTERNS[0]!;
    const project = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "classic",
      patternId: pattern.id,
    });
    const clip = project.clips.find((c) => c.assetId === pattern.id);
    expect(clip).toBeTruthy();
    const track = project.tracks.find((tr) => tr.id === clip!.trackId)!;
    const paperTrack = project.tracks.find((tr) => tr.id === "strip-track-paper")!;
    expect(track.order).toBeGreaterThan(paperTrack.order);
    expect(project.assets.find((a) => a.id === pattern.id)?.width).toBe(project.canvas.width);
  });

  it("draws a frame over the card, aligned with the paper transform", () => {
    const frame = BOOTH_FRAMES[0]!;
    const project = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "classic",
      frameId: frame.id,
    });
    const clip = project.clips.find((c) => c.assetId === frame.id)!;
    const paper = project.clips.find((c) => c.assetId === "__booth-paper__")!;
    expect(clip.transform.x).toBeCloseTo(paper.transform.x, 6);
    expect(clip.transform.y).toBeCloseTo(paper.transform.y, 6);
    expect(clip.transform.scaleX).toBeCloseTo(paper.transform.scaleX, 6);
    expect(clip.transform.rotation).toBe(paper.transform.rotation);
    const frameTrack = project.tracks.find((tr) => tr.id === clip.trackId)!;
    const cellTrack = project.tracks.find((tr) => tr.name === "cell-0")!;
    expect(frameTrack.order).toBeLessThan(cellTrack.order);
    expect(project.assets.find((a) => a.id === frame.id)?.height).toBe(
      project.assets.find((a) => a.id === "__booth-paper__")!.height,
    );
  });

  it("prints a caption on a reserved band at the bottom of the card", () => {
    const project = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "graduation",
      title: "Class of 2026",
      titleColor: "#F2C14E",
    });
    const text = project.clips.find((c) => c.kind === "text")!;
    expect(text.text?.content).toBe("Class of 2026");
    expect(text.text?.color).toBe("#F2C14E");
    expect(text.transform.rotation).toBe(0);
    const plain = boothLayout({ upright: true, stickerMargin: true });
    const withBand = boothLayout({
      upright: true,
      stickerMargin: true,
      titleBand: Math.round(project.canvas.height * 0.08),
    });
    expect(withBand.paper.h).toBeGreaterThan(plain.paper.h);
    // Caption sits below the photo windows.
    const cells = project.clips.filter((c) => c.slotId);
    const lastCell = cells[cells.length - 1]!;
    expect(text.transform.y).toBeGreaterThan(lastCell.transform.y);
  });

  it("draws theme stickers around the card", () => {
    const love = boothThemeById("love");
    const project = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "love",
      decorGroups: love.groups.map((group) => group.id),
      durationTicks: 5_000_000,
    });
    expect(project.clips.filter((c) => c.slotId).every((c) => c.transform.rotation === 0)).toBe(true);
    expect(project.assets.some((a) => a.id.includes("love-heart"))).toBe(true);
    const decors = boothDecorsForGroups([]);
    expect(decors).toHaveLength(0);
    const layout = boothLayout({ upright: true, stickerMargin: true });
    const stickers = love.decors.filter((decor) => decor.anchor !== "backdrop");
    for (const decor of stickers) {
      const clip = project.clips.find((c) => c.assetId === decor.id)!;
      const center = boothDecorCenter(decor, layout.paper, layout.canvas);
      expect(clip).toBeTruthy();
      expect(clip.transform.x).toBeCloseTo(center.x, 3);
      expect(clip.transform.y).toBeCloseTo(center.y, 3);
      expect(clip.transform.rotation).toBe(decor.rotation);
    }
  });

  it("draws a chosen theme around an upright card", () => {
    const ids = BOOTH_THEMES.flatMap((theme) => theme.decors.map((decor) => decor.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOOTH_THEMES.flatMap((theme) => theme.decors).every((decor) => decor.svg.includes("<svg"))).toBe(
      true,
    );
    const classic = applyBoothTemplate([asset(0, 1920, 1080)], { themeId: "classic" });
    expect(classic.clips.find((c) => c.slotId)!.transform.rotation).toBe(0);
    expect(classic.assets.some((a) => a.id.startsWith("__booth-decor-"))).toBe(false);
    for (const theme of BOOTH_THEMES) {
      expect(/^#[0-9a-fA-F]{6}$/.test(theme.titleColor)).toBe(true);
    }
  });

  it("ships at least one new expanded theme with flowers or leaves", () => {
    const grad = boothThemeById("graduation");
    const flowers = grad.decors.filter((decor) => decor.group === "flowers");
    expect(flowers.length).toBeGreaterThanOrEqual(2);
    const autumn = boothThemeById("autumn");
    expect(autumn.decors.some((decor) => decor.group === "maple")).toBe(true);
    expect(BOOTH_DECORS.every((decor) => decor.svg.includes("<svg"))).toBe(true);
  });

  it("holds a short video for the chosen length instead of playing it out", () => {
    const project = applyBoothTemplate([asset(0, 1920, 1080, 2_000_000)], {
      themeId: "classic",
      durationTicks: 8_000_000,
    });
    const clip = project.clips.find((c) => c.slotId)!;
    expect(clip.sourceOutTicks).toBeLessThanOrEqual(100_000);
    expect(clipDurationTicks(clip)).toBe(8_000_000);
    expect(clipVisibleWithTransition(clip, 4_000_000, project)).toBe(true);
    expect(transitionAwareMediaTimeSec(clip, 4_000_000)).toBeLessThan(0.1);
  });

  it("keeps the booth length when a cell is replaced", () => {
    let project = applyBoothTemplate([asset(0, 1920, 1080)], {
      themeId: "classic",
      durationTicks: 12_000_000,
      grayscale: false,
    });
    project = {
      ...project,
      assets: [
        ...project.assets,
        {
          id: "swap",
          kind: "image",
          path: "C:/swap.jpg",
          name: "swap",
          durationTicks: null,
          width: 400,
          height: 800,
          frameRate: null,
          hasAudio: false,
          missing: false,
        },
      ],
    };
    const cell = project.clips.find((c) => c.slotId)!;
    const next = swapStripCellByClip(project, cell.id, {
      id: "swap",
      kind: "image",
      width: 400,
      height: 800,
      durationTicks: null,
    });
    const replaced = next.clips.find((c) => c.id === cell.id)!;
    expect(replaced.assetId).toBe("swap");
    expect(clipDurationTicks(replaced)).toBe(12_000_000);
    expect(replaced.transform.rotation).toBe(cell.transform.rotation);
    expect(replaced.effects.grayscale).toBe(false);
  });

  it("exports the still for the chosen length on the chosen background", () => {
    const project = applyBoothTemplate(
      [{ id: "img", kind: "image", width: 1200, height: 800, durationTicks: null }],
      { themeId: "classic", backgroundColor: "#112233", durationTicks: 6_000_000 },
    );
    project.assets = project.assets.map((a) =>
      a.id === "img"
        ? { ...a, path: "C:/a.jpg" }
        : a.id === "__booth-paper__"
          ? { ...a, path: "C:/paper.png" }
          : a,
    );
    // The applier does not attach the dropped file; the panel does.
    if (!project.assets.some((a) => a.id === "img")) {
      project.assets.unshift({
        id: "img",
        kind: "image",
        path: "C:/a.jpg",
        name: "a",
        durationTicks: null,
        width: 1200,
        height: 800,
        frameRate: null,
        hasAudio: false,
        missing: false,
      });
    }
    const plan = buildRenderPlan(project, "source", "draft");
    expect(plan.backgroundColor).toBe("#112233");
    expect(plan.durationSec).toBeCloseTo(6, 2);
    const built = buildFfmpegArgs(plan, "C:/out/booth.mp4", { fileExists: () => true });
    const color = built.args.find((arg) => arg.startsWith("color="));
    expect(color).toContain("0x112233");
    expect(built.args.join(" ")).toContain("-t 6.000");
  });

  it("default duration is the 10 second booth hold", () => {
    const project = applyBoothTemplate([asset(0, 1920, 1080)], { themeId: "classic" });
    const clip = project.clips.find((c) => c.slotId)!;
    expect(clipDurationTicks(clip)).toBe(BOOTH_DURATION_TICKS);
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

  it("rotated booth cell crops locally before it rotates, then fills the frame", () => {
    const clip = stripClip();
    clip.transform.rotation = 34;
    clip.canvasWidth = 1080;
    clip.canvasHeight = 1350;
    const filters = mediaPlacementFilters(clip, 1080, 1350);
    const cropAt = filters.indexOf("crop=");
    const rotAt = filters.indexOf("rotate=");
    expect(cropAt).toBeGreaterThan(0);
    expect(rotAt).toBeGreaterThan(cropAt);
    expect(filters).toContain("pad=1080:1350:");
    const pad = filters.match(/pad=1080:1350:(\d+):(\d+)/);
    expect(pad).not.toBeNull();
    const x = Number(pad![1]);
    const y = Number(pad![2]);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1080);
    expect(y).toBeLessThan(1350);
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
