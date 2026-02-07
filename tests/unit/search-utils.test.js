import { describe, it, expect } from "vitest";
import {
  extractTokens,
  generateInitials,
  generateProgressiveInitials,
  generateStrictInitials,
  normalizeForSearch,
  detectSearchIntent,
  matchesInitials,
  matchesTokenPrefixes,
  scoreMatch,
} from "../../src/shared/search-utils.js";

// ---------------------------------------------------------------------------
// extractTokens
// ---------------------------------------------------------------------------

describe("extractTokens", () => {
  it("splits on spaces and lowercases", () => {
    expect(extractTokens("Lightning Bolt")).toEqual(["lightning", "bolt"]);
  });

  it("filters stop words", () => {
    expect(extractTokens("War of the Spark")).toEqual(["war", "spark"]);
  });

  it("splits on hyphens and dashes", () => {
    expect(extractTokens("Self-Assembler")).toEqual(["self", "assembler"]);
    expect(extractTokens("Thought–Knot")).toEqual(["thought", "knot"]);
  });

  it("handles empty string", () => {
    expect(extractTokens("")).toEqual([]);
  });

  it("filters all stop words", () => {
    expect(extractTokens("of the and a an for to in")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateInitials
// ---------------------------------------------------------------------------

describe("generateInitials", () => {
  it("returns first letter of each non-stop token", () => {
    expect(generateInitials("Lightning Bolt")).toBe("lb");
  });

  it("skips stop words", () => {
    expect(generateInitials("War of the Spark")).toBe("ws");
  });

  it("handles single word", () => {
    expect(generateInitials("Counterspell")).toBe("c");
  });

  it("handles hyphenated names", () => {
    expect(generateInitials("Thought-Knot Seer")).toBe("tks");
  });
});

// ---------------------------------------------------------------------------
// generateProgressiveInitials
// ---------------------------------------------------------------------------

describe("generateProgressiveInitials", () => {
  it("returns progressive substrings of initials", () => {
    expect(generateProgressiveInitials("Lightning Bolt")).toEqual(["l", "lb"]);
  });

  it("handles multi-word names", () => {
    const result = generateProgressiveInitials("Thought-Knot Seer");
    expect(result).toEqual(["t", "tk", "tks"]);
  });

  it("returns empty array for empty string", () => {
    expect(generateProgressiveInitials("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeForSearch
// ---------------------------------------------------------------------------

describe("normalizeForSearch", () => {
  it("lowercases and preserves hyphens", () => {
    expect(normalizeForSearch("Self-Assembler")).toBe("self-assembler");
  });

  it("removes apostrophes", () => {
    expect(normalizeForSearch("Jace's Ingenuity")).toBe("jaces ingenuity");
  });

  it("removes special characters", () => {
    expect(normalizeForSearch("Fire & Ice")).toBe("fire  ice");
  });

  it("trims whitespace", () => {
    expect(normalizeForSearch("  Bolt  ")).toBe("bolt");
  });
});

// ---------------------------------------------------------------------------
// detectSearchIntent
// ---------------------------------------------------------------------------

describe("detectSearchIntent", () => {
  it("detects empty query", () => {
    expect(detectSearchIntent("")).toMatchObject({ strategy: "empty" });
    expect(detectSearchIntent("   ")).toMatchObject({ strategy: "empty" });
  });

  it("detects pure initials (uppercase input)", () => {
    const result = detectSearchIntent("LB");
    expect(result.strategy).toBe("initials");
    expect(result.query).toBe("lb");
  });

  it("detects space-separated initials", () => {
    const result = detectSearchIntent("L B");
    expect(result.strategy).toBe("space_initials");
    expect(result.query).toBe("lb");
  });

  it("detects multi-token search", () => {
    const result = detectSearchIntent("lightning bolt");
    expect(result.strategy).toBe("multi_token");
    expect(result.tokens).toEqual(["lightning", "bolt"]);
    expect(result.firstToken).toBe("lightning");
  });

  it("detects prefix search for single lowercase word", () => {
    const result = detectSearchIntent("lig");
    expect(result.strategy).toBe("prefix");
    expect(result.query).toBe("lig");
  });
});

// ---------------------------------------------------------------------------
// matchesInitials
// ---------------------------------------------------------------------------

describe("matchesInitials", () => {
  it("matches exact initials", () => {
    expect(matchesInitials("lb", "lb", ["l", "lb"])).toBe(true);
  });

  it("matches progressive initials", () => {
    expect(matchesInitials("t", "tks", ["t", "tk", "tks"])).toBe(true);
  });

  it("rejects non-matching initials", () => {
    expect(matchesInitials("xx", "lb", ["l", "lb"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesTokenPrefixes
// ---------------------------------------------------------------------------

describe("matchesTokenPrefixes", () => {
  it("matches when all query tokens prefix card tokens", () => {
    expect(matchesTokenPrefixes(["lig", "bol"], ["lightning", "bolt"])).toBe(true);
  });

  it("rejects when a query token has no prefix match", () => {
    expect(matchesTokenPrefixes(["lig", "foo"], ["lightning", "bolt"])).toBe(false);
  });

  it("returns false for empty query tokens", () => {
    expect(matchesTokenPrefixes([], ["lightning", "bolt"])).toBe(false);
  });

  it("handles single-token query", () => {
    expect(matchesTokenPrefixes(["lig"], ["lightning", "bolt"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreMatch
// ---------------------------------------------------------------------------

describe("scoreMatch", () => {
  const makeCard = (name) => ({
    name,
    name_lower: name.toLowerCase(),
    name_normalized: name.toLowerCase(),
    search_normalized: normalizeForSearch(name),
    tokens: extractTokens(name),
    initials: generateInitials(name),
    progressive_initials: generateProgressiveInitials(name),
  });

  it("gives 0 for exact initials match", () => {
    const intent = { strategy: "initials", query: "lb" };
    const card = makeCard("Lightning Bolt");
    expect(scoreMatch(intent, card)).toBe(0);
  });

  it("gives higher score for non-exact initials", () => {
    const intent = { strategy: "initials", query: "xx" };
    const card = makeCard("Lightning Bolt");
    expect(scoreMatch(intent, card)).toBe(100);
  });

  it("scores prefix match at position 0 as 0", () => {
    const intent = { strategy: "prefix", query: "lightning" };
    const card = makeCard("Lightning Bolt");
    expect(scoreMatch(intent, card)).toBe(0);
  });

  it("handles multi_token scoring", () => {
    const intent = {
      strategy: "multi_token",
      query: "lig bol",
      tokens: ["lig", "bol"],
    };
    const card = makeCard("Lightning Bolt");
    const score = scoreMatch(intent, card);
    expect(score).toBeLessThan(1000);
  });

  it("falls back gracefully for cards missing search fields", () => {
    const intent = { strategy: "initials", query: "lb" };
    const card = { name: "Lightning Bolt", name_normalized: "lightning bolt" };
    // No tokens/initials fields — should still return a score
    const score = scoreMatch(intent, card);
    expect(typeof score).toBe("number");
  });
});
