import { describe, it, expect } from "vitest";
import { normalizeCardName, extractVariantTags } from "../../src/shared/card-name-utils.js";

// ---------------------------------------------------------------------------
// normalizeCardName
// ---------------------------------------------------------------------------

describe("normalizeCardName", () => {
  it("returns a simple name unchanged", () => {
    expect(normalizeCardName("Lightning Bolt")).toBe("Lightning Bolt");
  });

  it("takes front face of double-faced cards", () => {
    expect(normalizeCardName("Delver of Secrets // Insectile Aberration")).toBe(
      "Delver of Secrets"
    );
  });

  it("normalizes emblem names", () => {
    expect(normalizeCardName("Emblem - Liliana")).toBe("Liliana Emblem");
  });

  it("strips Borderless parenthetical", () => {
    expect(normalizeCardName("Lightning Bolt (Borderless)")).toBe("Lightning Bolt");
  });

  it("strips Extended Art parenthetical", () => {
    expect(normalizeCardName("Sheoldred (Extended Art)")).toBe("Sheoldred");
  });

  it("strips Showcase parenthetical", () => {
    expect(normalizeCardName("Omnath (Showcase)")).toBe("Omnath");
  });

  it("strips Foil Etched parenthetical", () => {
    expect(normalizeCardName("Ragavan (Foil Etched)")).toBe("Ragavan");
  });

  it("strips numeric collector number parenthetical", () => {
    expect(normalizeCardName("Lightning Bolt (265)")).toBe("Lightning Bolt");
    expect(normalizeCardName("Lightning Bolt (0280)")).toBe("Lightning Bolt");
  });

  it("strips fraction parenthetical", () => {
    expect(normalizeCardName("Token (15/81)")).toBe("Token");
  });

  it("strips Token suffix", () => {
    expect(normalizeCardName("Goblin Token")).toBe("Goblin");
  });

  it("handles multiple parentheticals", () => {
    expect(
      normalizeCardName("Ragavan (Foil Etched) (Borderless)")
    ).toBe("Ragavan");
  });

  it("trims whitespace", () => {
    expect(normalizeCardName("  Bolt  ")).toBe("Bolt");
  });
});

// ---------------------------------------------------------------------------
// extractVariantTags
// ---------------------------------------------------------------------------

describe("extractVariantTags", () => {
  it("returns empty tags for simple name", () => {
    const { tags, isFoilVariant } = extractVariantTags("Lightning Bolt");
    expect(tags).toEqual([]);
    expect(isFoilVariant).toBe(false);
  });

  it("extracts Borderless tag", () => {
    const { tags } = extractVariantTags("Lightning Bolt (Borderless)");
    expect(tags).toContain("Borderless");
  });

  it("extracts Showcase tag", () => {
    const { tags } = extractVariantTags("Omnath (Showcase)");
    expect(tags).toContain("Showcase");
  });

  it("extracts Foil Etched and marks as foil variant", () => {
    const { tags, isFoilVariant } = extractVariantTags("Ragavan (Foil Etched)");
    expect(tags).toContain("Foil Etched");
    expect(isFoilVariant).toBe(true);
  });

  it("marks Surge Foil as foil variant", () => {
    const { isFoilVariant } = extractVariantTags("Card (Surge Foil)");
    expect(isFoilVariant).toBe(true);
  });

  it("marks Galaxy Foil as foil variant", () => {
    const { isFoilVariant } = extractVariantTags("Card (Galaxy Foil)");
    expect(isFoilVariant).toBe(true);
  });

  it("skips numeric parentheticals", () => {
    const { tags } = extractVariantTags("Bolt (265)");
    expect(tags).toEqual([]);
  });

  it("skips fraction parentheticals", () => {
    const { tags } = extractVariantTags("Token (15/81)");
    expect(tags).toEqual([]);
  });

  it("extracts multiple tags", () => {
    const { tags } = extractVariantTags("Card (Borderless) (Foil Etched)");
    expect(tags).toContain("Borderless");
    expect(tags).toContain("Foil Etched");
  });

  it("detects Neon Ink variants", () => {
    const { tags } = extractVariantTags("Card Neon Red something");
    expect(tags.some((t) => t.includes("Neon Red"))).toBe(true);
  });
});
