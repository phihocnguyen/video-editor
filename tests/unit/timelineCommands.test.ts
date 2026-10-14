import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addRampPointAtPlayhead,
  enableSpeedRamp,
  addTrack,
  applySpeedToRange,
  clipDurationTicks,
  deleteClips,
  moveClip,
  moveClipLayer,
  moveRampPoint,
  removeRampPoint,
  removeTrack,
  setClipRamp,
  setRampPointSpeed,
  splitClipAt,
  trimClip,
  updateCanvas,
  updateClipAnimation,
  updateClipSpeed,
  updateTrack,
} from "../../src/domain/timelineCommands";
import { addTextClip, createEmptyProject, type MediaAsset } from "../../src/domain";
import { createSpeedPoint } from "../../src/domain/speedRamp";

function withAsset(kind: MediaAsset["kind"] = "video"): ReturnType<typeof createEmptyProject> {
  const project = createEmptyProject();
  const asset: MediaAsset = {
    id: "asset-1",
    kind,
    path: "C:/media/clip.mp4",
    name: "clip.mp4",
    durationTicks: 10_000_000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    hasAudio: true,
    missing: false,
  };
  return { ...project, assets: [asset] };
}

describe("timelineCommands", () => {
  it("adds a media clip onto a compatible track", () => {
    const project = withAsset("video");
    const next = addMediaClip(project, "asset-1", { startTicks: 2_000_000 });
    expect(next.clips).toHaveLength(1);
    expect(next.clips[0].startTicks).toBe(2_000_000);
    expect(next.clips[0].sourceOutTicks).toBe(10_000_000);
    expect(next.clips[0].trackId).toBe(project.tracks.find((t) => t.kind === "video")!.id);
  });

  it("centres a new media clip transform and defaults text animation", () => {
    const media = addMediaClip(withAsset(), "asset-1");
    expect(media.clips[0].transform.x).toBe(960);
    expect(media.clips[0].transform.y).toBe(540);
    expect(media.clips[0].animation).toBeNull();

    const withText = addTextClip(media, { text: { content: "Hi" } });
    const textClip = withText.clips.find((c) => c.kind === "text")!;
    expect(textClip.animation).toEqual({
      in: "none",
      out: "none",
      durationTicks: 600_000,
    });
  });

  it("updates text animation and canvas settings", () => {
    let project = addTextClip(createEmptyProject());
    const clipId = project.clips[0]!.id;
    project = updateClipAnimation(project, clipId, { in: "fade", out: "pop" });
    expect(project.clips[0]!.animation).toMatchObject({ in: "fade", out: "pop" });

    project = updateCanvas(project, { width: 1080, height: 1920, backgroundColor: "#abcdef" });
    expect(project.canvas.width).toBe(1080);
    expect(project.canvas.backgroundColor).toBe("#abcdef");
  });

  it("rejects audio assets on video tracks", () => {
    const project = withAsset("audio");
    const videoTrack = project.tracks.find((t) => t.kind === "video")!;
    expect(() =>
      addMediaClip(project, "asset-1", { trackId: videoTrack.id }),
    ).toThrow(/does not match/);
  });

  it("moves and deletes clips", () => {
    let project = addMediaClip(withAsset(), "asset-1");
    const clipId = project.clips[0].id;
    project = moveClip(project, clipId, 4_000_000);
    expect(project.clips[0].startTicks).toBe(4_000_000);
    project = deleteClips(project, [clipId]);
    expect(project.clips).toHaveLength(0);
  });

  it("trims and splits clips", () => {
    let project = addMediaClip(withAsset(), "asset-1", { startTicks: 0 });
    const clipId = project.clips[0].id;
    project = trimClip(project, clipId, 1_000_000, 8_000_000);
    expect(project.clips[0].sourceInTicks).toBe(1_000_000);
    expect(project.clips[0].sourceOutTicks).toBe(8_000_000);

    project = splitClipAt(project, clipId, 3_000_000);
    expect(project.clips).toHaveLength(2);
    expect(project.clips[0].sourceOutTicks).toBe(4_000_000);
    expect(project.clips[1].startTicks).toBe(3_000_000);
    expect(project.clips[1].sourceInTicks).toBe(4_000_000);
  });

  it("ignores split at clip boundaries", () => {
    const project = addMediaClip(withAsset(), "asset-1");
    const clipId = project.clips[0].id;
    const same = splitClipAt(project, clipId, 0);
    expect(same.clips).toHaveLength(1);
  });

  it("adds and removes tracks with safeguards", () => {
    let project = createEmptyProject();
    expect(project.tracks).toHaveLength(2);
    project = addTrack(project, "video");
    expect(project.tracks.filter((t) => t.kind === "video")).toHaveLength(2);
    const videoId = project.tracks.find((t) => t.name === "V2")!.id;
    project = removeTrack(project, videoId);
    expect(project.tracks.filter((t) => t.kind === "video")).toHaveLength(1);
    const lastVideo = project.tracks.find((t) => t.kind === "video")!;
    expect(() => removeTrack(project, lastVideo.id)).toThrow(/last video/);
  });

  it("moveClipLayer down puts video under text on a new track", () => {
    let project = addMediaClip(withAsset(), "asset-1", { startTicks: 0 });
    project = addTextClip(project, { startTicks: 0 });
    const videoClip = project.clips.find((c) => c.kind === "media")!;
    const textClip = project.clips.find((c) => c.kind === "text")!;
    expect(videoClip.trackId).toBe(textClip.trackId);

    project = moveClipLayer(project, videoClip.id, "down");
    const videoAfter = project.clips.find((c) => c.id === videoClip.id)!;
    const textAfter = project.clips.find((c) => c.id === textClip.id)!;
    expect(videoAfter.trackId).not.toBe(textAfter.trackId);

    const videoTrack = project.tracks.find((t) => t.id === videoAfter.trackId)!;
    const textTrack = project.tracks.find((t) => t.id === textAfter.trackId)!;
    // Text stays higher in the timeline (lower order) → paints on top.
    expect(textTrack.order).toBeLessThan(videoTrack.order);
  });

  it("updates track flags and clip speed duration", () => {
    let project = addMediaClip(withAsset(), "asset-1");
    const trackId = project.clips[0].trackId;
    project = updateTrack(project, trackId, { muted: true, locked: true });
    expect(project.tracks.find((t) => t.id === trackId)?.muted).toBe(true);
    expect(project.tracks.find((t) => t.id === trackId)?.locked).toBe(true);

    project = updateTrack(project, trackId, { locked: false });
    const clipId = project.clips[0].id;
    expect(clipDurationTicks(project.clips[0])).toBe(10_000_000);
    project = updateClipSpeed(project, clipId, 2);
    expect(project.clips[0].speed).toBe(2);
    expect(clipDurationTicks(project.clips[0])).toBe(5_000_000);
  });

  it("applies speed only inside a Mark In/Out range", () => {
    let project = addMediaClip(withAsset(), "asset-1", { startTicks: 0 });
    const clipId = project.clips[0].id;
    // Slow-mo 0.5× from 2s..4s → middle becomes 4s long on the timeline
    const { project: next, midClipId } = applySpeedToRange(
      project,
      clipId,
      2_000_000,
      4_000_000,
      0.5,
    );
    project = next;
    expect(project.clips).toHaveLength(3);
    const ordered = [...project.clips].sort((a, b) => a.startTicks - b.startTicks);
    expect(ordered[0]!.startTicks).toBe(0);
    expect(clipDurationTicks(ordered[0]!)).toBe(2_000_000);
    const mid = ordered.find((c) => c.id === midClipId)!;
    expect(mid.speed).toBe(0.5);
    expect(clipDurationTicks(mid)).toBe(4_000_000);
    expect(mid.startTicks).toBe(2_000_000);
    const right = ordered[2]!;
    expect(right.startTicks).toBe(6_000_000);
    expect(right.sourceInTicks).toBe(4_000_000);
  });
});

