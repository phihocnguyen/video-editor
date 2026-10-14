/** Timeline uses integer ticks as the source of truth (1 tick = 1/TICKS_PER_SECOND second). */
export const TICKS_PER_SECOND = 1_000_000;

export type Tick = number;

export function secondsToTicks(seconds: number): Tick {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: Tick): number {
  return ticks / TICKS_PER_SECOND;
}

export function ticksToFrames(ticks: Tick, frameRate: number): number {
  return Math.round(ticksToSeconds(ticks) * frameRate);
}

export function framesToTicks(frames: number, frameRate: number): Tick {
  return secondsToTicks(frames / frameRate);
}
