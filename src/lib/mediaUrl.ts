import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

/**
 * Runtime-only object URLs for browser-imported files (not persisted).
 * Kept on globalThis so a hot reload does not drop the media-bin posters.
 */
const browserObjectUrls: Map<string, string> =
  ((globalThis as { __klipcutBlobUrls?: Map<string, string> }).__klipcutBlobUrls ??=
    new Map());

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

/**
 * Which local helper can stream cache files. 1421 is the export helper; a
 * long-running process may predate the media route, so posters fall back to 1423.
 */
const mediaPortBox = ((globalThis as { __klipcutMediaPort?: { port: number } })
  .__klipcutMediaPort ??= { port: 1421 });

/** Browser preview of files the export helper cached on disk. */
function cacheMediaUrl(path: string): string | null {
  if (isTauriRuntime()) return null;
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.includes("/.klipcut-cache/")) return null;
  return `http://127.0.0.1:${mediaPortBox.port}/api/media-file?v=2&path=${encodeURIComponent(path)}`;
}

function switchToFallbackMediaPort(): void {
  if (mediaPortBox.port === 1423) return;
  mediaPortBox.port = 1423;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("klipcut-media-port"));
  }
}

/** Swap a failed 1421 poster URL onto the fallback helper. */
export function mediaFileFallbackUrl(url: string): string | null {
  if (!url.includes("127.0.0.1:1421/api/media-file")) return null;
  switchToFallbackMediaPort();
  return url.replace("127.0.0.1:1421/api/media-file", "127.0.0.1:1423/api/media-file");
}

if (typeof window !== "undefined" && !isTauriRuntime() && mediaPortBox.port === 1421) {
  void fetch("http://127.0.0.1:1421/api/media-ready")
    .then((res) => {
      if (!res.ok) switchToFallbackMediaPort();
    })
    .catch(() => switchToFallbackMediaPort());
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
  return cacheMediaUrl(path);
}

/**
 * URL for an audio clip's waveform and preview.
 * A soundtrack split out of a video often lives only as a cache file. While
 * the original video blob is still in memory, decode and play that instead.
 */
export function resolveAudioPreviewUrl(
  asset: { id: string; kind: string; path: string },
  linkedVideo?: { id: string; path: string } | null,
): string | null {
  const direct = resolveMediaUrl(asset.path, asset.id);
  if (asset.kind !== "audio") return direct;
  if (direct?.startsWith("blob:")) return direct;
  const fromVideo = linkedVideo ? resolveMediaUrl(linkedVideo.path, linkedVideo.id) : null;
  if (fromVideo?.startsWith("blob:")) return fromVideo;
  return direct;
}

export function canShowThumbnail(kind: string, path: string, assetId?: string): boolean {
  if (kind === "image") return Boolean(resolveMediaUrl(path, assetId));
  if (kind === "video") return Boolean(resolveMediaUrl(path, assetId));
  return false;
}
