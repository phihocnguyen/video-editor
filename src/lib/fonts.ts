export interface FontOption {
  id: string;
  family: string;
  /** Absolute path when user browsed a custom font file. */
  path: string | null;
  source: "system" | "custom";
  /** File in `public/fonts/` shipped with the app (OFL, no fallback needed). */
  bundledFile?: string;
  /** Regular-weight file for the same family (used when weight < 650). */
  bundledRegularFile?: string;
}

/** Common fonts — bundled UI faces first, then system fallbacks.
 * Preview renders text at weight 700, so the bundled export faces are the
 * static Bold instances (same outlines the user sees). */
export const BUILTIN_FONTS: FontOption[] = [
  {
    id: "manrope",
    family: "Manrope Variable",
    path: null,
    source: "system",
    bundledFile: "Manrope-Bold.ttf",
    bundledRegularFile: "Manrope-Variable.ttf",
  },
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono Variable",
    path: null,
    source: "system",
    bundledFile: "JetBrainsMono-Bold.ttf",
    bundledRegularFile: "JetBrainsMono-Variable.ttf",
  },
  { id: "arial", family: "Arial", path: null, source: "system" },
  { id: "arial-black", family: "Arial Black", path: null, source: "system" },
  { id: "georgia", family: "Georgia", path: null, source: "system" },
  { id: "impact", family: "Impact", path: null, source: "system" },
  { id: "segoe-ui", family: "Segoe UI", path: null, source: "system" },
  { id: "verdana", family: "Verdana", path: null, source: "system" },
  { id: "times", family: "Times New Roman", path: null, source: "system" },
];

/** Bundled TTF filename for a family name (case-insensitive substring match).
 * Weight snaps to the closest shipped face: Bold (700) at ≥ 650, otherwise
 * the Regular/variable file. Custom/system families return null. */
export function bundledFontFileForFamily(family: string, weight = 700): string | null {
  const needle = family.toLowerCase();
  const bold = Number.isFinite(weight) ? weight >= 650 : true;
  for (const option of BUILTIN_FONTS) {
    if (!option.bundledFile) continue;
    const hay = option.family.toLowerCase();
    const hit =
      needle.includes(hay) ||
      hay.includes(needle) ||
      (hay.split(" ")[0]! && needle.includes(hay.split(" ")[0]!));
    if (!hit) continue;
    if (!bold && option.bundledRegularFile) return option.bundledRegularFile;
    return option.bundledFile;
  }
  return null;
}

const customFonts: FontOption[] = [];
const loadedFaces = new Set<string>();

export function listFontOptions(): FontOption[] {
  return [...BUILTIN_FONTS, ...customFonts];
}

export async function registerCustomFontFile(
  file: File,
  absolutePath: string | null = null,
): Promise<FontOption> {
  const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, "");
  const id = `custom-${crypto.randomUUID()}`;
  const url = URL.createObjectURL(file);
  const face = new FontFace(family, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  loadedFaces.add(family);

  const option: FontOption = {
    id,
    family,
    path: absolutePath,
    source: "custom",
  };
  customFonts.push(option);
  return option;
}

export async function ensureFontLoaded(family: string, fontPath: string | null): Promise<void> {
  if (loadedFaces.has(family) || document.fonts.check(`16px "${family}"`)) {
    loadedFaces.add(family);
    return;
  }
  if (!fontPath) return;
  // Desktop: fontPath can be loaded via convertFileSrc in a later pass.
  void fontPath;
}

export function pickBrowserFontFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff,.woff2";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
