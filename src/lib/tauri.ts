import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toAppError, type AppError } from "./errors";
import type { ProjectDocument } from "../domain";

export interface AppInfo {
  name: string;
  version: string;
  offlineCapable: boolean;
}

export interface ProbeResult {
  path: string;
  available: boolean;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  message: string;
  kindHint: string;
}

export interface MediaAvailability {
  path: string;
  exists: boolean;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function probeMedia(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_media", { path });
}

export async function importMediaPaths(paths: string[]): Promise<ProbeResult[]> {
  return invoke<ProbeResult[]>("import_media_paths", { paths });
}

export async function checkMediaPaths(paths: string[]): Promise<MediaAvailability[]> {
  return invoke<MediaAvailability[]>("check_media_paths", { paths });
}

export async function openProjectFile(path: string): Promise<ProjectDocument> {
  return invoke<ProjectDocument>("open_project", { path });
}

export async function saveProjectFile(path: string, project: ProjectDocument): Promise<void> {
  await invoke("save_project", { path, project });
}

export async function autosaveProject(project: ProjectDocument): Promise<string> {
  return invoke<string>("autosave_project", { project });
}

export async function recoverAutosave(): Promise<ProjectDocument | null> {
  return invoke<ProjectDocument | null>("recover_autosave");
}

export async function pickOpenProjectPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Cutline Project", extensions: ["cutline.json", "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickSaveProjectPath(defaultName: string): Promise<string | null> {
  const selected = await save({
    defaultPath: `${defaultName}.cutline.json`,
    filters: [{ name: "Cutline Project", extensions: ["cutline.json", "json"] }],
  });
  return selected;
}

export async function pickMediaPaths(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: "Media",
        extensions: [
          "mp4",
          "mov",
          "mkv",
          "webm",
          "avi",
          "mp3",
          "wav",
          "aac",
          "m4a",
          "png",
          "jpg",
          "jpeg",
          "webp",
          "gif",
        ],
      },
    ],
  });
  if (selected == null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: AppError | null }> {
  try {
    const data = await invoke<T>(command, args);
    return { data, error: null };
  } catch (error) {
    return { data: null, error: toAppError(error) };
  }
}
