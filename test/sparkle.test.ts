import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Container, getMarkdownTheme, Markdown, visibleWidth } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "@oh-my-pi/pi-tui/chat/assistant-message";
import type { NativeNode } from "@oh-my-pi/pi-tui/native/node";
import { getThemeByName, Theme } from "@oh-my-pi/pi-coding-agent";
import { buildKawaiiTheme, KawaiiTheme } from "../src/kawaii.ts";
import { installSparkles, sparkle, sparkleMarks, type Paint, type SparkleInstallation } from "../src/sparkle.ts";
import { type UwuLevel, uwufy, uwufyMarkdownProse, uwufyProse } from "../src/uwufy.ts";

/** Visible paint so assertions can see exactly what was colored. */
const bracket: Paint = (tone, text) => `[${tone}:${text}]`;
const painted = (text: string) => [...sparkle(text, bracket).matchAll(/\[\w+:([^\]]*)\]/g)].map((m) => m[1]);

/** A distinctive SGR color no omp theme uses, to spot sparkles in real renders. */
const MARK = "\x1b[38;2;1;2;3m";
const ansiPaint: Paint = (_tone, text) => `${MARK}${text}\x1b[39m`;

const message = (text: string) =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  }) as never;

function nativeMd(root: NativeNode, key = "t0") {
  const child = root.c?.find((child) => "k" in child && child.key === key);
  if (!child || !("k" in child) || child.k !== "md") throw new Error(`Missing native Markdown ${key}`);
  return child;
}

