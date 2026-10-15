import {
  parseProjectJson,
  secondsToTicks,
  serializeProject,
  type MediaAsset,
  type MediaKind,
  type ProjectDocument,
} from "../domain";
import { toAppError } from "./errors";
import {
  checkMediaPaths,
  deleteLibraryProject,
  importMediaIntoProject,
  importMediaPaths,
  isLibraryProjectPath,
  isTauriRuntime,
  listLibraryProjects,
  openProjectFile,
  pickMediaPaths,
  pickOpenProjectPath,
  pickSaveProjectPath,
  recoverAutosave,
  saveLibraryProject,
  saveProjectFile,
  type LibraryProjectInfo,
  type ProbeResult,
} from "./tauri";

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function kindFromProbe(probe: ProbeResult): MediaKind {
  if (probe.kindHint === "audio" || probe.kindHint === "image" || probe.kindHint === "video") {
    return probe.kindHint;
  }
  return "video";
}

export function assetFromProbe(probe: ProbeResult): MediaAsset {
  return {
    id: crypto.randomUUID(),
    kind: kindFromProbe(probe),
    path: probe.path,
    name: fileName(probe.path),
    durationTicks:
      probe.durationSeconds != null ? secondsToTicks(probe.durationSeconds) : null,
    width: probe.width,
    height: probe.height,
    frameRate: null,
    hasAudio: kindFromProbe(probe) !== "image",
    missing: !probe.available,
  };
}

export async function actionOpenProjectAtPath(
  path: string,
): Promise<{ project: ProjectDocument; path: string }> {
  if (!isTauriRuntime()) {
    throw new Error("Open by path requires the desktop app");
  }
  const project = await openProjectFile(path);
  return { project, path };
}

export async function actionOpenProject(): Promise<{
  project: ProjectDocument;
  path: string | null;
}> {
  if (!isTauriRuntime()) {
    const text = await pickBrowserTextFile();
    return { project: parseProjectJson(text), path: null };
  }

  const path = await pickOpenProjectPath();
  if (!path) {
    throw new Error("Open cancelled");
  }
  const project = await openProjectFile(path);
  return { project, path };
}

export async function actionSaveProject(
  project: ProjectDocument,
  currentPath: string | null,
  options?: { saveAs?: boolean },
): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadBrowserText(`${project.name || "project"}.cutline.json`, serializeProject(project));
    return currentPath;
  }

  const stamped = { ...project, updatedAt: new Date().toISOString() };

  if (options?.saveAs) {
    const path = await pickSaveProjectPath(project.name || "Untitled project");
    if (!path) throw new Error("Save cancelled");
    await saveProjectFile(path, stamped);
    try {
      await saveLibraryProject(stamped);
    } catch {
      /* non-fatal */
    }
    return path;
  }

  // Prefer the AppData library draft when no external path is set.
  if (!currentPath) {
    return saveLibraryProject(stamped);
  }

  await saveProjectFile(currentPath, stamped);
  // Keep the library draft in sync when editing an external copy.
  try {
    await saveLibraryProject(stamped);
  } catch {
    /* non-fatal */
  }
  return currentPath;
}

/** Create/update the AppData draft folder for a project; returns its path. */
export async function actionEnsureLibraryProject(
  project: ProjectDocument,
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const stamped = {
    ...project,
    updatedAt: project.updatedAt || new Date().toISOString(),
  };
  return saveLibraryProject(stamped);
}

export async function actionListLibraryProjects(): Promise<LibraryProjectInfo[]> {
  if (!isTauriRuntime()) return [];
  return listLibraryProjects();
}

/** Delete a local library draft (folder + media). Falls back to path→id when needed. */
export async function actionDeleteLibraryProject(options: {
  projectId?: string | null;
  path?: string | null;
  name?: string | null;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Delete project requires the desktop app");
  }
  const label = options.name?.trim() || "this project";
  if (
    !window.confirm(
      `Delete “${label}”?\n\nThis permanently removes the draft and copied media from this PC. Original source files are not touched.`,
    )
  ) {
    throw new Error("Delete cancelled");
  }

  let id = options.projectId?.trim() || "";
  if (!id && options.path) {
    // …/projects/<id>/project.cutline.json
    const parts = options.path.split(/[/\\]/).filter(Boolean);
    const fileIdx = parts.findIndex((p) => p === "project.cutline.json");
    if (fileIdx > 0) id = parts[fileIdx - 1]!;
  }
  if (!id) {
    throw new Error("Cannot resolve project id to delete");
  }

  await deleteLibraryProject(id);
}

export async function actionIsLibraryProjectPath(path: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return isLibraryProjectPath(path);
}

export async function actionImportMedia(projectId?: string): Promise<MediaAsset[]> {
  if (!isTauriRuntime()) {
    return pickBrowserMediaFiles();
  }
  const paths = await pickMediaPaths();
  if (paths.length === 0) {
    return [];
  }
  if (projectId) {
    const probed = await importMediaIntoProject(projectId, paths);
    return probed.map(assetFromProbe);
  }
  const probed = await importMediaPaths(paths);
  return probed.map(assetFromProbe);
}

