import { describe, expect, test } from "bun:test";
import { EMOTICONS, uwufy } from "../src/uwufy.ts";

describe("uwufy", () => {
  test("is deterministic and idempotent", () => {
    const source = "Really nice! The little cat is running. This is a good example.";
    const result = uwufy(source);
    expect(uwufy(source)).toBe(result);
    expect(uwufy(result)).toBe(result);
  });

  test("leaves fenced/inline code, URLs, paths, numbers and quoted errors exact", () => {
    const source = [
      "A really nice fix; see `really nice` and https://example.com/docs.",
      "Path: C:/work/src/file.ts; code 123 stays exact.",
      'The quoted error is "really nice".',
      "```ts",
      "const reallyNice = 'really nice';",
      "```",
    ].join("\n");
    const result = uwufy(source);
    for (const exact of [
      "`really nice`",
      "https://example.com/docs.",
      "C:/work/src/file.ts",
      "123",
      '"really nice"',
      "const reallyNice = 'really nice';",
    ]) expect(result).toContain(exact);
  });

  test("preserves critical warning and negation words", () => {
    const result = uwufy("Never ignore this warning; do not delete anything.");
    expect(result).toMatch(/Never/);
    expect(result).toMatch(/warning/);
    expect(result).toMatch(/not/);
  });

  test("uses a broad kaomoji set sourced from kaomoji.you", () => {
    expect(EMOTICONS.length).toBeGreaterThan(20);
    expect(EMOTICONS).toContain("٩(◕‿◕｡)۶");
    expect(EMOTICONS).toContain("(ฅ^•ﻌ•^ฅ)");
  });
});
