/**
 * Preview playback owns the decoder.
 * Filmstrip / media-bin thumbs must wait — especially right after import on UHD.
 */

type Waiter = () => void;

let playbackHold = 0;
let quietUntil = 0;
const waiters: Waiter[] = [];
let onHoldStart: (() => void) | null = null;

export function setPlaybackHoldStartHook(hook: (() => void) | null): void {
  onHoldStart = hook;
}

/** Call after import / add-to-timeline so thumbs don't steal the decoder. */
export function beginMediaQuietPeriod(ms = 2800): void {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
  onHoldStart?.();
  scheduleQuietFlush();
}

export function beginPlaybackDecodeHold(): void {
  const wasIdle = playbackHold === 0;
  playbackHold += 1;
  if (wasIdle) onHoldStart?.();
}

export function endPlaybackDecodeHold(): void {
  playbackHold = Math.max(0, playbackHold - 1);
  if (playbackHold === 0 && Date.now() >= quietUntil) {
    flushWaiters();
  }
}

export function isPreviewDecodeBusy(): boolean {
  return playbackHold > 0 || Date.now() < quietUntil;
}

/** Resolves when preview is idle and post-import quiet window has ended. */
export function whenPreviewDecodeIdle(): Promise<void> {
  if (!isPreviewDecodeBusy()) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
    scheduleQuietFlush();
  });
}

function flushWaiters(): void {
  const pending = waiters.splice(0, waiters.length);
  for (const w of pending) w();
}

let quietTimer: number | null = null;
function scheduleQuietFlush(): void {
  if (typeof window === "undefined") return;
  if (quietTimer != null) window.clearTimeout(quietTimer);
  const left = quietUntil - Date.now();
  if (left <= 0) {
    if (playbackHold === 0) flushWaiters();
    return;
  }
  quietTimer = window.setTimeout(() => {
    quietTimer = null;
    if (playbackHold === 0 && Date.now() >= quietUntil) flushWaiters();
  }, left + 10);
}
