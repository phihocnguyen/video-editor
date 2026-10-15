import type { TextListStyle, TextStyle } from "./project";

const BULLET_RE = /^[•·\-*]\s+/;
const NUMBER_RE = /^\d+[.)]\s+/;

/** Strip leading bullet/number prefixes from each line. */
export function stripListPrefixes(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(BULLET_RE, "").replace(NUMBER_RE, ""))
    .join("\n");
}

/** Apply bullet or numbered prefixes to each non-empty line (after stripping). */
export function applyListPrefixes(content: string, listStyle: TextListStyle): string {
  const bare = stripListPrefixes(content);
  if (listStyle === "none") return bare;
  const lines = bare.split("\n");
  let n = 0;
  return lines
    .map((line) => {
      if (line.trim().length === 0) return line;
      n += 1;
      if (listStyle === "bullet") return `• ${line}`;
      return `${n}. ${line}`;
    })
    .join("\n");
}

/**
 * Toggle list style on a TextStyle. Rewrites `content` prefixes and sets `listStyle`.
 * Switching styles strips the old prefix first.
 */
export function withListStyle(text: TextStyle, next: TextListStyle): TextStyle {
  if (text.listStyle === next) {
    return {
      ...text,
      listStyle: "none",
      content: stripListPrefixes(text.content),
    };
  }
  return {
    ...text,
    listStyle: next,
    content: applyListPrefixes(text.content, next),
  };
}

export function toggleBold(text: TextStyle): TextStyle {
  return {
    ...text,
    fontWeight: text.fontWeight >= 600 ? 400 : 700,
  };
}
