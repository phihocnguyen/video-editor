import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  deleteClips,
  moveClip,
  splitClipAt,
  trimClip,
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
});
