/**
 * Grouped, illustrated effect browser — the CapCut-style card grid.
 *
 * Renders category sub-tabs plus a grid of cards, each showing an
 * `EffectThumb` (animated mini-preview) with its label underneath.
 */

import { useMemo, useState } from "react";
import type { TextAnimId, TransitionType } from "../../domain";
import { EffectThumb } from "./EffectThumb";
import styles from "./PresetGrid.module.css";

export interface PresetItem {
  id: string;
  label: string;
  hint: string;
  group: string;
}

interface PresetGridProps {
  items: PresetItem[];
  groups: { id: string; label: string }[];
  /** Currently-selected preset id. */
  value: string;
  media: "text" | "video";
  onSelect: (id: string) => void;
  /** Optional note shown under the grid (e.g. export approximation warning). */
  footnote?: string;
}

export function PresetGrid({
  items,
  groups,
  value,
  media,
  onSelect,
  footnote,
}: PresetGridProps) {
  const selectedGroup = items.find((i) => i.id === value)?.group;
  const [activeGroup, setActiveGroup] = useState<string>(
    selectedGroup ?? groups[0]?.id ?? "",
  );

  const visible = useMemo(
    () => items.filter((i) => i.group === activeGroup),
    [items, activeGroup],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === activeGroup}
            className={g.id === activeGroup ? styles.tabActive : styles.tab}
            onClick={() => setActiveGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className={styles.grid}>
        {visible.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? styles.cardActive : styles.card}
              title={item.hint}
              onClick={() => onSelect(item.id)}
            >
              <EffectThumb
                media={media}
                textAnim={media === "text" ? (item.id as TextAnimId) : undefined}
                transition={
                  media === "video" ? (item.id as TransitionType) : undefined
                }
              />
              <span className={styles.cardLabel}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
    </div>
  );
}
