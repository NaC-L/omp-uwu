// Capture ANSI frames for render.py from omp's real TUI components, drawn with
// the kawaii palette over omp's dark-sunset theme and with sparkles installed —
// what a user with `/uwu colors on` sees. No model calls, fully deterministic.
//   chat.json       prompt.txt typed into a user bubble, then uwu.txt streaming
//                   into an assistant message
//   dashboard.json  the `/uwu status` card while a scripted key sequence edits it
//   kitty.json      the real status-line brand segment over two walking cycles
// Usage: COLORTERM=truecolor bun demo/capture.ts
import { getThemeByName, setThemeInstance, Theme } from "@oh-my-pi/pi-coding-agent";
import { Container } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "@oh-my-pi/pi-tui/chat/assistant-message";
import { UserMessageComponent } from "@oh-my-pi/pi-tui/chat/user-message";
import { renderSegment } from "@oh-my-pi/pi-tui/status-line";
import type { SegmentContext } from "@oh-my-pi/pi-tui/status-line";
import { buildKawaiiTheme } from "../src/kawaii.ts";
import { installSparkles, sparkle, sparkleMarks, themePaint } from "../src/sparkle.ts";
import { createStatusCard, type UwuStatus } from "../src/status.ts";

type Frame = { key?: string | null; ms: number; lines: readonly string[] };

const here = import.meta.dir;
const THEME = "dark-sunset";

const base = await getThemeByName(THEME);
if (!base) throw new Error(`omp theme ${THEME} not found`);
if (base.getColorMode() !== "truecolor") throw new Error("run with COLORTERM=truecolor so colors match the theme exactly");
const theme = buildKawaiiTheme(Theme, base);
setThemeInstance(theme);
const rendering = installSparkles(Container, {
  isActive: () => true,
  transform: (text) => sparkle(text, themePaint(() => theme)),
  native: (text) => ({ text, marks: sparkleMarks(text) }),
});

// --- chat: type the prompt, then stream the reply ---------------------------------
const CHAT_WIDTH = 76;
const [prompt, reply] = await Promise.all(["prompt.txt", "uwu.txt"].map(async (name) =>
  (await Bun.file(`${here}/${name}`).text()).replace(/\r\n/g, "\n").trim()));
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const chat: Frame[] = [{ ms: 600, lines: [] }];
for (let n = 8; n < prompt.length; n += 8) chat.push({ ms: 35, lines: new UserMessageComponent(prompt.slice(0, n)).render(CHAT_WIDTH) });
const sent = new UserMessageComponent(prompt).render(CHAT_WIDTH);
chat.push({ ms: 900, lines: sent });
const component = new AssistantMessageComponent();
for (let n = 6; n < reply.length + 6; n += 6) {
  component.updateContent({
    role: "assistant", content: [{ type: "text", text: reply.slice(0, n) }], api: "demo", provider: "demo", model: "demo",
    usage, stopReason: "stop", timestamp: 0,
  } as never);
  chat.push({ ms: 45, lines: [...sent, "", ...component.render(CHAT_WIDTH)] });
}
chat.at(-1)!.ms = 5000;
await Bun.write(`${here}/chat.json`, JSON.stringify({ theme: THEME, width: CHAT_WIDTH, frames: chat }, null, 1));

// --- dashboard ---------------------------------------------------------------------
const DASH_WIDTH = 68;
const KEYS = { down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", tab: "\t" } as const;
const status: UwuStatus = {
  enabled: true, style: "rewrite", level: "mid", locale: "auto", colorsEnabled: true,
  rewrite: "available", display: "available",
  nativeDisplay: rendering.isNativeSupported() ? "available" : "unavailable", promptFallback: false,
};
const card = createStatusCard(status, theme, () => {}, () => {});
// Each step: key to press (or null for the opening frame) and how long to hold the result.
const script: [keyof typeof KEYS | null, number][] = [
  [null, 1600],
  ["down", 500], ["right", 1100], ["right", 1400], ["left", 700], ["left", 1000],
  ["down", 500], ["left", 1400], ["right", 900], ["right", 1500],
  ["down", 500], ["right", 600], ["right", 600], ["right", 900],
  ["tab", 2400], ["tab", 700],
  ["down", 500], ["down", 2600],
];
const dashboard: Frame[] = script.map(([key, ms]) => {
  if (key) card.handleInput!(KEYS[key]);
  return { key, ms, lines: card.render(DASH_WIDTH) };
});
await Bun.write(`${here}/dashboard.json`, JSON.stringify({ theme: THEME, width: DASH_WIDTH, frames: dashboard }, null, 1));

// --- kitty: sample the host's actual time-derived brand spinner ---------------------
const kitty: Frame[] = [];
const cycleTicks = theme.getSpinnerFrames("activity").length;
for (let tick = 0; tick < cycleTicks * 2; tick += 3) {
  // The pi segment reads only these fields; no session/model is needed.
  const context = {
    now: new Date(tick * 80),
    turnElapsedMs: tick * 80,
    brandFgAnsi: theme.getFgAnsi("accent"),
  } as SegmentContext;
  kitty.push({ ms: 240, lines: [renderSegment("pi", context).content] });
}
await Bun.write(`${here}/kitty.json`, JSON.stringify({ theme: THEME, kind: "kitty", width: 40, frames: kitty }, null, 1));
console.log(`captured ${chat.length} chat frames, ${dashboard.length} dashboard frames and ${kitty.length} kitty frames`);
