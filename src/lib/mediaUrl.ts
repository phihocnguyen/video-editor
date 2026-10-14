import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

/** Runtime-only object URLs for browser-imported files (not persisted). */
const browserObjectUrls = new Map<string, string>();

export function rememberBrowserObjectUrl(assetId: string, url: string) {
  const prev = browserObjectUrls.get(assetId);
  if (prev && prev !== url) URL.revokeObjectURL(prev);
  browserObjectUrls.set(assetId, url);
}

export function revokeBrowserObjectUrl(assetId: string) {
  const prev = browserObjectUrls.get(assetId);
  if (prev) {
    URL.revokeObjectURL(prev);
    browserObjectUrls.delete(assetId);
  }
}

export function resolveMediaUrl(path: string, assetId?: string): string | null {
  if (!path) return null;
  if (path.startsWith("blob:") || path.startsWith("http:") || path.startsWith("https:")) {
    return path;
  }
  if (assetId) {
    const remembered = browserObjectUrls.get(assetId);
    if (remembered) return remembered;
  }
  if (isTauriRuntime()) {
    try {
      return convertFileSrc(path);
    } catch {
      return null;
    }
  }
  return null;
}

export function canShowThumbnail(kind: string, path: string, assetId?: string): boolean {
  if (kind === "image") return Boolean(resolveMediaUrl(path, assetId));
  if (kind === "video") return Boolean(resolveMediaUrl(path, assetId));
  return false;
}
