import { describe, expect, test } from "bun:test";
import { EMOTICONS, uwufy, uwufyProse, type UwuLevel, type UwuLocale, type UwuOptions } from "../src/uwufy.ts";

const LEVELS: UwuLevel[] = ["low", "mid", "max"];
const LOCALES: UwuLocale[] = ["auto", "en", "tr"];
const TURKISH_CRITICAL_WORDS = [
  "değil", "değilim", "değilsiniz", "değildi", "değilmiş", "değilse", "değilken",
  "yok", "yoktu", "yokmuş", "yoktur", "yoksun", "yokuz", "yokluğu",
  "hata", "hatalar", "hataları", "hatam", "hatamız", "hatanız", "hatası",
  "hatasını", "hatasında", "hatasından", "hataya", "hatayı", "hatanın",
  "hatayla", "hatalı", "hatasız", "hatadır", "hataydı", "hataymış", "hatalıdır", "hatalısınız",
  "uyarı", "uyarılar", "uyarıları", "uyarılarınızı", "uyarımı", "uyarının",
  "uyarıya", "uyarıyı", "uyarısıyla", "uyarıdır", "uyarıydı", "uyarıymış",
  "sil", "silin", "siliniz", "siler", "sileceğim", "sildim", "siliyor",
  "silme", "silmeyin", "silmeyiniz", "silmedim", "silmez", "silmiyorum",
  "silmesin", "silmemelisin", "silinmesin", "silemezsin",
  "hayır", "asla", "hiç", "hiçbir", "sakın",
];

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

describe("uwufy options", () => {
  test("defaults remain mid intensity and auto locale", () => {
    const source = "Really nice! The little cat is running. This is a good example.";
    expect(uwufy(source)).toBe(uwufy(source, { level: "mid", locale: "auto" }));
    expect(uwufy(source, {})).toBe(uwufy(source));
    expect(uwufy(source, { level: "mid" })).toBe(uwufy(source));
    expect(uwufy(source, { locale: "auto" })).toBe(uwufy(source));
    expect(uwufyProse(source)).toBe(uwufyProse(source, { level: "mid", locale: "auto" }));
    expect(uwufyProse("değil yok hata uyarı sil")).toBe("değil yok hata uyarı sil");
  });

  test("mid retains the original unconditional r/l rewrite", () => {
    expect(uwufy("# really little rural", { level: "mid" })).toBe("# weawwy wittwe wuwaw");
    expect(uwufyProse("really little rural", { level: "mid" })).toBe("weawwy wittwe wuwaw");
  });

  test("low softens r/l and increasing intensity raises th/ny frequencies", () => {
    const rlCounts = LEVELS.map((level) =>
      (uwufyProse("really ".repeat(200), { level }).match(/\bweawwy\b/g) ?? []).length);
    expect(rlCounts[0]).toBeGreaterThan(0);
    expect(rlCounts[0]).toBeLessThan(200);
    expect(rlCounts[1]).toBe(200);
    expect(rlCounts[2]).toBe(200);

    for (const [word, changed] of [["the", /\bde\b/g], ["name", /\bnyame\b/g]] as const) {
      const counts = LEVELS.map((level) =>
        (uwufyProse(`${word} `.repeat(200), { level }).match(changed) ?? []).length);
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[1]).toBeGreaterThan(counts[0]!);
      expect(counts[2]).toBeGreaterThan(counts[1]!);
      expect(counts[2]).toBeLessThan(200);
    }
  });

  test("higher intensities increase stutters and sentence decorations", () => {
    const results = LEVELS.map((level) => uwufy("Really! ".repeat(200), { level }));
    const stutters = results.map((result) => (result.match(/\b([RW])-\1/g) ?? []).length);
    const decorations = results.map((result) =>
      EMOTICONS.reduce((count, emoticon) => count + result.split(emoticon).length - 1, 0));
    expect(stutters[0]).toBeGreaterThan(0);
    expect(stutters[1]).toBeGreaterThan(stutters[0]!);
    expect(stutters[2]).toBeGreaterThan(stutters[1]!);
    expect(decorations[0]).toBeGreaterThan(0);
    expect(decorations[1]).toBeGreaterThan(decorations[0]!);
    expect(decorations[2]).toBeGreaterThan(decorations[1]!);
  });

  for (const level of LEVELS) {
    for (const locale of LOCALES) {
      test(`is deterministic and idempotent at ${level}/${locale}`, () => {
        const options: UwuOptions = { level, locale };
        const source = [
          "Really nice! The little cat is running. This is a good example.",
          "We're really here and they're nearly ready. Don't ignore the warning.",
          "değil yok hataları uyarılarınızı silmeyin; really clear.",
          "",
          "# Really lovely",
          "- The little animal is near.",
          "| Really | nearly |",
          "Read 'we're really ready' and ‘they’re nearly here’.",
          "See `really nice` and [really](https://example.com/really).",
          "C:/really/file.ts /really/file.ts ./really.txt 1.23 --really camelCase NASA",
          "",
          "```ts",
          "const reallyNice = 'really nice';",
          "```",
        ].join("\n");
        for (const rewrite of [uwufy, uwufyProse]) {
          const result = rewrite(source, options);
          expect(rewrite(source, options)).toBe(result);
          expect(rewrite(result, options)).toBe(result);
        }
      });

      test(`preserves existing kaomoji and generated decorations at ${level}/${locale}`, () => {
        const options = { level, locale };
        const source = `Really! ${EMOTICONS.join(" ")} Really! The little animal is near.`;
        const result = uwufy(source, options);
        for (const emoticon of EMOTICONS) expect(result).toContain(emoticon);
        expect(uwufy(result, options)).toBe(result);
        const decorated = uwufy("Really nice! The little animal is near. ".repeat(120), options);
        expect(uwufy(decorated, options)).toBe(decorated);
      });
    }
  }
});

