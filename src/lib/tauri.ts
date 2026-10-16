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

export interface ThumbnailResult {
  path: string;
  cached: boolean;
}

export async function extractAudioTrack(
  path: string,
): Promise<{ hasAudio: boolean; path: string | null }> {
  return invoke<{ hasAudio: boolean; path: string | null }>("extract_audio_track", { path });
}

export async function generateThumbnail(
  path: string,
  timeSec = 0.5,
): Promise<ThumbnailResult> {
  return invoke<ThumbnailResult>("generate_thumbnail", { path, timeSec });
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

export interface LibraryProjectInfo {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
}

/** Write/create AppData draft at projects/<id>/project.klipcut.json. Older drafts used project.cutline.json. */
export async function saveLibraryProject(project: ProjectDocument): Promise<string> {
  return invoke<string>("save_library_project", { project });
}

export async function listLibraryProjects(): Promise<LibraryProjectInfo[]> {
  return invoke<LibraryProjectInfo[]>("list_library_projects");
}

/** Copy files into the project media folder, then probe the copies. */
export async function importMediaIntoProject(
  projectId: string,
  paths: string[],
): Promise<ProbeResult[]> {
  return invoke<ProbeResult[]>("import_media_into_project", { projectId, paths });
}

export async function isLibraryProjectPath(path: string): Promise<boolean> {
  return invoke<boolean>("is_library_project_path", { path });
}

/** Delete AppData projects/<id>/ (draft JSON + media copies). */
export async function deleteLibraryProject(projectId: string): Promise<void> {
  await invoke("delete_library_project", { projectId });
}

export async function pickOpenProjectPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "KlipCut Project", extensions: ["klipcut.json", "cutline.json", "json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickSaveProjectPath(defaultName: string): Promise<string | null> {
  const selected = await save({
    defaultPath: `${defaultName}.klipcut.json`,
    filters: [{ name: "KlipCut Project", extensions: ["klipcut.json", "json"] }],
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

export type ExportJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ExportJobStatus {
  id: string;
  state: ExportJobState;
  progress: number;
  message: string;
  outputPath: string | null;
}

export async function startExport(
  plan: unknown,
  outputPath: string,
): Promise<ExportJobStatus> {
  return invoke<ExportJobStatus>("start_export", { plan, outputPath });
}

export async function getExportStatus(): Promise<ExportJobStatus | null> {
  return invoke<ExportJobStatus | null>("get_export_status");
}

export async function cancelExport(): Promise<ExportJobStatus> {
  return invoke<ExportJobStatus>("cancel_export");
}

export async function pickExportOutputPath(defaultName: string): Promise<string | null> {
  const selected = await save({
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
  });
  return selected;
}

export interface ToolchainStatus {
  ffmpeg: string;
  ffmpegOk: boolean;
  ffprobe: string;
  ffprobeOk: boolean;
  bundled: boolean;
}

/** Resolved FFmpeg/ffprobe binaries (bundled sidecar preferred). */
export async function ffmpegStatus(): Promise<ToolchainStatus> {
  return invoke<ToolchainStatus>("ffmpeg_status");
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
