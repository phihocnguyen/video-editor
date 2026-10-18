import {
  detachVideoAudio,
  unlinkClip,
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
  extractAudioTrack,
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
  const project = await prepareDetachedAudio(await openProjectFile(path));
  return { project, path };
}

export async function actionOpenProject(): Promise<{
  project: ProjectDocument;
  path: string | null;
}> {
  if (!isTauriRuntime()) {
    const text = await pickBrowserTextFile();
    return { project: await prepareDetachedAudio(parseProjectJson(text)), path: null };
  }

  const path = await pickOpenProjectPath();
  if (!path) {
    throw new Error("Open cancelled");
  }
  const project = await prepareDetachedAudio(await openProjectFile(path));
  return { project, path };
}

export async function actionSaveProject(
  project: ProjectDocument,
  currentPath: string | null,
  options?: { saveAs?: boolean },
): Promise<string | null> {
  if (!isTauriRuntime()) {
    downloadBrowserText(`${project.name || "project"}.klipcut.json`, serializeProject(project));
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
  /** Skip the native confirm — the caller already confirmed via custom UI. */
  skipConfirm?: boolean;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Delete project requires the desktop app");
  }
  const label = options.name?.trim() || "this project";
  if (
    !options.skipConfirm &&
    !window.confirm(
      `Delete “${label}”?\n\nThis permanently removes the draft and copied media from this PC. Original source files are not touched.`,
    )
  ) {
    throw new Error("Delete cancelled");
  }

  let id = options.projectId?.trim() || "";
  if (!id && options.path) {
    // …/projects/<id>/project.klipcut.json
    const parts = options.path.split(/[/\\]/).filter(Boolean);
    const fileIdx = parts.findIndex(
      (p) => p === "project.klipcut.json" || p === "project.cutline.json",
    );
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
    return attachExtractedAudio(probed.map(assetFromProbe));
  }
  const probed = await importMediaPaths(paths);
  return attachExtractedAudio(probed.map(assetFromProbe));
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
  const project = await recoverAutosave();
  if (!project) return null;
  return prepareDetachedAudio(project);
}

async function probeExtract(path: string): Promise<{ hasAudio: boolean; path: string | null } | null> {
  if (!path || path.startsWith("blob:")) return null;
  try {
    if (isTauriRuntime()) return await extractAudioTrack(path);
    const { localExportHealth, localExtractAudio } = await import("./localExport");
    const helper = await localExportHealth();
    if (!helper.ok) return null;
    return await localExtractAudio(path);
  } catch {
    return null;
  }
}

function audioAssetFromVideo(video: MediaAsset, id: string, path: string): MediaAsset {
  const stem = video.name.replace(/\.[^.]+$/, "");
  return {
    id,
    kind: "audio",
    path,
    name: `${stem} audio`,
    durationTicks: video.durationTicks,
    width: null,
    height: null,
    frameRate: null,
    hasAudio: true,
    missing: false,
  };
}

/** Probe + extract soundtracks and remember them on the video assets. */
export async function attachExtractedAudio(assets: MediaAsset[]): Promise<MediaAsset[]> {
  const next = [...assets];
  for (let i = 0; i < next.length; i += 1) {
    const asset = next[i]!;
    if (asset.kind !== "video" || asset.missing || asset.extractedAudioAssetId) continue;
    const extracted = await probeExtract(asset.path);
    if (!extracted) continue;
    if (!extracted.hasAudio || !extracted.path) {
      next[i] = { ...asset, hasAudio: false };
      continue;
    }
    const audioId = crypto.randomUUID();
    next[i] = { ...asset, hasAudio: true, extractedAudioAssetId: audioId };
    next.push(audioAssetFromVideo(asset, audioId, extracted.path));
  }
  return next;
}

/**
 * Right-click "Separate audio": pull the soundtrack onto its own track.
 * Uses the export helper when the video is still only a browser blob.
 */
