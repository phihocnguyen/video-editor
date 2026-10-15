/**
 * Media-bin thumbnail decoder registry.
 *
 * Timeline filmstrips were removed — they contended with preview Play on the
 * same hardware decoder. This module only tracks media-bin `<video>` posters
 * so playback can free them synchronously on Play.
 */

/** Media-bin `<video>` posters that can steal the hardware decoder from preview. */
const mediaBinThumbs = new Set<HTMLVideoElement>();

export function registerMediaBinThumb(video: HTMLVideoElement): void {
  mediaBinThumbs.add(video);
}

export function unregisterMediaBinThumb(video: HTMLVideoElement): void {
  mediaBinThumbs.delete(video);
}

/**
 * Soft-release media-bin thumb videos so preview can Play.
 * Only pause — do NOT clear src / load(). Tearing down a second decoder for the
 * same file resets the hardware session and glitches the preview on first Play.
 */
export function releaseMediaBinThumbs(): void {
  for (const video of mediaBinThumbs) {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }
}

/** Hard teardown (import quiet / dispose) — clears src. */
export function destroyMediaBinThumbs(): void {
  for (const video of mediaBinThumbs) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore */
    }
  }
}

/** @deprecated Alias — timeline filmstrips are gone; frees media-bin thumbs. */
export function releaseFilmstripSeekers(): void {
  releaseMediaBinThumbs();
}

/** Full teardown of media-bin thumb decoders. */
export function releaseFilmstripDecoders(): void {
  destroyMediaBinThumbs();
}
