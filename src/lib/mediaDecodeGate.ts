/**
 * Preview playback owns the decoder.
 * Filmstrip / media-bin thumbs must wait — especially right after import on UHD.
 *
 * Playback is authoritative and synchronous: `beginPlaybackDecodeHold()` bumps a
 * generation counter ("epoch") immediately, so any thumbnail job that is already
 * in flight observes a stale epoch and drops its result instead of stealing the
 * decoder back. Thumbs armed *after* the bump wait for the idle window.
 *
 * Two wait lists:
 *  - `slotWaiters`  resolve as soon as the preview hold reaches zero (a queued
 *                   capture yields to Play without waiting out the quiet window).
 *  - `idleWaiters`  resolve when the hold is zero AND the post-import quiet
 *                   window has elapsed (thumbs starting from scratch).
 */

type Waiter = () => void;

let playbackHold = 0;
let quietUntil = 0;
/** Incremented whenever preview wants the decoder. Invalidates in-flight thumbs. */
let decodeEpoch = 0;
const slotWaiters: Waiter[] = [];
const idleWaiters: Waiter[] = [];
let onHoldStart: (() => void) | null = null;

export function setPlaybackHoldStartHook(hook: (() => void) | null): void {
  onHoldStart = hook;
}

/** Current generation. Thumbs capture this before each `await` and re-check it. */
export function currentDecodeEpoch(): number {
  return decodeEpoch;
}

/**
 * Invalidate every thumbnail job that is already running and (re)start the quiet
 * window so newly-armed thumbs also hold off. Called synchronously on import.
 */
export function beginMediaQuietPeriod(ms = 2800): void {
  decodeEpoch += 1;
  quietUntil = Math.max(quietUntil, Date.now() + ms);
  onHoldStart?.();
  scheduleQuietFlush();
}

export function beginPlaybackDecodeHold(): void {
  const wasIdle = playbackHold === 0;
  decodeEpoch += 1;
  playbackHold += 1;
  if (wasIdle) onHoldStart?.();
}

/**
 * Synchronously invalidate in-flight thumbs so a Play press wins the decoder
 * race without waiting for React to re-render `isPlaying`. Only bumps the epoch
 * (in-flight captures drop their result); decoder *release* stays with
 * `beginPlaybackDecodeHold`, which owns the hold counter and fires the hook.
 */
export function preemptDecodersNow(): void {
  decodeEpoch += 1;
  scheduleQuietFlush();
}

export function endPlaybackDecodeHold(): void {
  playbackHold = Math.max(0, playbackHold - 1);
  if (playbackHold > 0) return;
  flushSlotWaiters();
  if (Date.now() >= quietUntil) flushIdleWaiters();
  else scheduleQuietFlush();
}

export function isPreviewDecodeBusy(): boolean {
  return playbackHold > 0 || Date.now() < quietUntil;
}

/** True if the epoch moved since `epoch` was captured. */
export function isDecodeEpochStale(epoch: number): boolean {
  return epoch !== decodeEpoch;
}

/** Resolves when preview is idle and the post-import quiet window has ended. */
export function whenPreviewDecodeIdle(): Promise<void> {
  if (!isPreviewDecodeBusy()) return Promise.resolve();
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
    scheduleQuietFlush();
  });
}

/**
 * Resolves once the preview hold drops to zero — regardless of the quiet window.
 * A long thumbnail can thus yield immediately to a Play press instead of
 * finishing its current seek.
 */
export function whenDecodeSlotFree(): Promise<void> {
  if (playbackHold === 0) return Promise.resolve();
  return new Promise((resolve) => {
    slotWaiters.push(resolve);
  });
}

function flushSlotWaiters(): void {
  const pending = slotWaiters.splice(0, slotWaiters.length);
  for (const w of pending) w();
}

function flushIdleWaiters(): void {
  const pending = idleWaiters.splice(0, idleWaiters.length);
  for (const w of pending) w();
}

let quietTimer: number | null = null;
function scheduleQuietFlush(): void {
  if (typeof window === "undefined") return;
  if (quietTimer != null) window.clearTimeout(quietTimer);
  const left = quietUntil - Date.now();
  if (left <= 0) {
    if (playbackHold === 0) flushIdleWaiters();
    return;
  }
  quietTimer = window.setTimeout(() => {
    quietTimer = null;
    if (playbackHold === 0 && Date.now() >= quietUntil) flushIdleWaiters();
  }, left + 10);
}
