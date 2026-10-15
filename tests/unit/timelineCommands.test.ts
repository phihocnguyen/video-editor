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
  pruneEmptyTrack,
  relockClipDuration,
  removeRampPoint,
  removeTrack,
  setClipRamp,
  setRampPointSpeed,
  splitClipAt,
  trimClip,
  updateCanvas,
  updateClipSpeed,
  updateRampPoint,
  updateRampPointLocked,
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
  it("reuses an empty video track instead of creating V2", () => {
    const project = withAsset("video");
    const baseVideo = project.tracks.find((t) => t.kind === "video")!;
    const next = addMediaClip(project, "asset-1", { startTicks: 2_000_000 });
    expect(next.clips).toHaveLength(1);
    expect(next.clips[0].startTicks).toBe(2_000_000);
    expect(next.clips[0].sourceOutTicks).toBe(10_000_000);
    expect(next.clips[0].trackId).toBe(baseVideo.id);
    expect(next.tracks.filter((t) => t.kind === "video")).toHaveLength(1);
  });

  it("creates a new top track when V1 already has a clip", () => {
    let project = withAsset("video");
    const baseVideo = project.tracks.find((t) => t.kind === "video")!;
    project = addMediaClip(project, "asset-1", { trackId: baseVideo.id, startTicks: 0 });
    const next = addMediaClip(project, "asset-1", { startTicks: 10_000_000 });
    expect(next.clips).toHaveLength(2);
    const created = next.tracks.find((t) => t.id === next.clips[1].trackId)!;
    expect(created.kind).toBe("video");
    expect(created.id).not.toBe(baseVideo.id);
    expect(project.tracks.some((t) => t.id === created.id)).toBe(false);
    const baseAfter = next.tracks.find((t) => t.id === baseVideo.id)!;
    expect(created.order).toBeLessThan(baseAfter.order);
  });

  it("adds a media clip onto an explicit track without creating another", () => {
    const project = withAsset("video");
    const videoTrack = project.tracks.find((t) => t.kind === "video")!;
    const next = addMediaClip(project, "asset-1", {
      trackId: videoTrack.id,
      startTicks: 1_000_000,
    });
    expect(next.tracks.filter((t) => t.kind === "video")).toHaveLength(
      project.tracks.filter((t) => t.kind === "video").length,
    );
    expect(next.clips[0].trackId).toBe(videoTrack.id);
  });

  it("centres a new media clip transform", () => {
    const media = addMediaClip(withAsset(), "asset-1");
    expect(media.clips[0].transform.x).toBe(960);
    expect(media.clips[0].transform.y).toBe(540);

    const withText = addTextClip(media, { text: { content: "Hi" } });
    const textClip = withText.clips.find((c) => c.kind === "text")!;
    expect(textClip.text?.content).toBe("Hi");
  });

  it("places text on a new top track instead of sharing V1 with media", () => {
    let project = withAsset();
    const v1 = project.tracks.find((t) => t.kind === "video")!;
    project = addMediaClip(project, "asset-1", { trackId: v1.id, startTicks: 0 });
    project = addTextClip(project, { text: { content: "Title" } });
    const media = project.clips.find((c) => c.kind === "media")!;
    const text = project.clips.find((c) => c.kind === "text")!;
    expect(text.trackId).not.toBe(media.trackId);
    const textTrack = project.tracks.find((t) => t.id === text.trackId)!;
    const mediaTrack = project.tracks.find((t) => t.id === media.trackId)!;
    expect(textTrack.order).toBeLessThan(mediaTrack.order);
  });

  it("updates canvas settings", () => {
    let project = addTextClip(createEmptyProject());
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

  it("prunes empty tracks after moving a clip away", () => {
    let project = withAsset();
    const baseVideo = project.tracks.find((t) => t.kind === "video")!;
    // Overlapping add → new overlay track.
    project = addMediaClip(project, "asset-1", { trackId: baseVideo.id, startTicks: 0 });
    project = addMediaClip(project, "asset-1", { startTicks: 0 });
    const clipId = project.clips[1].id;
    const createdTrackId = project.clips[1].trackId;
    expect(createdTrackId).not.toBe(baseVideo.id);
    expect(project.tracks.filter((t) => t.kind === "video").length).toBeGreaterThan(1);

    project = moveClip(project, clipId, 12_000_000, baseVideo.id, {
      pruneEmptySource: true,
    });
    expect(project.clips.find((c) => c.id === clipId)?.trackId).toBe(baseVideo.id);
    expect(project.tracks.some((t) => t.id === createdTrackId)).toBe(false);
  });

  it("does not prune the last track of a kind", () => {
    const project = createEmptyProject();
    const video = project.tracks.find((t) => t.kind === "video")!;
    const same = pruneEmptyTrack(project, video.id);
    expect(same.tracks.some((t) => t.id === video.id)).toBe(true);
  });

  it("adds and removes tracks with safeguards", () => {
    let project = createEmptyProject();
    expect(project.tracks).toHaveLength(2);
    const v1 = project.tracks.find((t) => t.kind === "video")!;
    project = addTrack(project, "video");
    expect(project.tracks.filter((t) => t.kind === "video")).toHaveLength(2);
    const v2 = project.tracks.find((t) => t.name === "V2")!;
    const v1After = project.tracks.find((t) => t.id === v1.id)!;
    expect(v2.order).toBeLessThan(v1After.order);
    project = removeTrack(project, v2.id);
    expect(project.tracks.filter((t) => t.kind === "video")).toHaveLength(1);
    const lastVideo = project.tracks.find((t) => t.kind === "video")!;
    expect(() => removeTrack(project, lastVideo.id)).toThrow(/last video/);
  });

  it("moveClipLayer down puts video under text on a new track", () => {
    const base = withAsset();
    const v1 = base.tracks.find((t) => t.kind === "video")!;
    let project = addMediaClip(base, "asset-1", { trackId: v1.id, startTicks: 0 });
    project = addTextClip(project, { trackId: v1.id, startTicks: 0 });
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

  it("updateRampPoint moves and retunes an anchor in one pass", () => {
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [
        createSpeedPoint(0.2, 1),
        createSpeedPoint(0.5, 1.5),
        createSpeedPoint(0.8, 2),
      ],
    });
    const midId = project.clips[0].speedRamp!.points[1].id;

    project = updateRampPoint(project, clipId, midId, {
      atProgress: 0.6,
      speed: 3,
    });
    const points = project.clips[0].speedRamp!.points;
    expect(points[1].atProgress).toBeCloseTo(0.6, 5);
    expect(points[1].speed).toBe(3);

    // Same clamping as the single-purpose commands.
    project = updateRampPoint(project, clipId, midId, {
      atProgress: 0.99,
      speed: 99,
    });
    const clamped = project.clips[0].speedRamp!.points;
    expect(clamped[1].atProgress).toBeLessThan(clamped[2].atProgress);
    expect(clamped[1].speed).toBe(8);
  });

  it("relockClipDuration holds timeline duration by adjusting the source range", () => {
    let { project, clipId } = clipProject();
    const before = clipDurationTicks(project.clips[0]);
    expect(before).toBe(10_000_000);

    // Slow the tail: unconstrained, the clip would lengthen.
    project = enableSpeedRamp(project, clipId, 5_000_000, 1, 0.5);
    expect(clipDurationTicks(project.clips[0])).toBeGreaterThan(before);

    project = relockClipDuration(project, clipId, before);
    const clip = project.clips[0];
    expect(Math.abs(clipDurationTicks(clip) - before)).toBeLessThanOrEqual(1);
    // Same 10s on the timeline, but less source is consumed (start anchored).
    expect(clip.startTicks).toBe(0);
    expect(clip.sourceOutTicks - clip.sourceInTicks).toBeLessThan(10_000_000);
  });

  it("relockClipDuration caps extension at the media end", () => {
    let { project, clipId } = clipProject();
    const before = clipDurationTicks(project.clips[0]);
    // 2× everywhere already needs the full 10s of media; restoring 10s of
    // timeline is impossible, so the source range (and clip) stays put.
    project = enableSpeedRamp(project, clipId, 5_000_000, 2, 2);
    expect(clipDurationTicks(project.clips[0])).toBeLessThan(before);

    project = relockClipDuration(project, clipId, before);
    expect(project.clips[0].sourceOutTicks).toBe(10_000_000);
    expect(clipDurationTicks(project.clips[0])).toBeLessThan(before);
  });

  it("updateRampPointLocked never changes the timeline duration", () => {
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [
        createSpeedPoint(0.2, 1),
        createSpeedPoint(0.5, 1.5),
        createSpeedPoint(0.8, 1),
      ],
    });
    const locked = clipDurationTicks(project.clips[0]);
    const midId = project.clips[0].speedRamp!.points[1].id;

    // Slowing down fits: duration preserved, full patch applied.
    const slowed = updateRampPointLocked(project, clipId, midId, { speed: 0.5 }, locked);
    expect(slowed.constrained).toBe(false);
    expect(
      Math.abs(clipDurationTicks(slowed.project.clips[0]) - locked),
    ).toBeLessThanOrEqual(1);
    expect(
      slowed.project.clips[0].speedRamp!.points[1].speed,
    ).toBeCloseTo(0.5, 5);
  });

  it("updateRampPointLocked blocks the patch at the media wall", () => {
    // Trimmed clip: 8s of source used, 2s of headroom in the 10s asset.
    let { project, clipId } = clipProject();
    project = trimClip(project, clipId, 0, 8_000_000);
    project = setClipRamp(project, clipId, {
      points: [
        createSpeedPoint(0.2, 1),
        createSpeedPoint(0.5, 1.5),
        createSpeedPoint(0.8, 1),
      ],
    });
    const locked = clipDurationTicks(project.clips[0]);
    const midId = project.clips[0].speedRamp!.points[1].id;

    // 8× on the middle would need more source than the asset holds: the
    // point stops partway at the wall instead of shrinking the track.
    const pushed = updateRampPointLocked(project, clipId, midId, { speed: 8 }, locked);
    expect(pushed.constrained).toBe(true);
    expect(
      Math.abs(clipDurationTicks(pushed.project.clips[0]) - locked),
    ).toBeLessThanOrEqual(1);
    const after = pushed.project.clips[0];
    const speed = after.speedRamp!.points[1].speed;
    expect(speed).toBeGreaterThan(1.5);
    expect(speed).toBeLessThan(8);
    // Source extended into the headroom, never past the media end.
    const span = after.sourceOutTicks - after.sourceInTicks;
    expect(span).toBeGreaterThan(8_000_000);
    expect(span).toBeLessThanOrEqual(10_000_000);
  });

  it("updateRampPointLocked returns the identical project when fully blocked", () => {
    // Full-media clip: no headroom, so pushing faster is fully resisted.
    let { project, clipId } = clipProject();
    project = setClipRamp(project, clipId, {
      points: [
        createSpeedPoint(0.2, 1),
        createSpeedPoint(0.5, 1.5),
        createSpeedPoint(0.8, 1),
      ],
    });
    const locked = clipDurationTicks(project.clips[0]);
    const midId = project.clips[0].speedRamp!.points[1].id;
    const stuck = updateRampPointLocked(project, clipId, midId, { speed: 8 }, locked);
    expect(stuck.constrained).toBe(true);
    // Same reference → zustand skips notifying (no re-render storm).
    expect(stuck.project).toBe(project);
    expect(stuck.project.clips[0].speedRamp!.points[1].speed).toBe(1.5);
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