export async function separateVideoSoundtrack(
  project: ProjectDocument,
  clipId: string,
): Promise<ProjectDocument> {
  const clip = project.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== "media" || !clip.assetId) {
    throw new Error("Select a video clip");
  }
  if (clip.linkedClipId && project.clips.some((item) => item.id === clip.linkedClipId)) {
    throw new Error("Audio is already on its own track");
  }
  let video = project.assets.find((asset) => asset.id === clip.assetId);
  if (!video || video.kind !== "video") throw new Error("Select a video clip");

  let assets = project.assets;
  let helperAvailable = isTauriRuntime();
  if (!helperAvailable) {
    const { localExportHealth } = await import("./localExport");
    const helper = await localExportHealth();
    helperAvailable = helper.ok && helper.ffmpegFound;
  }

  if (helperAvailable && video.path.startsWith("blob:")) {
    try {
      const { localImportFile } = await import("./localExport");
      const response = await fetch(video.path);
      const blob = await response.blob();
      const file = new File([blob], video.name || "video.mp4", {
        type: blob.type || "video/mp4",
      });
      const cached = await localImportFile(file);
      video = { ...video, path: cached.path };
      assets = assets.map((asset) => (asset.id === video!.id ? video! : asset));
    } catch {
      helperAvailable = false;
    }
  }

  if (helperAvailable && !video.extractedAudioAssetId) {
    try {
      assets = await attachExtractedAudio(assets);
      video = assets.find((asset) => asset.id === video!.id) ?? video;
    } catch {
      helperAvailable = false;
    }
  }

  let audioId = video.extractedAudioAssetId ?? null;
  const extracted = audioId
    ? assets.find((asset) => asset.id === audioId && asset.kind === "audio")
    : null;
  if (!extracted) {
    if (helperAvailable && video.hasAudio === false) {
      throw new Error("This video has no soundtrack to separate");
    }
    // No FFmpeg file yet. The soundtrack clip points at the same media so
    // preview can play it, and deleting the video leaves this clip behind.
    audioId = crypto.randomUUID();
    video = { ...video, hasAudio: true, extractedAudioAssetId: audioId };
    assets = [
      ...assets.map((asset) => (asset.id === video!.id ? video! : asset)),
      audioAssetFromVideo(video, audioId, video.path),
    ];
  }

  // Independent clip: deleting or moving the video must leave the soundtrack.
  return unlinkClip(detachVideoAudio({ ...project, assets }, clip.id, audioId!), clip.id);
}

/**
 * On open, detach soundtracks for video clips that still play embedded audio.
 * Skips clips that are already linked or suppressed. If ffmpeg is unavailable,
 * the project is left unchanged.
 */
export async function prepareDetachedAudio(project: ProjectDocument): Promise<ProjectDocument> {
  const assets = await attachExtractedAudio(project.assets);
  let next: ProjectDocument = { ...project, assets };
  const pending = next.clips
    .filter(
      (clip) =>
        clip.kind === "media" &&
        !clip.suppressEmbeddedAudio &&
        !clip.linkedClipId &&
        clip.assetId,
    )
    .map((clip) => clip.id);
  for (const clipId of pending) {
    const clip = next.clips.find((c) => c.id === clipId);
    const video = clip?.assetId ? next.assets.find((a) => a.id === clip.assetId) : null;
    const audioId = video?.extractedAudioAssetId;
    if (!audioId || !next.assets.some((a) => a.id === audioId && a.kind === "audio")) continue;
    next = detachVideoAudio(next, clipId, audioId);
  }
  return next;
}

export function formatActionError(error: unknown): string {
  return toAppError(error).message;
}

async function pickBrowserTextFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.klipcut.json,.cutline.json,application/json";
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

const AUDIO_EXT = new Set(["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv"]);

