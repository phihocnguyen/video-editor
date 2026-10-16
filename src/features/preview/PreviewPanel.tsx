import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  clipDurationTicks,
  clipVisibleWithTransition,
  layerStackZ,
  normalizeClipEffects,
  normalizeLetterbox,
  playheadInTransitionWindow,
  tintOverlayFromEffects,
  updateCanvas,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "../../domain";
import {
  releasePlaybackDecodeHold,
  setPlaybackHoldStartHook,
} from "../../lib/mediaDecodeGate";
import { releaseMediaBinThumbs } from "../../lib/mediaFilmstrip";
import { isRampClockActive } from "../../lib/rampClock";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { commitProjectChange } from "../../stores/historyStore";
import { CompositeLayers, isPreTransitionMount, preTransitionWindowStart, type PreviewLayer } from "./CompositeLayers";
import { CinematicBarsOverlay } from "./CinematicBarsOverlay";
import { MediaOverlayLayer, type MediaOverlayItem } from "./MediaOverlayLayer";
import { TextOverlayLayer } from "./TextOverlayLayer";
import { TextQuickAccess } from "./TextQuickAccess";
import { TransportBar } from "./TransportBar";
import { useTimelineAudio } from "./useTimelineAudio";
import styles from "./PreviewPanel.module.css";

function visibleLayerKey(
  tracks: Track[],
  clips: Clip[],
  assets: MediaAsset[],
  project: ProjectDocument,
  playheadTicks: number,
  preRollTicks = 0,
): string {
  const ids: string[] = [];
  const videoTracks = tracks
    .filter((t) => t.kind === "video" && t.visible)
    .sort((a, b) => a.order - b.order);
  for (const track of videoTracks) {
    for (const clip of clips) {
      if (clip.trackId !== track.id || clip.kind !== "media" || !clip.assetId) continue;
      if (!clipVisibleWithTransition(clip, playheadTicks, project)) {
        // Pre-mounted ahead of a blend window (decoder warm-up while playing).
        if (!preRollTicks) continue;
        const windowStart = preTransitionWindowStart(project, clip);
        if (windowStart == null) continue;
        if (playheadTicks < windowStart - preRollTicks || playheadTicks >= windowStart) {
          continue;
        }
      }
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.missing) continue;
      if (asset.kind !== "video" && asset.kind !== "image") continue;
      ids.push(clip.id);
    }
  }
  return ids.join("|");
}

function activeTextKey(clips: Clip[], tracks: Track[], playheadTicks: number): string {
  const hidden = new Set(
    tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
  );
  const covering = (c: Clip) =>
    !hidden.has(c.trackId) &&
    playheadTicks >= c.startTicks &&
    playheadTicks < c.startTicks + clipDurationTicks(c);
  const textIds = clips
    .filter((c) => c.kind === "text" && c.text && covering(c))
    .map((c) => c.id);
  const filterIds = clips
    .filter((c) => c.kind === "filter" && covering(c))
    .map((c) => c.id);
  return `${textIds.join("|")}#${filterIds.join("|")}`;
}

