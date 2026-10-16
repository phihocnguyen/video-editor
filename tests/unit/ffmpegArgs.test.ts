import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addTextClip,
  buildFfmpegArgs,
  buildRenderPlan,
  createEmptyProject,
  updateCanvas,
  updateClipEffects,
  type MediaAsset,
} from "../../src/domain";
import { clipSetpts } from "../../src/domain/ffmpegArgs";
import { DEFAULT_CLIP_EFFECTS } from "../../src/domain/effects";
import type { RenderClipPlan } from "../../src/domain/renderPlan";
import {
  createSpeedPoint,
  rampOutputDurationSec,
  rampTimeMapSegments,
  type SpeedRamp,
} from "../../src/domain/speedRamp";

function clipPlan(overrides: Partial<RenderClipPlan> = {}): RenderClipPlan {
  return {
    clipId: "c1",
    trackId: "t1",
    trackOrder: 0,
    assetPath: "C:/media/clip.mp4",
    timelineStartSec: 0,
    timelineEndSec: 4,
    sourceInSec: 0,
    sourceOutSec: 4,
    volume: 1,
    opacity: 1,
    speed: 1,
    speedRamp: null,
    includeAudio: true,
    kind: "video",
    effects: { ...DEFAULT_CLIP_EFFECTS },
    effectKeyframes: null,
    transformKeyframes: null,
    transitionIn: { type: "none", durationTicks: 0 } as RenderClipPlan["transitionIn"],
    transitionOverlapSec: 0,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    },
    canvasWidth: 1920,
    canvasHeight: 1080,
    mediaWidth: 1280,
    mediaHeight: 720,
    ...overrides,
  };
}

function ramp(points: { atProgress: number; speed: number }[]): SpeedRamp {
  return { points: points.map((p) => createSpeedPoint(p.atProgress, p.speed)) };
}

describe("buildFfmpegArgs", () => {
  it("builds a filter_complex mapping outv", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/media/clip.mp4",
      name: "clip.mp4",
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    expect(built.program).toBe("ffmpeg");
    expect(built.args).toContain("-filter_complex");
    expect(built.args).toContain("[outv]");
    expect(built.args).toContain("libx264");
    expect(built.tempOutput).toMatch(/\.tmp\.mp4$/i);
  });

  it("forces canvas fps and sharp placement (no double resample)", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/media/clip.mp4",
      name: "clip.mp4",
      durationTicks: 3_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    // CFR at canvas fps, matching preview motion.
    expect(filter).toContain("fps=30[outv]");
    expect(filter).toContain("flags=lanczos");
    expect(filter).toContain("setsar=1");
  });

  it("prefers bundled OFL faces over system fallback for drawtext", () => {
    let project = createEmptyProject();
    project = addTextClip(project, { text: { content: "Hi" } });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: (p) =>
        p === "C:/Windows/Fonts/arial.ttf" || p.endsWith(".mp4") || true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("drawtext=text='Hi'");
    // Default family is Manrope Variable (preview weight 700) → shipped Bold TTF, not Arial.
    expect(filter).toContain("fontfile='public/fonts/Manrope-Bold.ttf'");
  });

  it("honors an explicit custom fontfile when the file exists", () => {    let project = createEmptyProject();
    project = addTextClip(project, { text: { content: "Hi" } });
    const plan = buildRenderPlan(project, "source", "draft");
    plan.texts[0]!.fontPath = "C:/fonts/Custom.ttf";
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fontfile='C\\:/fonts/Custom.ttf'");
  });

  it("emits drawtext box for Instagram-style text background", () => {
    let project = createEmptyProject();
    project = addTextClip(project, {
      text: {
        content: "Story",
        backgroundColor: "#FFFFFF",
        backgroundPadding: 14,
      },
    });
    const plan = buildRenderPlan(project, "source", "draft");
    expect(plan.texts[0]?.backgroundColor).toBe("#FFFFFF");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("box=1");
    expect(filter).toContain("boxcolor=");
    expect(filter).toContain("boxborderw=");
  });

  it("paints cinematic top/bottom bars without touching left/right", () => {
    let project = createEmptyProject();
    project = updateCanvas(project, {
      letterbox: { enabled: true, topPct: 15, bottomPct: 18, leftPct: 0, rightPct: 0 },
    });
    // User Ctrl+drags only the top/bottom edges in preview.
    project = updateCanvas(project, { letterbox: { topPct: 15 } });
    project = updateCanvas(project, { letterbox: { bottomPct: 18 } });
    const plan = buildRenderPlan(project, "source", "draft");
    expect(plan.letterbox.leftPct).toBe(0);
    expect(plan.letterbox.rightPct).toBe(0);
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    // 1080p canvas: top = 15% , bottom = 18%.
    expect(filter).toContain("drawbox=x=0:y=0:w=iw:h=162");
    expect(filter).toContain("drawbox=x=0:y=ih-194:w=iw:h=194");
    // No full-height side bars.
    expect(filter).not.toContain("h=ih:c=");
  });

  it("insets cinematic side bars between top/bottom (preview parity)", () => {
    let project = createEmptyProject();
    project = updateCanvas(project, {
      letterbox: { enabled: true, topPct: 12, bottomPct: 12, leftPct: 5, rightPct: 5 },
    });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    // 1080p canvas: top/bottom = 130px, sides sit between them (y=130, h=820).
    expect(filter).toContain("drawbox=x=0:y=130:w=96:h=820");
    expect(filter).toContain("drawbox=x=iw-96:y=130:w=96:h=820");
  });

  it("paints lower-order tracks above higher-order ones (preview parity)", () => {
    // Preview: layerStackZ gives lower track.order the higher z (on top).
    // Export must paint in the same order: high order first (behind).
    let project = createEmptyProject();
    const v1 = project.tracks.find((t) => t.kind === "video")!;
    const overlayTrack = {
      id: "vt",
      kind: "video" as const,
      name: "V0",
      order: -1,
      muted: false,
      visible: true,
      locked: false,
      volume: 1,
    };
    project = { ...project, tracks: [...project.tracks, overlayTrack] };
    const image: MediaAsset = {
      id: "a1",
      kind: "image",
      path: "C:/media/pic.png",
      name: "pic.png",
      durationTicks: 4_000_000,
      width: 640,
      height: 480,
      frameRate: null,
      hasAudio: false,
      missing: false,
    };
    project = { ...project, assets: [image] };
    project = addMediaClip(project, "a1", { trackId: "vt", startTicks: 0 });
    project = addTextClip(project, { trackId: v1.id, startTicks: 0 });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    // Text (order 0) is painted before the top-track media overlay (order -1).
    expect(filter).toContain("drawtext=");
    expect(filter.indexOf("drawtext=")).toBeLessThan(filter.lastIndexOf("overlay="));
  });

  it("emits a piecewise-quadratic setpts + segmented atempo for a ramped clip", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/media/clip.mp4",
      name: "clip.mp4",
      durationTicks: 4_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    project = {
      ...project,
      clips: project.clips.map((c) => ({
        ...c,
        speedRamp: ramp([
          { atProgress: 0, speed: 1 },
          { atProgress: 0.5, speed: 0.5 },
          { atProgress: 1, speed: 2 },
        ]),
      })),
    };
    const plan = buildRenderPlan(project, "720", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    // Forward map u→t with valid setpts variables (lowercase t would not parse).
    expect(filter).toContain("setpts=(if(gte(((PTS-STARTPTS)*TB)\\,");
    expect(filter).toContain(")/TB");
    expect(filter).not.toContain("sqrt(");
    // Audio ramp is approximated with sliced atempo segments joined by concat.
    expect(filter).toContain("concat=n=");
    expect(filter).toContain("atempo=");
  });

  it("emits video fade and audio afade with matching durations", () => {
    let project = createEmptyProject();
    const asset: MediaAsset = {
      id: "a1",
      kind: "video",
      path: "C:/media/clip.mp4",
      name: "clip.mp4",
      durationTicks: 10_000_000,
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      missing: false,
    };
    project = { ...project, assets: [asset] };
    project = addMediaClip(project, "a1", { startTicks: 0 });
    const id = project.clips[0]!.id;
    project = updateClipEffects(project, id, { fadeInSec: 1, fadeOutSec: 2 });
    const plan = buildRenderPlan(project, "source", "draft");
    const built = buildFfmpegArgs(plan, "C:/out/export.mp4", {
      fileExists: () => true,
    });
    const filter = built.args[built.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("fade=t=in:st=0.000:d=1.000:alpha=1");
    expect(filter).toContain("fade=t=out:st=8.000:d=2.000:alpha=1");
    expect(filter).toContain("afade=t=in:st=0.000:d=1.000");
    expect(filter).toContain("afade=t=out:st=8.000:d=2.000");
  });
});