/** Explorer drags often have an empty MIME type, so the extension decides. */
export function mediaKindFromFile(file: File): MediaKind | null {
  const type = file.type;
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

const IN_APP_ASSET_DRAG = "text/klipcut-asset";

/** Card drag from the media bin. Folder drops leave this null. */
let assetDrag: { assetId: string; placed: boolean } | null = null;

export function beginInAppAssetDrag(assetId: string): void {
  assetDrag = { assetId, placed: false };
}

export function endInAppAssetDrag(): void {
  assetDrag = null;
}

export function isInAppAssetDrag(): boolean {
  return assetDrag != null;
}

/**
 * Asset to place for this drop. A bin-card drag places once, same as Add.
 * A second drop in that same drag returns null so it cannot add again.
 */
export function claimInAppAssetDrop(data: DataTransfer | null): string | null {
  const fromEvent = data?.getData(IN_APP_ASSET_DRAG) ?? "";
  const assetId = fromEvent || assetDrag?.assetId || "";
  if (!assetId) return null;
  if (assetDrag?.placed) return null;
  if (assetDrag) assetDrag.placed = true;
  return assetId;
}

/** True for an Explorer/Finder file drag. False while a media-bin card is dragging. */
export function isOsFileDrag(data: DataTransfer | null): boolean {
  if (assetDrag) return false;
  if (!data) return false;
  const types = Array.from(data.types);
  // A bin-card drag can also carry the thumbnail as a File. That is not an import.
  if (types.includes(IN_APP_ASSET_DRAG)) return false;
  return types.includes("Files");
}

/** Files dragged in from the OS. Empty when the drag is an in-app asset card. */
export function filesFromOsDrop(data: DataTransfer | null): File[] {
  if (!isOsFileDrag(data) || !data) return [];
  return Array.from(data.files);
}

async function importBrowserFiles(files: File[]): Promise<MediaAsset[]> {
  const accepted = files.filter((file) => mediaKindFromFile(file) != null);
  if (accepted.length === 0) return [];
  const { rememberBrowserObjectUrl } = await import("./mediaUrl");
  const { localExportHealth, localImportFile } = await import("./localExport");
  const helper = await localExportHealth();
  const assets: MediaAsset[] = [];
  for (const file of accepted) {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    rememberBrowserObjectUrl(id, url);
    const kind = mediaKindFromFile(file)!;
    let durationTicks: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (kind === "video" || kind === "audio") {
      const meta = await probeBrowserMedia(url, kind);
      durationTicks = meta.durationTicks;
      width = meta.width;
      height = meta.height;
    } else {
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
        kind === "audio" ? true : kind === "video" ? await detectBrowserVideoHasAudio(url) : false,
      missing: false,
    });
  }
  return attachExtractedAudio(assets);
}

async function pickBrowserMediaFiles(): Promise<MediaAsset[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*,image/*";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve([]);
        return;
      }
      importBrowserFiles(files).then(resolve, reject);
    };
    input.click();
  });
}

/** Import files dragged in from a folder. Same result as the Import button. */
export async function actionImportDroppedFiles(files: File[]): Promise<MediaAsset[]> {
  return importBrowserFiles(files);
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

/**
 * Best-effort; export path also probes with ffprobe before building the filter graph.
 *
 * Chrome exposes neither `mozHasAudio` nor `audioTracks`, so metadata alone
 * always reports "no audio" there (the classic "imported video plays silent"
 * bug). `webkitAudioDecodedByteCount` only populates after frames decode, so
 * play muted briefly (autoplay-allowed) and re-check before concluding.
 */
function detectBrowserVideoHasAudio(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    let done = false;
    const anyVideo = video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: { length: number };
    };
    const staticTracks = (): boolean | null => {
      if (typeof anyVideo.mozHasAudio === "boolean") return anyVideo.mozHasAudio;
      if (anyVideo.audioTracks && typeof anyVideo.audioTracks.length === "number") {
        return anyVideo.audioTracks.length > 0;
      }
      if (
        typeof anyVideo.webkitAudioDecodedByteCount === "number" &&
        anyVideo.webkitAudioDecodedByteCount > 0
      ) {
        return true;
      }
      return null;
    };
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    const onProgress = () => {
      if (staticTracks() === true) finish(true);
    };
    video.onloadedmetadata = () => {
      if (staticTracks() === true) {
        finish(true);
        return;
      }
      video.addEventListener("timeupdate", onProgress);
      try {
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => undefined);
      } catch {
        /* ignore */
      }
      // Give the decoder ~2s to report audio bytes, then conclude silent.
      window.setTimeout(() => finish(false), 2000);
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