describe("speed ramp commands", () => {
  function clipProject() {
    const project = addMediaClip(withAsset(), "asset-1", { startTicks: 0 });
    return { project, clipId: project.clips[0].id };
  }

  it("enableSpeedRamp seeds two points centered on the playhead", () => {
    const { project, clipId } = clipProject();
    // Clip is 10s; playhead at 5s → progress 0.5 → window ≈ [0.42, 0.58]
    const next = enableSpeedRamp(project, clipId, 5_000_000, 1, 2);
    const points = next.clips[0].speedRamp!.points;
    expect(points).toHaveLength(2);
    expect(points[0].atProgress).toBeCloseTo(0.42, 2);
    expect(points[0].speed).toBe(1);
    expect(points[1].atProgress).toBeCloseTo(0.58, 2);
    expect(points[1].speed).toBe(2);
  });

  it("seeds a 2-point ramp around the playhead when none exists", () => {
    const { project, clipId } = clipProject();
    const { project: withPoint } = addRampPointAtPlayhead(project, clipId, 5_000_000, 2);
    const points = withPoint.clips[0].speedRamp!.points;
    expect(points).toHaveLength(2);
    expect(points[1].speed).toBe(2);
  });

  it("creates an anchor at the playhead and lengthens the clip for slow-mo", () => {
    let { project, clipId } = clipProject();
    project = enableSpeedRamp(project, clipId, 5_000_000, 1, 2);
    project = addRampPointAtPlayhead(project, clipId, 5_000_000, 0.5).project;
    const clip = project.clips[0];
    expect(clip.speedRamp?.points).toHaveLength(3);

    const midId = clip.speedRamp!.points[1].id;
    project = setRampPointSpeed(project, clipId, midId, 0.5);
    const slow = project.clips[0];
    expect(clipDurationTicks(slow)).toBeGreaterThan(10_000_000);

    // Fast-forward shrinks the clip.
    const fast = setRampPointSpeed(project, clipId, midId, 4);
    expect(clipDurationTicks(fast.clips[0])).toBeLessThan(10_000_000);
  });

  it("moves any anchor, clamped between neighbors", () => {
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [
        createSpeedPoint(0.2, 1),
        createSpeedPoint(0.5, 1.5),
        createSpeedPoint(0.8, 2),
      ],
    });
    const midId = project.clips[0].speedRamp!.points[1].id;

    project = moveRampPoint(project, clipId, midId, 0.4);
    expect(project.clips[0].speedRamp!.points[1].atProgress).toBeCloseTo(0.4, 5);

    // First point can slide but not past its neighbor.
    const firstId = project.clips[0].speedRamp!.points[0].id;
    project = moveRampPoint(project, clipId, firstId, 0.3);
    expect(project.clips[0].speedRamp!.points[0].atProgress).toBeCloseTo(0.3, 5);
    project = moveRampPoint(project, clipId, firstId, 0.9);
    expect(project.clips[0].speedRamp!.points[0].atProgress).toBeLessThan(
      project.clips[0].speedRamp!.points[1].atProgress,
    );
  });

  it("clears the ramp when removing leaves fewer than 2 points", () => {
    let { project, clipId } = clipProject();
    project = enableSpeedRamp(project, clipId, 5_000_000, 1, 2);
    const firstId = project.clips[0].speedRamp!.points[0].id;
    project = removeRampPoint(project, clipId, firstId);
    expect(project.clips[0].speedRamp ?? null).toBeNull();
  });

  it("clears a ramp with setClipRamp(null)", () => {
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [createSpeedPoint(0, 1), createSpeedPoint(1, 2)],
    });
    expect(project.clips[0].speedRamp).not.toBeNull();
    project = setClipRamp(project, clipId, null);
    expect(project.clips[0].speedRamp ?? null).toBeNull();
    expect(clipDurationTicks(project.clips[0])).toBe(10_000_000);
  });

  it("splits a ramped clip and keeps the curve continuous", () => {
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [createSpeedPoint(0, 1), createSpeedPoint(0.5, 2), createSpeedPoint(1, 1)],
    });
    const total = clipDurationTicks(project.clips[0]);
    project = splitClipAt(project, clipId, Math.round(total / 2));
    expect(project.clips).toHaveLength(2);
    const [left, right] = [...project.clips].sort((a, b) => a.startTicks - b.startTicks);
    expect(left.speedRamp).not.toBeNull();
    expect(right.speedRamp).not.toBeNull();
    // Left ends near speed 2 (the mid anchor) and right resumes there.
    expect(left.speedRamp!.points[left.speedRamp!.points.length - 1].speed).toBeGreaterThan(1.5);
    expect(right.speedRamp!.points[0].speed).toBeGreaterThan(1.5);
    // Concatenated timeline durations roughly match the original.
    expect(clipDurationTicks(left) + clipDurationTicks(right)).toBeCloseTo(total, -4);
  });
});