describe("sparkle", () => {
  test("paints uwu per letter and kaomoji/symbols as one tone", () => {
    const out = sparkle("hewwo uwu (◕ᴗ◕✿) ☆", bracket);
    expect(painted("hewwo uwu (◕ᴗ◕✿) ☆")).toEqual(["u", "w", "u", "(◕ᴗ◕✿)", "☆"]);
    expect(out.replace(/\[\w+:([^\]]*)\]/g, "$1")).toBe("hewwo uwu (◕ᴗ◕✿) ☆");
  });

  test("paints unlisted kaomoji and known ASCII emoticons at word edges", () => {
    expect(painted("done ʕ•ᴥ•ʔ nope, but (｡◕‿◕｡) yes >w< :3")).toEqual(["(｡◕‿◕｡)", ">w<", ":3"]);
    expect(painted("fixed it (ﾉ◕ヮ◕)ﾉ")).toEqual(["(ﾉ◕ヮ◕)ﾉ"]);
    expect(painted("yay ヽ(・∀・)ﾉ done")).toEqual(["ヽ(・∀・)ﾉ"]);
  });

  test("leaves prose, math, numbers and look-alikes plain", () => {
    for (const text of [
      "a:3 ratio", "owowl", "(şimdi)", "(≥ 3)", "(see “docs”)", "x^^y", "こんにちは (テスト)",
      "(x−y)", "(a—b)", "ş(a…)ı", "ş(◕‿◕)ı", "❤️ ♡️", "☆\u0301\uFE0F",
    ]) {
      expect(painted(text)).toEqual([]);
    }
  });

  test("keeps combining marks with the symbol they decorate", () => {
    expect(painted("wish ☆\u0301 granted")).toEqual(["☆\u0301"]);
  });

  test("the kawaii theme restores an enclosing color after a nested span", async () => {
    const base = (await getThemeByName("dark")) as Theme;
    const kawaii = buildKawaiiTheme(Theme, base);
    const heading = kawaii.fg("mdHeading", `hi ${kawaii.fg("accent", "u")} there`);
    const open = kawaii.getFgAnsi("mdHeading");
    expect(heading).toBe(`${open}hi ${kawaii.getFgAnsi("accent")}u${open} there\x1b[39m`);
  });

  test("the working cat keeps text aligned and leaves compact tool spinners unchanged", async () => {
    const original = (await getThemeByName("dark")) as Theme;
    const expectedActivity = buildKawaiiTheme(Theme, original).getSpinnerFrames("activity");
    for (const preset of ["unicode", "nerd", "ascii"] as const) {
      const base = new Theme({} as ConstructorParameters<typeof Theme>[0], {} as ConstructorParameters<typeof Theme>[1], original.getColorMode(), preset, {});
      const originalActivity = [...base.getSpinnerFrames("activity")];
      const kawaii = buildKawaiiTheme(Theme, base);
      const frames = kawaii.getSpinnerFrames("activity");
      expect(new Set(frames.map(visibleWidth)).size).toBe(1);
      expect(new Set(frames).size).toBeGreaterThan(1);
      expect(new Set(frames.map((frame) => frame.search(/\S/))).size).toBeGreaterThan(1);
      expect(frames.every((frame) => !/[\r\n\x1b]/.test(frame))).toBe(true);
      expect(frames).not.toEqual(base.getSpinnerFrames("activity"));
      expect(kawaii.getSpinnerFrames("status")).toEqual(base.getSpinnerFrames("status"));
      expect(base.getSpinnerFrames("activity")).toEqual(originalActivity);
      expect(frames).toEqual(expectedActivity);
    }
  });

  test("turning kawaii off restores the user's theme and custom activity spinner", async () => {
    const original = (await getThemeByName("dark")) as Theme;
    const base = new Theme({} as ConstructorParameters<typeof Theme>[0], {} as ConstructorParameters<typeof Theme>[1], original.getColorMode(), "unicode", {}, { activity: ["a", "b"] });
    let current = base;
    const overlay = new KawaiiTheme({ Theme, setThemeInstance: (theme) => { current = theme; } });
    overlay.enable(current);
    expect(current.getSpinnerFrames("activity")).not.toEqual(["a", "b"]);
    overlay.disable(current);
    expect(current).toBe(base);
    expect(current.getSpinnerFrames("activity")).toEqual(["a", "b"]);
  });

  test("is deterministic and never changes visible text", () => {
    const text = uwufy("This is really nice. That was a lovely fix. The tests all pass now!");
    expect(sparkle(text, bracket)).toBe(sparkle(text, bracket));
    expect(sparkle(text, ansiPaint).replaceAll(MARK, "").replaceAll("\x1b[39m", "")).toBe(text);
  });

  test("native marks are distinct, stable semantic colors and skip short ASCII tokens", () => {
    const marks = sparkleMarks("uwu uwu owo (◕ᴗ◕✿) ☆ :3 :) :D <3 x3 ^^ >w<");
    expect(marks.map(({ t }) => t)).toEqual(["uwu", "owo", "(◕ᴗ◕✿)", "☆", ">w<"]);
    expect(marks.find(({ t }) => t === "uwu")).toEqual(sparkleMarks("☆ uwu")[1]);
    expect(marks.every(({ s }) => ["accent", "mdLink", "mdCode", "mdListBullet", "mdHeading", "thinkingText"].includes(s))).toBe(true);
    expect(JSON.stringify(marks)).not.toContain("\x1b");
    expect(sparkleMarks("owowl a:3 x^^y")).toEqual([]);
  });
});

