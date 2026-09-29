import { describe, expect, test } from "bun:test";
import { Container } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "@oh-my-pi/pi-tui/chat/assistant-message";
import { getThemeByName, Theme } from "@oh-my-pi/pi-coding-agent";
import { buildKawaiiTheme } from "../src/kawaii.ts";
import { installSparkles, sparkle, type Paint } from "../src/sparkle.ts";
import { uwufy } from "../src/uwufy.ts";

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

  test("is deterministic and never changes visible text", () => {
    const text = uwufy("This is really nice. That was a lovely fix. The tests all pass now!");
    expect(sparkle(text, bracket)).toBe(sparkle(text, bracket));
    expect(sparkle(text, ansiPaint).replaceAll(MARK, "").replaceAll("\x1b[39m", "")).toBe(text);
  });
});

describe("installSparkles on omp's AssistantMessageComponent", () => {
  let active = true;
  const originalAddChild = Container.prototype.addChild;
  installSparkles(Container, { isActive: () => active, transform: (text) => sparkle(text, ansiPaint) });

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
});
