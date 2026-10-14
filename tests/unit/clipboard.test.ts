import { describe, expect, it } from "vitest";
import {
  addMediaClip,
  createEmptyProject,
  pasteClips,
  snapshotClipsForClipboard,
  type MediaAsset,
} from "../../src/domain";

function asset(id: string, path: string): MediaAsset {
  return {
    id,
    kind: "video",
    path,
    name: path,
    durationTicks: 5_000_000,
    width: 1920,
    height: 1080,
    frameRate: 30,
    hasAudio: true,
    missing: false,
  };
}

describe("clip clipboard", () => {
  it("pastes at playhead preserving relative start", () => {
    let project = createEmptyProject("t");
    project = { ...project, assets: [asset("a1", "a.mp4"), asset("a2", "b.mp4")] };
    project = addMediaClip(project, "a1", { startTicks: 1_000_000 });
    project = addMediaClip(project, "a2", { startTicks: 3_000_000 });
    const ids = project.clips.map((c) => c.id);
    const snaps = snapshotClipsForClipboard(project, ids);
    expect(snaps).toHaveLength(2);

    const { project: next, newIds } = pasteClips(project, snaps, 10_000_000);
    expect(newIds).toHaveLength(2);
    const pasted = next.clips.filter((c) => newIds.includes(c.id));
    expect(pasted.map((c) => c.startTicks).sort((a, b) => a - b)).toEqual([
      10_000_000,
      12_000_000,
    ]);
  });
});