describe("quoted spans and contractions", () => {
  test("preserves all quote delimiters, including contractions inside quoted spans", () => {
    const quotes = [
      '"really little"', "“really little”", "'really little'", "‘really little’",
      "'we're really ready'", "‘we’re really ready’",
      "'don't really run'", "‘don’t really run’",
      "'they're nearly here'", "‘they’re nearly here’",
    ];
    const source = `Really read ${quotes.join(", ")} then really return.`;
    for (const level of LEVELS) {
      for (const rewrite of [uwufy, uwufyProse]) {
        const result = rewrite(source, { level });
        for (const quote of quotes) expect(result).toContain(quote);
        expect(rewrite(result, { level })).toBe(result);
      }
    }
  });

  test("does not mistake unquoted contraction apostrophes for span delimiters", () => {
    const source = "we're really here and they're really ready; we’re really here and they’re really ready";
    const result = uwufyProse(source, { level: "mid", locale: "en" });
    expect(result).toContain("we'we weawwy hewe");
    expect(result).toContain("they'we weawwy weady");
    expect(result).toContain("we’we weawwy hewe");
    expect(result).toContain("they’we weawwy weady");
    expect(uwufyProse(result, { level: "mid", locale: "en" })).toBe(result);
  });

  test("does not pair contractions around a real quoted span", () => {
    const source = "we're 'really little' and they're ‘really little’ really ready";
    const result = uwufyProse(source);
    expect(result).toContain("we'we 'really little'");
    expect(result).toContain("they'we ‘really little’ weawwy weady");
  });

  test("preserves English negative contractions in every locale", () => {
    const words = ["can't", "don't", "doesn't", "wouldn't", "aren't", "weren't", "couldn't",
      "can’t", "don’t", "doesn’t", "wouldn’t", "aren’t", "weren’t", "couldn’t"];
    const source = words.join(" ");
    for (const level of LEVELS) {
      for (const locale of LOCALES) {
        expect(uwufyProse(source, { level, locale })).toBe(source);
      }
    }
  });
});