describe("clipSetpts", () => {
  it("is identity for speed 1 with no ramp", () => {
    expect(clipSetpts(clipPlan())).toBe("setpts=PTS-STARTPTS");
  });

  it("divides PTS for constant speed", () => {
    expect(clipSetpts(clipPlan({ speed: 2 }))).toBe("setpts=(PTS-STARTPTS)/2");
  });

  it("produces a nested piecewise expression for a ramp", () => {
    const expr = clipSetpts(
      clipPlan({
        sourceOutSec: 4,
        speedRamp: ramp([
          { atProgress: 0, speed: 1 },
          { atProgress: 1, speed: 2 },
        ]),
      }),
    );
    expect(expr.startsWith("setpts=")).toBe(true);
    expect(expr).toContain("if(gte(((PTS-STARTPTS)*TB)\\,");
    expect(expr).toContain("STARTPTS");
    expect(expr).toContain(")/TB");
    // No quadratic inverse: setpts maps input u → output t (forward only).
    expect(expr).not.toContain("sqrt(");
    expect(expr).not.toContain("gte(t\\,");
  });

  it("maps the last ramp segment back to the full source span", () => {
    // The forward map must reproduce the analytic output duration: evaluating
    // the last segment at u = span gives T(span) ≈ ramp duration.
    const span = 2;
    const r = ramp([
      { atProgress: 0, speed: 2 },
      { atProgress: 1, speed: 0.5 },
    ]);
    const expr = clipSetpts(clipPlan({ sourceOutSec: span, speedRamp: r }));
    const numbers = expr.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBeGreaterThan(4);
    for (const value of numbers) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // tStart of the final segment plus its full quadratic step ≈ duration.
    const segs = rampTimeMapSegments(r, span, 32);
    const last = segs[segs.length - 1]!;
    const du = last.uEnd - last.uStart;
    const approx = last.tStart + last.a * du + last.b * du * du;
    expect(approx).toBeCloseTo(rampOutputDurationSec(r, span), 2);
    expect(expr).toContain(`if(gte(((PTS-STARTPTS)*TB)\\,${last.uStart}`);
  });
});