describe("installSparkles on omp's AssistantMessageComponent", () => {
  let active: boolean;
  let installation: SparkleInstallation;
  let originalAddChild: typeof Container.prototype.addChild;
  let originalDescribe: typeof AssistantMessageComponent.prototype.describe;
  beforeEach(() => {
    active = true;
    originalAddChild = Container.prototype.addChild;
    originalDescribe = AssistantMessageComponent.prototype.describe;
    installation = installSparkles(Container, {
      isActive: () => active,
      transform: (text) => sparkle(text, ansiPaint),
      native: (text) => ({ text, marks: sparkleMarks(text) }),
    });
  });
  afterEach(() => installation.dispose());

  test("finds the component through its Container base, then stops watching", () => {
    expect(Container.prototype.addChild).not.toBe(originalAddChild);
    active = true;
    // A constructor-time message is painted: discovery happens before its first update.
    const component = new AssistantMessageComponent(message("hewwo uwu"));
    expect(Container.prototype.addChild).toBe(originalAddChild);
    expect(component.render(80).join("\n")).toContain(MARK);
  });
  const render = (component: AssistantMessageComponent) => component.render(80).join("\n");
  const body = "hewwo uwu (◕ᴗ◕✿) and `uwu` stays code\n\n```\nuwu (◕ᴗ◕✿)\n```";

  test("paints prose only, never inline code or code blocks", () => {
    active = true;
    const component = new AssistantMessageComponent();
    component.updateContent(message(body));
    const rows = render(component);
    // u, w, u and the kaomoji in prose: four painted spans, nothing from code.
    expect(rows.split(MARK).length - 1).toBe(4);
  });

  test("toggling off repaints plain on the next update", () => {
    active = true;
    const component = new AssistantMessageComponent();
    component.updateContent(message(body));
    expect(render(component)).toContain(MARK);
    active = false;
    component.invalidate();
    expect(render(component)).not.toContain(MARK);
  });

  test("a host-set transform wins over sparkles", () => {
    active = true;
    const component = new AssistantMessageComponent();
    component.setTextColorTransform((text) => text.toUpperCase());
    component.updateContent(message("hewwo uwu"));
    const rows = render(component);
    expect(rows).toContain("HEWWO UWU");
    expect(rows).not.toContain(MARK);
  });

  test("refresh invalidates already-rendered components without a theme change", () => {
    const component = new AssistantMessageComponent(message(body));
    expect(render(component)).toContain(MARK);
    active = false;
    installation.refresh();
    expect(render(component)).not.toContain(MARK);
    active = true;
    installation.refresh();
    expect(render(component)).toContain(MARK);
  });

  test("reload replaces controls without double-patching and invalidates cached rows", () => {
    const component = new AssistantMessageComponent(message("really lovely"));
    const patched = AssistantMessageComponent.prototype.updateContent;
    installation = installSparkles(Container, {
      isActive: () => true,
      transform: (text) => uwufyProse(text),
      native: (text) => ({ text: uwufyMarkdownProse(text), marks: [] }),
    });
    expect(AssistantMessageComponent.prototype.updateContent).toBe(patched);
    expect(Bun.stripANSI(render(component))).toContain("weawwy wovewy");
  });

  test("display prose composes with sparkles but never changes inline/fenced code or raw messages", () => {
    const runs: string[] = [];
    installation = installSparkles(Container, {
      isActive: () => true,
      transform: (text) => { runs.push(text); return sparkle(uwufyProse(text), ansiPaint); },
      native: (text) => { const prose = uwufyMarkdownProse(text); return { text: prose, marks: sparkleMarks(prose) }; },
    });
    const text = 'really lovely uwu and `really` stays code\n\n```\nconst really = "lovely";\nuwu\n```';
    const raw = message(text);
    const original = JSON.stringify(raw);
    const component = new AssistantMessageComponent(raw);
    const rows = component.render(80);
    const plain = Bun.stripANSI(rows.join("\n"));
    expect(plain).toContain("weawwy wovewy");
    expect(plain).toContain("really");
    expect(plain).toContain('const really = "lovely";');
    expect(rows.join("\n").split(MARK).length - 1).toBe(3);
    expect(runs).not.toContain("really");
    expect(runs.some((run) => run.includes('const really = "lovely";'))).toBe(false);
    expect(JSON.stringify(raw)).toBe(original);
  });

  test("real Markdown wraps transformed, length-expanded prose rather than raw text", () => {
    const raw = "northern nature normal nearby really lovely flowers";
    const options = { level: "max" as const };
    const transformed = uwufyProse(raw, options);
    expect(transformed.length).toBeGreaterThan(raw.length);
    for (const width of [12, 18, 24]) {
      const md = new Markdown(raw, 0, 0, getMarkdownTheme(), { color: (run) => uwufyProse(run, options) });
      const expected = new Markdown(transformed, 0, 0, getMarkdownTheme());
      expect(md.render(width).map(Bun.stripANSI)).toEqual(expected.render(width).map(Bun.stripANSI));
      expect(md.render(width).every((row) => visibleWidth(row) <= width)).toBe(true);
    }
  });

  test("colors-off display intensity refreshes a narrow-width Assistant render", () => {
    let level: UwuLevel = "mid";
    installation = installSparkles(Container, {
      isActive: () => true,
      transform: (run) => uwufyProse(run, { level }),
      native: (text) => ({ text: uwufyMarkdownProse(text, { level }), marks: [] }),
    });
    const text = "really lovely northern nature normal nearby flowers";
    const raw = message(text);
    const original = JSON.stringify(raw);
    const component = new AssistantMessageComponent(raw);
    const mid = component.render(18).map(Bun.stripANSI);
    level = "low";
    installation.refresh();
    const low = component.render(18).map(Bun.stripANSI);
    expect(low).not.toEqual(mid);
    expect(low.every((row) => visibleWidth(row) <= 18)).toBe(true);
    level = "max";
    installation.refresh();
    expect(component.render(18).map(Bun.stripANSI)).not.toEqual(low);
    expect(JSON.stringify(raw)).toBe(original);
    component.setTextColorTransform((run) => run.toUpperCase());
    installation.refresh();
    expect(Bun.stripANSI(component.render(80).join("\n"))).toContain(text.toUpperCase());
    component.setTextColorTransform(undefined);
    installation.refresh();
    expect(Bun.stripANSI(component.render(80).join("\n"))).toContain(uwufyProse(text, { level }));
  });

  test("native display decorates copies with semantic marks, preserving code, URLs and raw messages", () => {
    installation = installSparkles(Container, {
      isActive: () => active,
      transform: (text) => sparkle(uwufyProse(text), ansiPaint),
      native: (text) => { const prose = uwufyMarkdownProse(text); return { text: prose, marks: sparkleMarks(prose) }; },
    });
    const text = "really lovely uwu (◕ᴗ◕✿) owo ☆ and `uwu` stays code :3\n\n```\nuwu (◕ᴗ◕✿)\n```\nhttps://example.com/really";
    const raw = message(text);
    const original = JSON.stringify(raw);
    const component = new AssistantMessageComponent(raw);
    const source = originalDescribe.call(component);
    const sourceJson = JSON.stringify(source);
    const description = component.describe();
    const md = nativeMd(description);
    expect(installation.isNativeSupported()).toBe(true);
    expect(md.p?.text).toBe(uwufyMarkdownProse(text));
    expect(md.p?.text).toContain("`uwu`");
    expect(md.p?.text).toContain("```\nuwu (◕ᴗ◕✿)\n```");
    expect(md.p?.text).toContain("https://example.com/really");
    expect(md.p?.marks).toEqual(sparkleMarks(uwufyMarkdownProse(text)));
    expect(md.p?.marks?.some(({ t }) => t === ":3")).toBe(false);
    expect(JSON.stringify(description)).not.toContain("\\u001b");
    expect(description).not.toBe(source);
    expect(JSON.stringify(source)).toBe(sourceJson);
    expect(JSON.stringify(raw)).toBe(original);
    expect(component.describe()).toBe(description);
  });

  for (const colors of [false, true]) {
    test(`native display preserves container fences and multiline code with colors ${colors ? "on" : "off"}`, () => {
      installation = installSparkles(Container, {
        isActive: () => active,
        transform: (text) => uwufyProse(text),
        native: (text) => { const prose = uwufyMarkdownProse(text); return { text: prose, marks: colors ? sparkleMarks(prose) : [] }; },
      });
      const codeBlocks = [
        "- -\t> ~~~\n    > really world\n    > ~~~",
        "> ```\n> hello really world\n> ```",
        "> ~~~\n> really lovely\n> ~~~",
        "- ```\n  hello really world\n  ```",
        "> - ```\n>   hello really world\n>   ```",
        "- > ~~~\n  > really lovely\n  > ~~~",
        "- intro\n\n  ~~~\n  hello really world\n  ~~~",
        "-\n  ~~~\n  hello really world\n  ~~~",
        "    hello really world\n    really lovely",
        ">     hello really world\n>     really lovely",
        "- item\n\n      hello really world\n      really lovely",
        "````\nhello really world\n```\nreally lovely\n````",
      ];
      const spans = [
        "`code\nreally world\ncode`",
        "``code ` literal\nreally world\ncode``",
        "```code``\nreally world\ncode```",
      ];
      for (const protectedSource of [...codeBlocks, ...spans]) {
        const isSpan = spans.includes(protectedSource);
        const text = isSpan ? `Hello ${protectedSource} really lovely uwu.` : `Hello really lovely uwu.\n\n${protectedSource}\n\nreally lovely uwu.`;
        const raw = message(text);
        const original = JSON.stringify(raw);
        const component = new AssistantMessageComponent(raw);
        const description = component.describe();
        const md = nativeMd(description);
        const paragraphBreak = protectedSource.indexOf("\n\n");
        const protectedCode = paragraphBreak === -1 ? protectedSource : protectedSource.slice(paragraphBreak + 2);
        expect(md.p?.text).toContain(protectedCode);
        if (protectedSource.startsWith("- intro\n")) expect(md.p?.text).toContain("- intwo");
        expect(md.p?.text).toContain("weawwy wovewy");
        expect(md.p?.text).not.toBe(text);
        if (colors) expect(md.p?.marks).toEqual(sparkleMarks(md.p?.text ?? ""));
        else expect(Object.hasOwn(md.p!, "marks")).toBe(false);
        expect(JSON.stringify(description)).not.toContain("\\u001b");
        expect(JSON.stringify(raw)).toBe(original);
        expect(component.describe()).toBe(description);
      }
    });

    test(`native streaming protects unfinished code until closure with colors ${colors ? "on" : "off"}`, () => {
      installation = installSparkles(Container, {
        isActive: () => active,
        transform: (text) => uwufyProse(text),
        native: (text) => { const prose = uwufyMarkdownProse(text); return { text: prose, marks: colors ? sparkleMarks(prose) : [] }; },
      });
      for (const [unfinished, closure] of [
        ["> ```\n> really world", "\n> ```"],
        ["> ~~~\n> really world", "\n> ~~~"],
        ["- ```\n  really world", "\n  ```"],
        ["`code\nreally world", "\ncode`"],
        ["``code ` literal\nreally world", "\ncode``"],
      ]) {
        const initial = `Hello really lovely uwu.\n\n${unfinished}`;
        const component = new AssistantMessageComponent(message(initial));
        const first = component.describe();
        expect(nativeMd(first).p?.text).toContain(unfinished!);
        expect(nativeMd(first).p?.text).toContain("weawwy wovewy");
        const completed = `${initial}${closure}\n\nreally lovely uwu.`;
        const raw = message(completed);
        component.updateContent(raw, { transient: true });
        const next = component.describe();
        expect(nativeMd(next).p?.text).toContain(`${unfinished}${closure}`);
        expect(nativeMd(next).p?.text).toEndWith("weawwy wovewy uwu.");
        expect(next).not.toBe(first);
        expect(JSON.stringify(raw)).toBe(JSON.stringify(message(completed)));
        if (colors) expect(nativeMd(next).p?.marks).toEqual(sparkleMarks(nativeMd(next).p?.text ?? ""));
        else expect(Object.hasOwn(nativeMd(next).p!, "marks")).toBe(false);
      }
    });
  }

  test("native source ranges retain lexical protection and rewrite prose after container exit", () => {
    installation = installSparkles(Container, {
      isActive: () => active,
      transform: (text) => uwufyProse(text),
      native: (text) => ({ text: uwufyMarkdownProse(text), marks: [] }),
    });
    for (const protectedSource of [
      "> ```\n> really world\n",
      "- item\n\n  ~~~\n  really world\n",
      "-\n  ~~~\n  really world\n",
      "$$ really little $$",
      "$$\nreally ` world\n$$",
      '"really `code` little"',
      "'really `code` little'",
      "“really `code` little”",
      '"hello `code" text\nreally world\ncode` goodbye',
      '<span title="`">hello `code\nreally world\ncode`',
    ]) {
      const text = `${protectedSource}\n\nreally lovely uwu.`;
      const component = new AssistantMessageComponent(message(text));
      const prose = nativeMd(component.describe()).p?.text;
      expect(prose).toContain(protectedSource);
      expect(prose).toEndWith("weawwy wovewy uwu.");
    }
    const component = new AssistantMessageComponent(message("hello `code`    really world"));
    expect(nativeMd(component.describe()).p?.text).toContain("`code`    weawwy wowwd");
  });

  test("native inactive and host-transform paths return the host node unchanged", () => {
    const component = new AssistantMessageComponent(message(body));
    expect(component.describe()).not.toBe(originalDescribe.call(component));
    active = false;
    expect(component.describe()).toBe(originalDescribe.call(component));
    active = true;
    component.setTextColorTransform((text) => `HOST:${text}`);
    installation.refresh();
    expect(component.describe()).toBe(originalDescribe.call(component));
    component.setTextColorTransform(undefined);
    installation.refresh();
    expect(nativeMd(component.describe()).p?.marks).toEqual(sparkleMarks(body));
  });

  test("native settings refresh rebuilds cached nodes and omits empty marks", () => {
    let level: UwuLevel = "mid";
    let colors = true;
    installation = installSparkles(Container, {
      isActive: () => active,
      transform: (text) => uwufyProse(text, { level }),
      native: (text) => { const prose = uwufyMarkdownProse(text, { level }); return { text: prose, marks: colors ? sparkleMarks(prose) : [] }; },
    });
    const text = "really lovely northern flowers uwu";
    const component = new AssistantMessageComponent(message(text));
    const first = component.describe();
    level = "max";
    colors = false;
    installation.refresh();
    const next = component.describe();
    expect(next).not.toBe(first);
    expect(nativeMd(next).p?.text).toBe(uwufyMarkdownProse(text, { level }));
    expect(Object.hasOwn(nativeMd(next).p!, "marks")).toBe(false);
    expect(component.describe()).toBe(next);
    active = false;
    installation.refresh();
    expect(component.describe()).toBe(originalDescribe.call(component));
  });

  test("native streaming reuses earlier Markdown and never decorates thinking or other children", () => {
    const thought = "really lovely uwu (◕ᴗ◕✿)";
    const raw = Object.assign(message(""), {
      content: [{ type: "text", text: "first uwu" }, { type: "thinking", thinking: thought }, { type: "text", text: "tail owo" }],
    });
    const component = new AssistantMessageComponent(raw);
    const source = originalDescribe.call(component);
    const first = component.describe();
    const section = source.c?.find((child) => "k" in child && child.key === "k1");
    expect(section).toBeDefined();
    expect(first.c?.find((child) => "k" in child && child.key === "k1")).toBe(section);
    expect(JSON.stringify(section)).toContain(thought);
    expect(JSON.stringify(section)).not.toContain('"marks"');
    for (let index = 0; index < source.c!.length; index++) {
      const child = source.c![index]!;
      if (!("k" in child) || child.k !== "md") expect(first.c![index]).toBe(child);
    }
    component.updateContent(Object.assign(message(""), {
      content: [{ type: "text", text: "first uwu" }, { type: "thinking", thinking: thought }, { type: "text", text: "tail owo grows" }],
    }), { transient: true });
    const next = component.describe();
    expect(next).not.toBe(first);
    expect(nativeMd(next)).toBe(nativeMd(first));
    expect(nativeMd(next, "t2").p?.text).toBe("tail owo grows");
  });

  test("native reload keeps one patch and dispose restores describe", () => {
    const component = new AssistantMessageComponent(message("really lovely uwu"));
    const patched = AssistantMessageComponent.prototype.describe;
    const first = component.describe();
    installation = installSparkles(Container, {
      isActive: () => true,
      transform: (text) => uwufyProse(text),
      native: (text) => ({ text: uwufyMarkdownProse(text), marks: [] }),
    });
    expect(AssistantMessageComponent.prototype.describe).toBe(patched);
    const next = component.describe();
    expect(next).not.toBe(first);
    expect(nativeMd(next).p?.text).toBe("weawwy wovewy uwu");
    expect(Object.hasOwn(nativeMd(next).p!, "marks")).toBe(false);
    installation.dispose();
    expect(AssistantMessageComponent.prototype.describe).toBe(originalDescribe);
    expect(nativeMd(component.describe()).p?.text).toBe("really lovely uwu");
  });
});

