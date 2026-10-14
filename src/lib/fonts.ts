export interface FontOption {
  id: string;
  family: string;
  /** Absolute path when user browsed a custom font file. */
  path: string | null;
  source: "system" | "custom";
}

/** Common desktop fonts — safe defaults without requiring OS enumeration APIs. */
export const BUILTIN_FONTS: FontOption[] = [
  { id: "segoe-ui", family: "Segoe UI", path: null, source: "system" },
  { id: "arial", family: "Arial", path: null, source: "system" },
  { id: "georgia", family: "Georgia", path: null, source: "system" },
  { id: "times", family: "Times New Roman", path: null, source: "system" },
  { id: "courier", family: "Courier New", path: null, source: "system" },
  { id: "verdana", family: "Verdana", path: null, source: "system" },
  { id: "trebuchet", family: "Trebuchet MS", path: null, source: "system" },
  { id: "impact", family: "Impact", path: null, source: "system" },
  { id: "comic", family: "Comic Sans MS", path: null, source: "system" },
];

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
