import { useLayoutEffect, useRef, useState } from "react";

export interface ClipLayout {
  id: string;
  start: number;
  dur: number;
}

let hold: { clipId: string; durationTicks: number } | null = null;
let easeNonce = 0;

export function getRampLayoutHold(): { clipId: string; durationTicks: number } | null {
  return hold;
}

export function setRampLayoutHold(next: { clipId: string; durationTicks: number } | null): void {
  hold = next;
}

export function armClipLayoutEase(): void {
  easeNonce += 1;
}

function clipLayoutEaseNonce(): number {
  return easeNonce;
}

function mix(from: ClipLayout[], to: ClipLayout[], eased: number): ClipLayout[] {
  const prev = new Map(from.map((item) => [item.id, item]));
  return to.map((item) => {
    const origin = prev.get(item.id);
    if (!origin) return item;
    return {
      id: item.id,
      start: origin.start + (item.start - origin.start) * eased,
      dur: origin.dur + (item.dur - origin.dur) * eased,
    };
  });
}

function sameLayout(a: ClipLayout[], b: ClipLayout[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id || left.start !== right.start || left.dur !== right.dur) {
      return false;
    }
  }
  return true;
}

/** Longer moves get a longer glide, capped so a big slow-mo doesn't feel stuck. */
function easeMs(from: ClipLayout[], to: ClipLayout[]): number {
  const prev = new Map(from.map((item) => [item.id, item]));
  let maxDelta = 0;
  for (const item of to) {
    const origin = prev.get(item.id);
    if (!origin) continue;
    maxDelta = Math.max(
      maxDelta,
      Math.abs(item.dur - origin.dur) + Math.abs(item.start - origin.start),
    );
  }
  const seconds = maxDelta / 1_000_000;
  return Math.min(720, Math.max(220, 220 + seconds * 70));
}

/**
 * Timeline clip positions. Ramp drags hold the slot still; on release (and on
 * a speed preset) the slot and later clips glide to the new length.
 */
export function useEasedClipLayout(targets: ClipLayout[]): Map<string, ClipLayout> {
  const [frame, setFrame] = useState(targets);
  const shown = useRef(targets);
  const targetsRef = useRef(targets);
  const consumedNonce = useRef(0);
  targetsRef.current = targets;
  const key = targets.map((item) => `${item.id}:${item.start}:${item.dur}`).join("|");
  const nonce = clipLayoutEaseNonce();

  useLayoutEffect(() => {
    const to = targetsRef.current;
    const from = shown.current;
    const ease = nonce !== consumedNonce.current;
    consumedNonce.current = nonce;
    if (!ease || sameLayout(from, to)) {
      shown.current = to;
      setFrame(to);
      return;
    }
    const ms = easeMs(from, to);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const smooth = t * t * (3 - 2 * t);
      const next = mix(from, to, smooth);
      shown.current = next;
      setFrame(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, nonce]);

  const map = new Map<string, ClipLayout>();
  for (const item of frame) map.set(item.id, item);
  return map;
}