test("native node guards preserve malformed nodes, host marks, metadata and component children", () => {
  class HostContainer { addChild(_child: unknown) {} }
  let source: unknown;
  class HostAssistant extends HostContainer {
    constructor() { super(); this.addChild({}); this.updateContent(); }
    setTextColorTransform(_transform?: (text: string) => string) {}
    updateContent() {}
    describe() { return source; }
  }
  const installation = installSparkles(HostContainer, {
    isActive: () => true,
    transform: (text) => text,
    native: (text) => ({ text, marks: sparkleMarks(text) }),
  });
  try {
    const component = new HostAssistant();
    for (const malformed of [null, { k: "row", c: [] }, { k: "col", c: null }]) {
      source = malformed;
      expect(component.describe()).toBe(source);
    }
    const hostMarks = [{ t: "host", s: "strong" }];
    const md = { k: "md", key: "t0", p: { text: "uwu", marks: hostMarks, stream: true }, reveal: { at: "end", n: 1 }, scroll: { by: "end", n: 1 } };
    const plain = { k: "md", key: "t1", p: { text: "plain", marks: [] } };
    const untouched = [
      { render() { return []; } },
      { k: "md", key: "t4", p: { text: "uwu", marks: {} } },
      { k: "md", key: "k0", p: { text: "uwu" } },
      { k: "section", key: "k1", c: [{ k: "md", key: "t5", p: { text: "uwu" } }] },
      { k: "badge", key: "error", p: { text: "uwu" } },
    ];
    const root = { k: "col", key: "root", p: { role: "omp.assistant" }, reveal: "end", c: [md, plain, ...untouched] };
    source = root;
    const original = JSON.stringify(source);
    const out = component.describe() as { key: string; p: unknown; reveal: string; c: typeof md[] };
    expect(out.key).toBe("root");
    expect(out.reveal).toBe("end");
    expect(out.p).toBe(root.p);
    expect(out.c[0]!.p).toEqual({ text: "uwu", stream: true, marks: [...hostMarks, ...sparkleMarks("uwu")] });
    expect(out.c[0]!.reveal).toBe(md.reveal);
    expect(out.c[0]!.scroll).toBe(md.scroll);
    expect(out.c[1]!.p.marks).toEqual([]);
    untouched.forEach((child, index) => {
      const preservedChild: unknown = out.c[index + 2];
      expect(preservedChild).toBe(child);
    });
    expect(component.describe()).toBe(out);
    expect(JSON.stringify(source)).toBe(original);
    source = { k: "col", c: [md] };
    const next = component.describe() as { c: unknown[] };
    expect(next.c[0]).toBe(out.c[0]);
  } finally {
    installation.dispose();
  }
});

