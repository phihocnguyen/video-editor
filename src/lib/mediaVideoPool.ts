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
  // No warm seek — a 0.001s kick showed up as a Play glitch and fought the
  // first play() on some decoders. preload=auto is enough to decode ahead.
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

/**
 * Hard-reset an element: cancels any in-flight seek and drops the decoder.
 * A seek issued on a detached (warmed, never mounted) element can wedge
 * `seeking=true` forever — handing that element out poisons the next
 * transition that adopts it (the even/odd replay stutter).
 */
function resetVideo(video: HTMLVideoElement) {
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  try {
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore */
  }
  clearVideoLayoutStyles(video);
}

/** Borrow (or create) a video for a timeline preview clip. */
export function acquireMediaVideo(url: string, clipId: string): HTMLVideoElement {
  const existing = inUseByClip.get(clipId);
  if (existing) {
    if (existing.url === url) return existing.video;
    releaseMediaVideo(clipId);
  }
  const idle = idleByUrl.get(url) ?? [];
  let video = idle.pop();
  if (video && video.seeking) {
    // Never hand out a mid-seek element — see resetVideo.
    resetVideo(video);
  }
  if (video && !video.getAttribute("src")) {
    video.src = url;
  }
  if (!video) video = createVideo(url);
  idleByUrl.set(url, idle);
  inUseByClip.set(clipId, { url, video });
  return video;
}

/** Strip host geometry that may have been baked onto the element mid-remount. */
function clearVideoLayoutStyles(video: HTMLVideoElement) {
  video.style.zIndex = "";
  video.style.opacity = "";
  video.style.filter = "";
  video.style.clipPath = "";
  video.style.left = "";
  video.style.top = "";
  video.style.width = "";
  video.style.height = "";
  video.style.transform = "";
}

/** Return a clip's video to the idle pool (keeps decoder warm). */
export function releaseMediaVideo(clipId: string): void {
  const entry = inUseByClip.get(clipId);
  if (!entry) return;
  inUseByClip.delete(clipId);
  // A mid-seek release wedges `seeking=true` (seek on a detached element may
  // never resolve) — reset instead of pooling warm, or the next borrower
  // inherits a frozen decoder.
  if (entry.video.seeking) {
    resetVideo(entry.video);
  } else {
    try {
      entry.video.pause();
    } catch {
      /* ignore */
    }
  }
  if (entry.video.parentElement) {
    entry.video.parentElement.removeChild(entry.video);
  }
  clearVideoLayoutStyles(entry.video);
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

/**
 * Kick every mounted preview video immediately on the Play click — do not wait
 * for React effects. Closing the gap where thumbs reclaim the decoder before
 * `isPlaying` subscribers run.
 */
export function resumeInUseMediaVideos(playbackRate = 1): void {
  const rate = Number.isFinite(playbackRate)
    ? Math.min(16, Math.max(0.0625, Math.abs(playbackRate) || 1))
    : 1;
  for (const { video } of inUseByClip.values()) {
    if (!Number.isFinite(video.playbackRate) || video.playbackRate < 0.01) {
      video.playbackRate = rate;
    }
    if (video.ended) {
      try {
        video.currentTime = Math.max(0, video.currentTime - 0.05);
      } catch {
        /* ignore */
      }
    }
    void video.play().catch(() => undefined);
  }
}
