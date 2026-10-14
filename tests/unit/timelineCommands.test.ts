import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  addTrack,
  applySpeedToRange,
  clipDurationTicks,
  deleteClips,
  moveClip,
  removeTrack,
  splitClipAt,
  trimClip,
  updateClipSpeed,
  updateTrack,
} from "../../src/domain/timelineCommands";
import { createEmptyProject, type MediaAsset } from "../../src/domain";

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
