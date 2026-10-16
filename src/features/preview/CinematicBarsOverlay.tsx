import { useEffect, useRef, useState } from "react";
import { normalizeLetterbox, type Letterbox } from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { updateCanvas } from "../../domain";
import { useEditorUiStore } from "../../stores/editorUiStore";
import styles from "./PreviewPanel.module.css";

interface Props {
  letterbox: Letterbox | null | undefined;
}

type Edge = "topPct" | "bottomPct" | "leftPct" | "rightPct";

/**
 * Vegas-style bars. Grips only appear while Ctrl is held;
 * Ctrl + drag a grip to resize. Plain drag stays free for clips.
 */
export function CinematicBarsOverlay({ letterbox }: Props) {
  const lb = normalizeLetterbox(letterbox ?? null);
  const [ctrlDown, setCtrlDown] = useState(false);
  const dragRef = useRef<{ edge: Edge } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") setCtrlDown(false);
    };
    const blur = () => setCtrlDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  if (!lb.enabled) return null;

  function onEdgePointerDown(e: React.PointerEvent<HTMLElement>, edge: Edge) {
    // Require Ctrl — otherwise let the event fall through to clip drag/select.
    if (!e.ctrlKey) {
      useEditorUiStore.getState().setStatusMessage("Giữ Ctrl + kéo mép đen để chỉnh viền điện ảnh");
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const stage = (e.currentTarget.closest("[data-stage]") as HTMLElement | null) ?? null;
    const rect = stage?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { edge };
    e.currentTarget.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // % of canvas dimension — identical math to export drawbox.
      let pct = 0;
      if (drag.edge === "topPct") pct = ((ev.clientY - rect.top) / rect.height) * 100;
      else if (drag.edge === "bottomPct") pct = ((rect.bottom - ev.clientY) / rect.height) * 100;
      else if (drag.edge === "leftPct") pct = ((ev.clientX - rect.left) / rect.width) * 100;
      else pct = ((rect.right - ev.clientX) / rect.width) * 100;
      pct = Math.min(45, Math.max(0, Math.round(pct * 10) / 10));
      commitProjectChange((p) => updateCanvas(p, { letterbox: { [drag.edge]: pct } as Partial<Letterbox> }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const barColor = lb.color?.trim() ? lb.color : "#000000";
  const gripClass = ctrlDown ? `${styles.cineGrip} ${styles.cineGripLive}` : styles.cineGrip;

  return (
    <div className={styles.cineBars} data-cine-bars style={{ zIndex: 20000 }}>
      <div className={styles.cineBarTop} style={{ height: `${lb.topPct}%`, background: barColor }}>
        <div className={styles.cineHandleBottom} title="Giữ Ctrl + kéo">
          <span className={gripClass} onPointerDown={(e) => onEdgePointerDown(e, "topPct")} />
        </div>
      </div>
      <div className={styles.cineBarBottom} style={{ height: `${lb.bottomPct}%`, background: barColor }}>
        <div className={styles.cineHandleTop} title="Giữ Ctrl + kéo">
          <span className={gripClass} onPointerDown={(e) => onEdgePointerDown(e, "bottomPct")} />
        </div>
      </div>
      <div
        className={styles.cineBarLeft}
        style={{ width: `${lb.leftPct}%`, top: `${lb.topPct}%`, bottom: `${lb.bottomPct}%`, background: barColor }}
      >
        <div className={styles.cineHandleRight} title="Giữ Ctrl + kéo">
          <span className={gripClass} onPointerDown={(e) => onEdgePointerDown(e, "leftPct")} />
        </div>
      </div>
      <div
        className={styles.cineBarRight}
        style={{ width: `${lb.rightPct}%`, top: `${lb.topPct}%`, bottom: `${lb.bottomPct}%`, background: barColor }}
      >
        <div className={styles.cineHandleLeft} title="Giữ Ctrl + kéo">
          <span className={gripClass} onPointerDown={(e) => onEdgePointerDown(e, "rightPct")} />
        </div>
      </div>
    </div>
  );
}
