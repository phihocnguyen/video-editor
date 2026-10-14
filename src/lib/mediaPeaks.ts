/** In-memory waveform peak cache (min/max pairs per bucket). */

export interface MediaPeaks {
  durationSec: number;
  /** Interleaved [min, max] per bucket, values in -1..1. */
  peaks: Float32Array;
  buckets: number;
}

const cache = new Map<string, Promise<MediaPeaks | null>>();

const TARGET_BUCKETS = 1024;

function downsampleChannel(channel: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const block = Math.max(1, Math.floor(channel.length / buckets));
  for (let i = 0; i < buckets; i++) {
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    let min = 1;
    let max = -1;
    for (let j = start; j < end; j++) {
      const v = channel[j]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (end <= start) {
      min = 0;
      max = 0;
    }
    out[i * 2] = min;
    out[i * 2 + 1] = max;
  }
  return out;
}

async function decodePeaks(url: string): Promise<MediaPeaks | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const channel = audio.getChannelData(0);
    const buckets = Math.min(TARGET_BUCKETS, Math.max(32, Math.floor(channel.length / 256)));
    return {
      durationSec: audio.duration,
      peaks: downsampleChannel(channel, buckets),
      buckets,
    };
  } finally {
    void ctx.close();
  }
}

export function getMediaPeaks(cacheKey: string, url: string): Promise<MediaPeaks | null> {
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const promise = decodePeaks(url).catch(() => null);
  cache.set(cacheKey, promise);
  return promise;
}
