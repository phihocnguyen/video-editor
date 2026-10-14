/**
 * Shared HTMLVideoElement pool — warm on media-bin import, reuse for preview.
 * One element per URL stays decoded so Play after "Add to timeline" is instant.
 */

function createVideo(url: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  video.load();
  const kick = () => {
    try {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(0.04, video.duration * 0.01);
      } else {
        video.currentTime = 0.001;
      }
    } catch {
      /* ignore */
    }
  };
  video.addEventListener("loadedmetadata", kick, { once: true });
  return video;
}

/** Idle warmed elements keyed by media URL. */
const idleByUrl = new Map<string, HTMLVideoElement[]>();
/** Preview clip → borrowed element. */
const inUseByClip = new Map<string, { url: string; video: HTMLVideoElement }>();

/** Start decoding as soon as a file lands in the media bin. */
export function warmMediaUrl(url: string): void {
  if (!url || typeof document === "undefined") return;
  const idle = idleByUrl.get(url) ?? [];
  if (idle.length > 0 || [...inUseByClip.values()].some((e) => e.url === url)) {
    return;
  }
  idle.push(createVideo(url));
  idleByUrl.set(url, idle);
}

/** Borrow (or create) a video for a timeline preview clip. */
export function acquireMediaVideo(url: string, clipId: string): HTMLVideoElement {
  const existing = inUseByClip.get(clipId);
  if (existing) {
    if (existing.url === url) return existing.video;
    releaseMediaVideo(clipId);
  }
  const idle = idleByUrl.get(url) ?? [];
  const video = idle.pop() ?? createVideo(url);
  idleByUrl.set(url, idle);
  inUseByClip.set(clipId, { url, video });
  return video;
}

/** Return a clip's video to the idle pool (keeps decoder warm). */
export function releaseMediaVideo(clipId: string): void {
  const entry = inUseByClip.get(clipId);
  if (!entry) return;
  inUseByClip.delete(clipId);
  try {
    entry.video.pause();
  } catch {
    /* ignore */
  }
  if (entry.video.parentElement) {
    entry.video.parentElement.removeChild(entry.video);
  }
  const idle = idleByUrl.get(entry.url) ?? [];
  idle.push(entry.video);
  idleByUrl.set(entry.url, idle);
}

export function isMediaVideoReady(url: string): boolean {
  for (const v of idleByUrl.get(url) ?? []) {
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return true;
  }
  for (const { url: u, video } of inUseByClip.values()) {
    if (u === url && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return true;
    }
  }
  return false;
}
