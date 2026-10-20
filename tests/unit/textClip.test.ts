import { describe, expect, it } from "vitest";
import { addTextClip, createEmptyProject, updateClipText } from "../../src/domain";

describe("text clips", () => {
  it("adds a text clip onto an empty video track", () => {
    const project = createEmptyProject();
    const v1 = project.tracks.find((t) => t.kind === "video")!;
    const next = addTextClip(project, {
      startTicks: 1_000_000,
      text: { content: "Hello" },
    });
    expect(next.clips).toHaveLength(1);
    expect(next.clips[0].kind).toBe("text");
    expect(next.clips[0].trackId).toBe(v1.id);
    expect(next.clips[0].text?.content).toBe("Hello");
    expect(next.clips[0].text?.fontPath).toBeNull();
  });

  it("updates text style", () => {
    let project = addTextClip(createEmptyProject());
    const clipId = project.clips[0].id;
    const text = {
      ...project.clips[0].text!,
      content: "Updated",
      fontFamily: "Arial",
      fontSize: 72,
    };
    project = updateClipText(project, clipId, text);
    expect(project.clips[0].text?.content).toBe("Updated");
    expect(project.clips[0].text?.fontSize).toBe(72);
  });

  it("supports custom transform blendMode when adding text", () => {
    const project = addTextClip(createEmptyProject(), {
      text: { content: "GOODBYE" },
      transform: { blendMode: "screen" },
    });
    expect(project.clips[0].transform.blendMode).toBe("screen");
  });
});
