import { assertProject } from "./validate";
import type { ProjectDocument } from "./project";

export function serializeProject(project: ProjectDocument): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function parseProjectJson(text: string): ProjectDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON project file");
  }
  return assertProject(parsed);
}
