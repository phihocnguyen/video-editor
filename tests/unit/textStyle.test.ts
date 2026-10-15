import { describe, expect, it } from "vitest";
import {
  applyListPrefixes,
  createDefaultTextStyle,
  normalizeTextStyle,
  stripListPrefixes,
  toggleBold,
  withListStyle,
} from "../../src/domain";

describe("normalizeTextStyle", () => {
  it("defaults new format flags", () => {
    const t = normalizeTextStyle({ content: "Hi" });
    expect(t.italic).toBe(false);
    expect(t.underline).toBe(false);
    expect(t.strikethrough).toBe(false);
    expect(t.listStyle).toBe("none");
  });

  it("round-trips format flags", () => {
    const t = normalizeTextStyle({
      content: "Hi",
      italic: true,
      underline: true,
      strikethrough: true,
      listStyle: "bullet",
    });
    expect(t.italic).toBe(true);
    expect(t.underline).toBe(true);
    expect(t.strikethrough).toBe(true);
    expect(t.listStyle).toBe("bullet");
  });
});

describe("list prefixes", () => {
  it("applies and strips bullets", () => {
    const withBullets = applyListPrefixes("One\nTwo", "bullet");
    expect(withBullets).toBe("• One\n• Two");
    expect(stripListPrefixes(withBullets)).toBe("One\nTwo");
  });

  it("applies numbered lists", () => {
    expect(applyListPrefixes("A\nB\nC", "number")).toBe("1. A\n2. B\n3. C");
  });

  it("withListStyle toggles off when same style", () => {
    const base = createDefaultTextStyle("Line");
    const on = withListStyle(base, "bullet");
    expect(on.listStyle).toBe("bullet");
    expect(on.content).toBe("• Line");
    const off = withListStyle(on, "bullet");
    expect(off.listStyle).toBe("none");
    expect(off.content).toBe("Line");
  });
});

describe("toggleBold", () => {
  it("preserves other fields while flipping weight", () => {
    const base = normalizeTextStyle({
      content: "Promo",
      color: "#ff00aa",
      italic: true,
      fontWeight: 700,
    });
    const next = toggleBold(base);
    expect(next.fontWeight).toBe(400);
    expect(next.content).toBe("Promo");
    expect(next.color).toBe("#ff00aa");
    expect(next.italic).toBe(true);
    expect(toggleBold(next).fontWeight).toBe(700);
  });
});