export function PreviewPanel() {
  const project = useProjectStore((s) => s.project);
  const canvas = project.canvas;
  const clips = project.clips;
  const assets = project.assets;
  const tracks = project.tracks;
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const isScrubbing = useEditorUiStore((s) => s.isScrubbing);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [cineMenu, setCineMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!cineMenu) return;
    const close = () => setCineMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCineMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [cineMenu]);

  function openCineMenu(e: ReactMouseEvent) {
    e.preventDefault();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    setCineMenu({
      x: Math.min(e.clientX - wrap.left, Math.max(0, wrap.width - 240)),
      y: Math.min(e.clientY - wrap.top, Math.max(0, wrap.height - 200)),
    });
  }

  function cineAddRemove(enabled: boolean) {
    commitProjectChange((p) =>
      updateCanvas(p, {
        letterbox: enabled
          ? { enabled: true, topPct: 12, bottomPct: 12, leftPct: 0, rightPct: 0 }
          : { enabled: false, topPct: 0, bottomPct: 0, leftPct: 0, rightPct: 0 },
      }),
    );
    setStatusMessage(
      enabled ? "Cinematic bars added · hold Ctrl + drag a black edge" : "Cinematic bars removed",
    );
    setCineMenu(null);
  }

  // React list playhead — only advances when visible layers/texts change (or scrub/pause).
  const [listPlayhead, setListPlayhead] = useState(
    () => useEditorUiStore.getState().playheadTicks,
  );
  const lastVisKeyRef = useRef("");
  const lastTextKeyRef = useRef("");
  const projectRef = useRef(project);
  projectRef.current = project;

  const bumpListPlayhead = (ticks: number, force: boolean) => {
    const { tracks: tr, clips: cl, assets: as } = projectRef.current;
    const ui = useEditorUiStore.getState();
    const preRoll = ui.isPlaying && !ui.isScrubbing ? 1_000_000 : 0;
    const vis = visibleLayerKey(tr, cl, as, projectRef.current, ticks, preRoll);
    const text = activeTextKey(cl, tr, ticks);
    if (force || vis !== lastVisKeyRef.current || text !== lastTextKeyRef.current) {
      lastVisKeyRef.current = vis;
      lastTextKeyRef.current = text;
      setListPlayhead(ticks);
    }
  };

  useEffect(() => {
    const ticks = useEditorUiStore.getState().playheadTicks;
    lastVisKeyRef.current = visibleLayerKey(tracks, clips, assets, project, ticks);
    lastTextKeyRef.current = activeTextKey(clips, tracks, ticks);
    setListPlayhead(ticks);
  }, [assets, clips, project, tracks]);

  useEffect(() => {
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks === prev.playheadTicks) return;
      if (s.isPlaying && !s.isScrubbing) return;
      bumpListPlayhead(s.playheadTicks, true);
    });
  }, []);

  const layers = useMemo((): PreviewLayer[] => {
    const videoTracks = tracks
      .filter((t) => t.kind === "video" && t.visible)
      .sort((a, b) => a.order - b.order);
    // Pre-mount the incoming side of a blend ~1s before its window opens
    // (forward play only) so the decoder is already buffered when the
    // transition starts — replaying after a scrub otherwise hitches on a
    // cold mount. Pre-mounted layers stay invisible + paused (see
    // CompositeLayers) until the window opens.
    const preRoll = isPlaying && !isScrubbing ? 1_000_000 : 0;
    const out: PreviewLayer[] = [];
    for (const track of videoTracks) {
      const trackClips = clips
        .filter((c) => c.trackId === track.id && c.kind === "media" && c.assetId)
        .sort((a, b) => a.startTicks - b.startTicks);
      for (const clip of trackClips) {
        if (!clipVisibleWithTransition(clip, listPlayhead, project)) {
          if (!preRoll) continue;
          const windowStart = preTransitionWindowStart(project, clip);
          if (windowStart == null) continue;
          if (listPlayhead < windowStart - preRoll || listPlayhead >= windowStart) {
            continue;
          }
        }
        const asset = assets.find((a) => a.id === clip.assetId);
        if (!asset || asset.missing) continue;
        if (asset.kind !== "video" && asset.kind !== "image") continue;
        out.push({ clip, asset, track, isTopVideo: false });
      }
    }
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].asset.kind === "video") {
        out[i] = { ...out[i], isTopVideo: true };
        break;
      }
    }
    return out;
  }, [assets, clips, isPlaying, isScrubbing, listPlayhead, project, tracks]);

  const mediaOverlayItems = useMemo((): MediaOverlayItem[] => {
    return layers
      .filter((l) => l.asset.kind === "video" || l.asset.kind === "image")
      // Pre-mounted blend sides are invisible — keep their hit-box out so
      // clicks during the pre-roll second still hit the outgoing clip.
      .filter((l) => !isPreTransitionMount(project, l.clip, listPlayhead))
      .map((l) => ({
        clip: l.clip,
        asset: l.asset,
        trackOrder: l.track.order,
      }));
  }, [layers, listPlayhead, project]);

  const activeTexts = useMemo(() => {
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const hidden = new Set(
      tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
    );
    return clips
      .filter(
        (c) =>
          c.kind === "text" &&
          c.text &&
          !hidden.has(c.trackId) &&
          listPlayhead >= c.startTicks &&
          listPlayhead < c.startTicks + clipDurationTicks(c),
      )
      .map((clip) => ({
        clip,
        trackOrder: tracksById.get(clip.trackId)?.order ?? 0,
      }))
      .sort((a, b) => a.trackOrder - b.trackOrder);
  }, [clips, listPlayhead, tracks]);

  const activeFilters = useMemo(() => {
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const hidden = new Set(
      tracks.filter((t) => t.kind === "video" && !t.visible).map((t) => t.id),
    );
    return clips
      .filter(
        (c) =>
          c.kind === "filter" &&
          !hidden.has(c.trackId) &&
          listPlayhead >= c.startTicks &&
          listPlayhead < c.startTicks + clipDurationTicks(c),
      )
      .map((clip) => ({
        clip,
        trackOrder: tracksById.get(clip.trackId)?.order ?? 0,
      }))
      .sort((a, b) => b.trackOrder - a.trackOrder);
  }, [clips, listPlayhead, tracks]);

  useTimelineAudio({
    clips,
    tracks,
    assets,
    isPlaying,
    isScrubbing,
  });

  useEffect(() => {
    // On Play hold start: soft-pause media-bin thumb videos (no src teardown).
    setPlaybackHoldStartHook(() => releaseMediaBinThumbs());
    return () => setPlaybackHoldStartHook(null);
  }, []);

  // Hold is acquired in `requestPlay()`. Any path that clears `isPlaying`
  // (transport, end-of-timeline, scrub, overlay) must drop the hold — including
  // direct `setPlaying(false)` call sites that skip `pausePlayback()`.
  useEffect(() => {
    return useEditorUiStore.subscribe((s, prev) => {
      if (prev.isPlaying && !s.isPlaying) {
        releasePlaybackDecodeHold();
      }
    });
  }, []);

  // Wall-clock playhead. Intentionally NOT dependent on `durationTicks` — a
  // duration store update mid-Play used to cancel+restart this effect after one
  // tiny step (the play-then-freeze symptom).
  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let frame = 0;
    let last = 0; // set on first rAF so dt is not measured across the click gap
    const tick = (now: number) => {
      const ui = useEditorUiStore.getState();
      if (!ui.isPlaying || ui.isScrubbing) return;

      if (last === 0) {
        last = now;
        frame = requestAnimationFrame(tick);
        return;
      }

      const dt = (now - last) / 1000;
      last = now;
      const duration = ui.durationTicks;

      // During transitions, force layer remounts so clip 2 appears / clip 1 leaves.
      const forceLayers = playheadInTransitionWindow(projectRef.current, ui.playheadTicks);

      if (isRampClockActive()) {
        const cur = ui.playheadTicks;
        if (cur >= duration) {
          setPlayheadTicks(duration);
          setPlaying(false);
          bumpListPlayhead(duration, true);
          return;
        }
        bumpListPlayhead(cur, forceLayers);
        frame = requestAnimationFrame(tick);
        return;
      }

      const rate = ui.playbackRate;
      const delta = Math.round(dt * 1_000_000 * rate);
      if (delta === 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const cur = ui.playheadTicks;
      const next = cur + delta;
      if (next >= duration) {
        setPlayheadTicks(duration);
        setPlaying(false);
        bumpListPlayhead(duration, true);
        return;
      }
      if (next <= 0) {
        setPlayheadTicks(0);
        setPlaying(false);
        bumpListPlayhead(0, true);
        return;
      }
      setPlayheadTicks(next);
      bumpListPlayhead(
        next,
        forceLayers || playheadInTransitionWindow(projectRef.current, next),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, isScrubbing, setPlayheadTicks, setPlaying]);

  return (
    <div className={styles.panel}>
      <div ref={wrapRef} className={styles.stageWrap} onContextMenu={openCineMenu}>
        <div
          ref={stageRef}
          className={styles.stage}
          data-stage
          style={{
            aspectRatio: `${canvas.width} / ${canvas.height}`,
            background: canvas.backgroundColor,
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              if (selectedClipIds.length > 0) setSelectedClipIds([]);
            }
          }}
        >
          <CompositeLayers
            layers={layers}
            isPlaying={isPlaying}
            isScrubbing={isScrubbing}
          />
          <FilterWashLayer items={activeFilters} />
          <MediaOverlayLayer
            items={mediaOverlayItems}
            canvasWidth={canvas.width}
            canvasHeight={canvas.height}
            stageRef={stageRef}
          />
          <TextOverlayLayer
            items={activeTexts}
            canvasWidth={canvas.width}
            canvasHeight={canvas.height}
            stageRef={stageRef}
            playheadTicks={listPlayhead}
          />
          <CinematicBarsOverlay letterbox={canvas.letterbox} />
        </div>
        {cineMenu ? (
          <div
            className={styles.cineMenu}
            style={{ left: cineMenu.x, top: cineMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {(() => {
              const lb = normalizeLetterbox(canvas.letterbox ?? null);
              return lb.enabled ? (
                <button
                  type="button"
                  className={styles.cineMenuItem}
                  onClick={() => cineAddRemove(false)}
                >
                  Remove cinematic bars
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.cineMenuItem}
                  onClick={() => cineAddRemove(true)}
                >
                  Add cinematic bars
                </button>
              );
            })()}
          </div>
        ) : null}
        {/* Outside .stage so overflow:hidden doesn't clip the floating bar */}
        <TextQuickAccess stageRef={stageRef} wrapRef={wrapRef} />
      </div>

      <TransportBar />
    </div>
  );
}

function FilterWashLayer({
  items,
}: {
  items: { clip: Clip; trackOrder: number }[];
}) {
  return (
    <>
      {items.map(({ clip, trackOrder }) => {
        const tint = tintOverlayFromEffects(normalizeClipEffects(clip.effects));
        if (!tint) return null;
        const opacity = Math.min(1, Math.max(0, clip.transform.opacity));
        return (
          <div
            key={clip.id}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: layerStackZ(trackOrder, "filter"),
              background: tint.color,
              opacity: tint.opacity * opacity,
              mixBlendMode: tint.blend as CSSProperties["mixBlendMode"],
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}
