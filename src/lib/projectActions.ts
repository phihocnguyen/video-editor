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
  autosaveProject,
  checkMediaPaths,
  importMediaPaths,
  isTauriRuntime,
  openProjectFile,
  pickMediaPaths,
  pickOpenProjectPath,
  pickSaveProjectPath,
  recoverAutosave,
  saveProjectFile,
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
): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadBrowserText(`${project.name || "project"}.cutline.json`, serializeProject(project));
    return currentPath;
  }

  const path = currentPath ?? (await pickSaveProjectPath(project.name || "Untitled project"));
  if (!path) {
    throw new Error("Save cancelled");
  }
  const stamped = { ...project, updatedAt: new Date().toISOString() };
  await saveProjectFile(path, stamped);
  return path;
}

export async function actionImportMedia(): Promise<MediaAsset[]> {
  if (!isTauriRuntime()) {
    return pickBrowserMediaFiles();
  }
  const paths = await pickMediaPaths();
  if (paths.length === 0) {
    return [];
  }
  const probed = await importMediaPaths(paths);
  return probed.map(assetFromProbe);
}

export async function actionRelinkAsset(asset: MediaAsset): Promise<MediaAsset> {
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
      `Relink "${asset.name}" to:\n${path}\n\nOriginal file will not be modified.`,
    )
  ) {
    throw new Error("Relink cancelled");
  }
  const probed = await importMediaPaths([path]);
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

export async function actionAutosave(project: ProjectDocument): Promise<void> {
  if (!isTauriRuntime()) return;
  await autosaveProject({ ...project, updatedAt: new Date().toISOString() });
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
          assets.push({
            id,
            kind,
            path: url,
            name: file.name,
            durationTicks,
            width,
            height,
            frameRate: null,
            hasAudio: kind !== "image",
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