test("inherited native describe is not patched or reported as installed support", () => {
  class HostContainer {
    addChild(_child: unknown) {}
    describe() { return { k: "col", c: [{ k: "md", key: "t0", p: { text: "uwu" } }] }; }
  }
  class HostAssistant extends HostContainer {
    constructor() { super(); this.addChild({}); this.updateContent(); }
    setTextColorTransform(_transform?: (text: string) => string) {}
    updateContent() {}
  }
  const installation = installSparkles(HostContainer, {
    isActive: () => true, transform: (text) => text,
    native: (text) => ({ text, marks: sparkleMarks(text) }),
  });
  try {
    const component = new HostAssistant();
    expect(installation.isSupported()).toBe(true);
    expect(installation.isNativeSupported()).toBe(false);
    expect(Object.hasOwn(HostAssistant.prototype, "describe")).toBe(false);
    expect(component.describe().c[0]!.p).toEqual({ text: "uwu" });
  } finally {
    installation.dispose();
  }
});

// Run against the user's installed host as well as the pinned development API.
// Other install layouts can opt in by pointing this at their pi-tui package.
const hostTui = process.env.OMP_UWU_HOST_TUI ?? join(homedir(), ".bun", "install", "global", "node_modules", "@oh-my-pi", "pi-tui");
test.skipIf(!existsSync(join(hostTui, "src", "chat", "assistant-message.ts")))("installed omp ANSI render wraps display prose and preserves code/history", async () => {
  const host = await import(pathToFileURL(join(hostTui, "src", "index.ts")).href);
  const chat = await import(pathToFileURL(join(hostTui, "src", "chat", "assistant-message.ts")).href);
  let level: UwuLevel = "max";
  const installation = installSparkles(host.Container, {
    isActive: () => true,
    transform: (run) => uwufyProse(run, { level }),
    native: (text) => ({ text: uwufyMarkdownProse(text, { level }), marks: [] }),
  });
  try {
    const prose = "northern nature normal nearby really lovely flowers";
    const body = `${prose} and \`really\`\n\n\`\`\`\nconst really = "lovely";\n\`\`\``;
    const raw = message(body);
    const original = JSON.stringify(raw);
    const component = new chat.AssistantMessageComponent(raw);
    expect(installation.isSupported()).toBe(true);
    const wide = Bun.stripANSI(component.render(80).join("\n"));
    expect(wide).toContain(uwufyProse(`${prose} and `, { level }).trim());
    expect(wide).toContain('const really = "lovely";');
    expect(wide).toContain("really");
    const narrow = component.render(24).map((row: string) => Bun.stripANSI(row));
    expect(narrow.every((row: string) => host.visibleWidth(row) <= 24)).toBe(true);
    const md = new host.Markdown(prose, 0, 0, host.getMarkdownTheme(), { color: (run: string) => uwufyProse(run, { level }) });
    const expected = new host.Markdown(uwufyProse(prose, { level }), 0, 0, host.getMarkdownTheme());
    expect(md.render(12).map(Bun.stripANSI)).toEqual(expected.render(12).map(Bun.stripANSI));
    level = "low";
    installation.refresh();
    expect(component.render(24).map(Bun.stripANSI)).not.toEqual(narrow);
    expect(JSON.stringify(raw)).toBe(original);
    if (installation.isNativeSupported()) {
      const description = JSON.stringify(component.describe());
      expect(description).toContain(JSON.stringify(uwufyMarkdownProse(body, { level })).slice(1, -1));
      expect(description).not.toContain("\\u001b");
    }
  } finally {
    installation.dispose();
  }
});