describe("Turkish critical words", () => {
  for (const locale of ["auto", "tr"] as const) {
    for (const level of LEVELS) {
      test(`preserves meaningful inflections and negations at ${level}/${locale}`, () => {
        const source = TURKISH_CRITICAL_WORDS.join(" ");
        expect(uwufyProse(source, { level, locale })).toBe(source);
        expect(uwufy(source, { level, locale })).toBe(source);
      });
    }

    test(`uses Turkish case folding without changing original bytes in ${locale}`, () => {
      const words = TURKISH_CRITICAL_WORDS.flatMap((word) => [
        word.toLocaleUpperCase("tr"),
        word[0]!.toLocaleUpperCase("tr") + word.slice(1),
        word.normalize("NFD"),
      ]);
      // Uppercase prefixes followed by lowercase avoid the acronym/camelCase
      // guards, so dotted İ must actually be folded with Turkish rules.
      words.push("Sİl", "Sİlin", "Sİlme", "Hİç", "UYArı", "DEĞİl", "YOk");
      const source = words.join(" ");
      expect(uwufyProse(source, { level: "max", locale })).toBe(source);
      expect(uwufy(source, { level: "max", locale })).toBe(source);
    });
  }

  test("English locale disables Turkish guards while auto/tr keep them", () => {
    const source = "değil uyarı sil";
    expect(uwufyProse(source, { locale: "en" })).toBe("değiw uyawı siw");
    expect(uwufyProse(source, { locale: "auto" })).toBe(source);
    expect(uwufyProse(source, { locale: "tr" })).toBe(source);
  });

  test("keeps English safety words even with Turkish locale", () => {
    const source = "no not nor never none nothing nowhere neither cannot warning caution danger dangerous careful irreversible destructive error errors fail fails failed failure";
    for (const level of LEVELS) {
      expect(uwufyProse(source, { level, locale: "tr" })).toBe(source);
      expect(uwufy(source, { level, locale: "tr" })).toBe(source);
    }
  });

  test("still rewrites ordinary Turkish prose outside guarded word families", () => {
    expect(uwufyProse("merhaba güzel", { locale: "tr" })).toBe("mewhaba güzew");
  });
});

describe("uwufyProse", () => {
  test("never adds stutters, emoticons, new whitespace or sentence punctuation", () => {
    const source = "Really little! The animal is near. Really lovely? ".repeat(120);
    for (const level of LEVELS) {
      for (const locale of LOCALES) {
        const options = { level, locale };
        const result = uwufyProse(source, options);
        expect(result).not.toBe(source);
        expect(result).not.toMatch(/(\p{L})-\1/iu);
        for (const emoticon of EMOTICONS) expect(result).not.toContain(emoticon);
        expect(result.match(/\s+/g)).toEqual(source.match(/\s+/g));
        expect(result.match(/[.!?]/g)).toEqual(source.match(/[.!?]/g));
        expect(uwufyProse(result, options)).toBe(result);
      }
    }
  });

  test("keeps technical surfaces exact in prose runs", () => {
    const exact = [
      "`really little`", "https://example.com/really", "www.example.com/really",
      "C:/really/file.ts", "/really/file.ts", "./really/file.ts",
      "123", "1.23", "-12", "1e3", "really.txt", "really_snake", "reallyNice", "NASA", "--really", "-really",
      "'really little'", "‘really little’", '"really little"', "“really little”",
      '<span title="really">', "</span>", "](https://example.com/really)",
    ];
    const source = `Really little ${exact.join(" ")} really little`;
    for (const level of LEVELS) {
      const result = uwufyProse(source, { level });
      for (const surface of exact) expect(result).toContain(surface);
      expect(uwufyProse(result, { level })).toBe(result);
      expect(uwufyProse("really `really little", { level })).toContain("`really little");
    }
  });

  test("retains block-level code, math, HTML and link definitions", () => {
    const blocks = [
      "```ts\nconst reallyNice = 'really little';\n```",
      "~~~\nreally little\n~~~",
      "    really little\n\treally little",
      "$$\nreally little\n$$",
      "$$ really little $$",
      '<div title="really little">really little</div>',
      '[really]: https://example.com/really "really little"',
    ];
    const source = blocks.join("\n\n");
    for (const level of LEVELS) {
      expect(uwufy(source, { level })).toBe(source);
      expect(uwufyProse(source, { level })).toBe(source);
    }
  });

  test("keeps pre-existing decorations rather than removing them", () => {
    const source = `really ${EMOTICONS.join(" ")} w-weawwy`;
    const result = uwufyProse(source, { level: "max" });
    for (const emoticon of EMOTICONS) expect(result).toContain(emoticon);
    expect(result).toContain("w-weawwy");
    expect(uwufyProse(result, { level: "max" })).toBe(result);
  });

  test("has stable per-run positions and handles empty input", () => {
    for (const level of LEVELS) {
      const options = { level };
      expect(uwufy("", options)).toBe("");
      expect(uwufyProse("", options)).toBe("");
      expect(uwufyProse(" \n\t", options)).toBe(" \n\t");
      const run = "The little animal is near.";
      expect(uwufyProse(run, options)).toBe(uwufyProse(run, options));
    }
  });
});
