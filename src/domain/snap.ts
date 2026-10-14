import type { Clip } from "./project";
import type { Tick } from "./time";
import { clipDurationTicks } from "./timelineCommands";

/** Snap a timeline tick to nearby clip edges / playhead within threshold. */
export function snapTicks(
  ticks: Tick,
  clips: Clip[],
  options?: { thresholdTicks?: Tick; extraTargets?: Tick[] },
): Tick {
  const threshold = options?.thresholdTicks ?? 200_000; // 0.2s
  const targets = [...(options?.extraTargets ?? [])];
  for (const clip of clips) {
    targets.push(clip.startTicks);
    targets.push(clip.startTicks + clipDurationTicks(clip));
  }
  let best = ticks;
  let bestDist = threshold + 1;
  for (const target of targets) {
    const dist = Math.abs(target - ticks);
    if (dist <= threshold && dist < bestDist) {
      best = target;
      bestDist = dist;
    }
  }
  return Math.max(0, best);
}

export function projectDurationTicks(clips: Clip[], fallback = 30_000_000): Tick {
  let max = 0;
  for (const clip of clips) {
    max = Math.max(max, clip.startTicks + clipDurationTicks(clip));
  }
  return Math.max(fallback, max + 2_000_000);
}
