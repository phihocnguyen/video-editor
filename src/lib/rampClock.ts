/**
 * When a ramped clip is playing, the HTML video element is the clock —
 * the timeline playhead follows `currentTime` instead of wall-clock rAF.
 * That keeps 4× / slow-mo feeling correct without seek-fighting the decoder.
 */

let active = false;

export function setRampClockActive(next: boolean): void {
  active = next;
}

export function isRampClockActive(): boolean {
  return active;
}
