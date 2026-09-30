import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Container, getMarkdownTheme, Markdown, visibleWidth } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "@oh-my-pi/pi-tui/chat/assistant-message";
import { getThemeByName, Theme } from "@oh-my-pi/pi-coding-agent";
import { buildKawaiiTheme, KawaiiTheme } from "../src/kawaii.ts";
import { installSparkles, sparkle, type Paint, type SparkleInstallation } from "../src/sparkle.ts";
import { type UwuLevel, uwufy, uwufyProse } from "../src/uwufy.ts";

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
      if (preset === "ascii") expect(frames.every((frame) => /^[\x20-\x7e]+$/.test(frame))).toBe(true);
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
});

describe("installSparkles on omp's AssistantMessageComponent", () => {
  let active: boolean;
  let installation: SparkleInstallation;
  let originalAddChild: typeof Container.prototype.addChild;
  beforeEach(() => {
    active = true;
    originalAddChild = Container.prototype.addChild;
    installation = installSparkles(Container, { isActive: () => active, transform: (text) => sparkle(text, ansiPaint) });
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
    installation = installSparkles(Container, { isActive: () => true, transform: (text) => uwufyProse(text) });
    expect(AssistantMessageComponent.prototype.updateContent).toBe(patched);
    expect(Bun.stripANSI(render(component))).toContain("weawwy wovewy");
  });

  test("display prose composes with sparkles but never changes inline/fenced code or raw messages", () => {
    const runs: string[] = [];
    installation = installSparkles(Container, {
      isActive: () => true,
      transform: (text) => { runs.push(text); return sparkle(uwufyProse(text), ansiPaint); },
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
    installation = installSparkles(Container, { isActive: () => true, transform: (run) => uwufyProse(run, { level }) });
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
});

// Run against the user's installed host as well as the pinned development API.
// Other install layouts can opt in by pointing this at their pi-tui package.
const hostTui = process.env.OMP_UWU_HOST_TUI ?? join(homedir(), ".bun", "install", "global", "node_modules", "@oh-my-pi", "pi-tui");
test.skipIf(!existsSync(join(hostTui, "src", "chat", "assistant-message.ts")))("installed omp ANSI render wraps display prose and preserves code/history", async () => {
  const host = await import(pathToFileURL(join(hostTui, "src", "index.ts")).href);
  const chat = await import(pathToFileURL(join(hostTui, "src", "chat", "assistant-message.ts")).href);
  let level: UwuLevel = "max";
  const installation = installSparkles(host.Container, { isActive: () => true, transform: (run) => uwufyProse(run, { level }) });
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
    // 18.4.4's native description sends raw Markdown, not the ANSI transform.
    if (typeof component.describe === "function") {
      expect(JSON.stringify(component.describe({}))).toContain(JSON.stringify(body).slice(1, -1));
    }
  } finally {
    installation.dispose();
  }
});
