import { useEffect, useRef, type ReactNode } from "react";
import { ticksToSeconds } from "../../domain";
import { pausePlayback, requestPlay } from "../../lib/playback";
import {
  GoEndIcon,
  GoStartIcon,
  MarkerInIcon,
  MarkerOutIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  ForwardIcon,
  StepBackIcon,
  StepForwardIcon,
  CloseIcon,
} from "../../components/icons";
import {
  nudgePlaybackRate,
  useEditorUiStore,
} from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./PreviewPanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Premiere-style program monitor transport. */
export function TransportBar() {
  const project = useProjectStore((s) => s.project);
  const fps = project.canvas.frameRate > 0 ? project.canvas.frameRate : 30;
  const frameTicks = Math.round(1_000_000 / fps);

  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const playbackRate = useEditorUiStore((s) => s.playbackRate);
  const setPlaybackRate = useEditorUiStore((s) => s.setPlaybackRate);
  const markInTicks = useEditorUiStore((s) => s.markInTicks);
  const markOutTicks = useEditorUiStore((s) => s.markOutTicks);
  const setMarkInTicks = useEditorUiStore((s) => s.setMarkInTicks);
  const setMarkOutTicks = useEditorUiStore((s) => s.setMarkOutTicks);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setScrubbing = useEditorUiStore((s) => s.setScrubbing);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);

  const clockRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef(durationTicks);
  durationRef.current = durationTicks;

  useEffect(() => {
    const paint = (ticks: number) => {
      const dur = durationRef.current;
      const progress = dur > 0 ? Math.min(1, Math.max(0, ticks / dur)) : 0;
      const pct = `${progress * 100}%`;
      if (fillRef.current) fillRef.current.style.width = pct;
      if (thumbRef.current) thumbRef.current.style.left = pct;
      if (clockRef.current) {
        clockRef.current.textContent = formatClock(ticksToSeconds(ticks));
      }
    };
    paint(useEditorUiStore.getState().playheadTicks);
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks !== prev.playheadTicks) paint(s.playheadTicks);
    });
  }, []);

  const rateLabel =
    playbackRate === 1
      ? "1×"
      : `${playbackRate > 0 ? "" : "−"}${Math.abs(playbackRate)}×`;

  function shuttle(direction: 1 | -1) {
    const next = nudgePlaybackRate(playbackRate, direction);
    setPlaybackRate(next);
    requestPlay();
    setStatusMessage(
      next === 1
        ? "Play 1×"
        : next > 0
          ? `Fast forward ${next}×`
          : `Rewind ${Math.abs(next)}×`,
    );
  }

  const inPct =
    markInTicks != null && durationTicks > 0
      ? (markInTicks / durationTicks) * 100
      : null;
  const outPct =
    markOutTicks != null && durationTicks > 0
      ? (markOutTicks / durationTicks) * 100
      : null;

  function step(deltaFrames: number) {
    pausePlayback();
    const playheadTicks = useEditorUiStore.getState().playheadTicks;
    setPlayheadTicks(
      Math.max(0, Math.min(durationTicks, playheadTicks + deltaFrames * frameTicks)),
    );
  }

  function seekRatio(ratio: number) {
    pausePlayback();
    setPlayheadTicks(Math.round(Math.min(1, Math.max(0, ratio)) * durationTicks));
  }

  return (
    <div className={styles.transportBar}>
      <div className={styles.scrubRow}>
        <button
          type="button"
          className={styles.scrubHandle}
          style={{ left: 0 }}
          title="Go to start"
          onClick={() => {
            pausePlayback();
            setPlayheadTicks(0);
          }}
        />
        <div
          className={styles.scrubTrack}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // Same scrub session as the timeline ruler: while dragging, the
            // decoder seeks (fastSeek) and settles on release. Without the
            // flag the paused decoder never follows the thumb.
            pausePlayback();
            setScrubbing(true);
            const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
            seekRatio(ratio);
            const move = (ev: PointerEvent) => {
              const r = (ev.clientX - rect.left) / Math.max(1, rect.width);
              seekRatio(r);
            };
            const up = () => {
              setScrubbing(false);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
          }}
        >
          <div ref={fillRef} className={styles.scrubFill} style={{ width: "0%" }} />
          {inPct != null ? (
            <span className={styles.markIn} style={{ left: `${inPct}%` }} title="Mark In" />
          ) : null}
          {outPct != null ? (
            <span className={styles.markOut} style={{ left: `${outPct}%` }} title="Mark Out" />
          ) : null}
          <span ref={thumbRef} className={styles.scrubThumb} style={{ left: "0%" }} />
        </div>
        <button
          type="button"
          className={styles.scrubHandle}
          style={{ right: 0 }}
          title="Go to end"
          onClick={() => {
            pausePlayback();
            setPlayheadTicks(durationTicks);
          }}
        />
      </div>

      <div className={styles.transportTools}>
        <div className={styles.toolCluster}>
          <ToolBtn
            title="Mark In (I)"
            onClick={() => {
              setMarkInTicks(useEditorUiStore.getState().playheadTicks);
              setStatusMessage("Mark In set");
            }}
          >
            <MarkerInIcon size={15} />
          </ToolBtn>
          <ToolBtn
            title="Mark Out (O)"
            onClick={() => {
              setMarkOutTicks(useEditorUiStore.getState().playheadTicks);
              setStatusMessage("Mark Out set");
            }}
          >
            <MarkerOutIcon size={15} />
          </ToolBtn>
          <ToolBtn
            title="Go to In"
            disabled={markInTicks == null}
            onClick={() => {
              if (markInTicks == null) return;
              pausePlayback();
              setPlayheadTicks(markInTicks);
            }}
          >
            <GoStartIcon size={15} />
          </ToolBtn>
          <ToolBtn title="Step back 1 frame" onClick={() => step(-1)}>
            <StepBackIcon size={15} />
          </ToolBtn>
          <ToolBtn title="Slower / rewind (J)" onClick={() => shuttle(-1)}>
            <RewindIcon size={15} />
          </ToolBtn>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => {
              if (isPlaying) {
                pausePlayback();
              } else {
                requestPlay();
              }
            }}
            title={isPlaying ? "Pause (K / Space)" : "Play (K / Space)"}
          >
            {isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </button>
          <ToolBtn title="Faster / forward (L)" onClick={() => shuttle(1)}>
            <ForwardIcon size={15} />
          </ToolBtn>
          <button
            type="button"
            className={styles.rateBtn}
            title="Reset to 1×"
            onClick={() => {
              setPlaybackRate(1);
              setStatusMessage("Play 1×");
            }}
          >
            {rateLabel}
          </button>
          <ToolBtn title="Step forward 1 frame" onClick={() => step(1)}>
            <StepForwardIcon size={15} />
          </ToolBtn>
          <ToolBtn
            title="Go to Out"
            disabled={markOutTicks == null}
            onClick={() => {
              if (markOutTicks == null) return;
              pausePlayback();
              setPlayheadTicks(markOutTicks);
            }}
          >
            <GoEndIcon size={15} />
          </ToolBtn>
          <ToolBtn
            title="Clear In/Out"
            onClick={() => {
              setMarkInTicks(null);
              setMarkOutTicks(null);
              setStatusMessage("In/Out cleared");
            }}
          >
            <CloseIcon size={14} />
          </ToolBtn>
        </div>

        <div className={styles.clock}>
          <span ref={clockRef}>
            {formatClock(ticksToSeconds(useEditorUiStore.getState().playheadTicks))}
          </span>
          <span> / </span>
          {formatClock(ticksToSeconds(durationTicks))}
          {selectedClipIds.length > 0 ? (
            <span className={styles.selHint}> · {selectedClipIds.length} selected</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toolBtn}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