export async function actionRelinkAsset(
  asset: MediaAsset,
  projectId?: string,
): Promise<MediaAsset> {
  if (!isTauriRuntime()) {
    throw new Error("Relink requires the desktop app (pnpm tauri:dev)");
  }
  const paths = await pickMediaPaths();
  if (paths.length !== 1) {
    throw new Error("Pick exactly one replacement file");
  }
  const [path] = paths;
  if (
    !window.confirm(
      `Relink "${asset.name}" to:\n${path}\n\nA copy will be stored in the project library; the original stays untouched.`,
    )
  ) {
    throw new Error("Relink cancelled");
  }
  const probed = projectId
    ? await importMediaIntoProject(projectId, [path])
    : await importMediaPaths([path]);
  const next = assetFromProbe(probed[0]);
  return {
    ...asset,
    path: next.path,
    name: next.name,
    durationTicks: next.durationTicks ?? asset.durationTicks,
    width: next.width ?? asset.width,
    height: next.height ?? asset.height,
    hasAudio: next.hasAudio,
    missing: next.missing,
    kind: next.kind,
  };
}

export async function actionRefreshMissing(project: ProjectDocument): Promise<ProjectDocument> {
  if (!isTauriRuntime() || project.assets.length === 0) {
    return project;
  }
  const availability = await checkMediaPaths(project.assets.map((a) => a.path));
  const byPath = new Map(availability.map((a) => [a.path, a.exists]));
  return {
    ...project,
    assets: project.assets.map((asset) => ({
      ...asset,
      missing: !(byPath.get(asset.path) ?? false),
    })),
  };
}

/** Debounced draft write to AppData projects/<id>/ (+ recovery copy). */
export async function actionAutosave(project: ProjectDocument): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const stamped = { ...project, updatedAt: new Date().toISOString() };
  return saveLibraryProject(stamped);
}

export async function actionRecoverAutosave(): Promise<ProjectDocument | null> {
  if (!isTauriRuntime()) return null;
  return recoverAutosave();
}

export function formatActionError(error: unknown): string {
  return toAppError(error).message;
}

async function pickBrowserTextFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.cutline.json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("Open cancelled"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    };
    input.click();
  });
}

function downloadBrowserText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function pickBrowserMediaFiles(): Promise<MediaAsset[]> {
  const { rememberBrowserObjectUrl } = await import("./mediaUrl");
  const { localExportHealth, localImportFile } = await import("./localExport");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*,image/*";
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve([]);
        return;
      }
      try {
        const helper = await localExportHealth();
        const assets: MediaAsset[] = [];
        for (const file of files) {
          const id = crypto.randomUUID();
          const url = URL.createObjectURL(file);
          rememberBrowserObjectUrl(id, url);
          const kind: MediaKind = file.type.startsWith("audio/")
            ? "audio"
            : file.type.startsWith("image/")
              ? "image"
              : "video";
          let durationTicks: number | null = null;
          let width: number | null = null;
          let height: number | null = null;
          if (kind === "video" || kind === "audio") {
            const meta = await probeBrowserMedia(url, kind);
            durationTicks = meta.durationTicks;
            width = meta.width;
            height = meta.height;
          } else if (kind === "image") {
            const size = await probeBrowserImage(url);
            width = size.width;
            height = size.height;
            durationTicks = 5_000_000;
          }
          let path = url;
          if (helper.ok) {
            try {
              const cached = await localImportFile(file);
              path = cached.path;
            } catch {
              /* keep blob preview; export will warn */
            }
          }
          assets.push({
            id,
            kind,
            path,
            name: file.name,
            durationTicks,
            width,
            height,
            frameRate: null,
            hasAudio:
              kind === "audio"
                ? true
                : kind === "video"
                  ? await detectBrowserVideoHasAudio(url)
                  : false,
            missing: false,
          });
        }
        resolve(assets);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

function probeBrowserMedia(
  url: string,
  kind: "video" | "audio",
): Promise<{ durationTicks: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.src = url;
    el.onloadedmetadata = () => {
      resolve({
        durationTicks: Number.isFinite(el.duration)
          ? Math.round(el.duration * 1_000_000)
          : null,
        width: kind === "video" ? (el as HTMLVideoElement).videoWidth || null : null,
        height: kind === "video" ? (el as HTMLVideoElement).videoHeight || null : null,
      });
    };
    el.onerror = () => resolve({ durationTicks: null, width: null, height: null });
  });
}

/** Best-effort; export path also probes with ffprobe before building the filter graph. */
function detectBrowserVideoHasAudio(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    const finish = (value: boolean) => {
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    video.onloadedmetadata = () => {
      const anyVideo = video as HTMLVideoElement & {
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
        audioTracks?: { length: number };
      };
      if (typeof anyVideo.mozHasAudio === "boolean") {
        finish(anyVideo.mozHasAudio);
        return;
      }
      if (anyVideo.audioTracks && typeof anyVideo.audioTracks.length === "number") {
        finish(anyVideo.audioTracks.length > 0);
        return;
      }
      // Unknown — assume no audio so silent clips don't break FFmpeg; ffprobe corrects at export.
      finish(false);
    };
    video.onerror = () => finish(false);
  });
}

function probeBrowserImage(
  url: string,
): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = url;
  });
}
