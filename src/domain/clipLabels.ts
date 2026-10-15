import type { Clip, MediaAsset, ProjectDocument } from "./project";

const SHAPE_PATH_RE = /\/shapes\//i;

/** True when the asset was added from the Shape library (SVG overlays). */
export function isShapeAsset(asset: MediaAsset | null | undefined): boolean {
  if (!asset || asset.kind !== "image") return false;
  return SHAPE_PATH_RE.test(asset.path);
}

function sortClipsStable(a: Clip, b: Clip): number {
  if (a.startTicks !== b.startTicks) return a.startTicks - b.startTicks;
  return a.id.localeCompare(b.id);
}

/**
 * Short CapCut-style lane label: text → T1/T2…, shapes → S1/S2…,
 * otherwise the asset/file name.
 */
export function clipShortLabel(
  project: ProjectDocument,
  clip: Clip,
  asset?: MediaAsset | null,
): string {
  if (clip.kind === "text") {
    const texts = project.clips.filter((c) => c.kind === "text").sort(sortClipsStable);
    const index = texts.findIndex((c) => c.id === clip.id);
    return `T${Math.max(1, index + 1)}`;
  }

  const resolved =
    asset ??
    (clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : null) ??
    null;

  if (isShapeAsset(resolved)) {
    const shapes = project.clips
      .filter((c) => {
        if (c.kind !== "media" || !c.assetId) return false;
        const a = project.assets.find((x) => x.id === c.assetId);
        return isShapeAsset(a);
      })
      .sort(sortClipsStable);
    const index = shapes.findIndex((c) => c.id === clip.id);
    return `S${Math.max(1, index + 1)}`;
  }

  return resolved?.name ?? "Clip";
}

/** Tooltip / secondary title: short label plus content when useful. */
export function clipDisplayTitle(
  project: ProjectDocument,
  clip: Clip,
  asset?: MediaAsset | null,
): string {
  const short = clipShortLabel(project, clip, asset);
  if (clip.kind === "text") {
    const content = clip.text?.content?.trim();
    return content ? `${short} · ${content}` : short;
  }
  if (isShapeAsset(asset ?? null) && asset?.name && asset.name !== short) {
    return `${short} · ${asset.name}`;
  }
  return short;
}
