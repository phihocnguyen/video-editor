import { describe, expect, it } from "vitest";
import { createEmptyProject, parseProjectJson, serializeProject, validateProject } from "../../src/domain";

describe("project validation", () => {
  it("accepts an empty project", () => {
    const project = createEmptyProject();
    const result = validateProject(project);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("round-trips through JSON", () => {
    const project = createEmptyProject("Demo");
    const again = parseProjectJson(serializeProject(project));
    expect(again.name).toBe("Demo");
    expect(again.tracks).toHaveLength(2);
  });

  it("rejects unknown schema versions", () => {
    const project = { ...createEmptyProject(), schemaVersion: 99 };
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "schemaVersion")).toBe(true);
  });

  it("rejects clips with inverted source range", () => {
    const project = createEmptyProject();
    const trackId = project.tracks[0].id;
    const invalid = {
      ...project,
      clips: [
        {
          id: "clip-1",
          trackId,
          assetId: null,
          kind: "text",
          startTicks: 0,
          sourceInTicks: 10,
          sourceOutTicks: 5,
          speed: 1,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
          volume: 1,
          text: null,
        },
      ],
    };
    const result = validateProject(invalid);
    expect(result.ok).toBe(false);
  });
});
