// Capture the `/uwu status` dashboard for render.py from the real component: ANSI
// frames rendered with omp's dark theme while a scripted key sequence edits the
// draft. No model calls, fully deterministic. Usage: bun demo/capture.ts
import { getThemeByName, type Theme } from "@oh-my-pi/pi-coding-agent";
import { createStatusCard, type UwuStatus } from "../src/status.ts";

const here = import.meta.dir;
const KEYS = { down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", tab: "\t" } as const;
const WIDTH = 68;

const theme = (await getThemeByName("dark")) as Theme;
const status: UwuStatus = {
  enabled: true, style: "rewrite", level: "mid", locale: "auto", colorsEnabled: false,
  rewrite: "detected", display: "ANSI hook detected", promptFallback: false,
};
const card = createStatusCard(status, theme, () => {}, () => {});

// Each step: key to press (or null for the opening frame) and how long to hold the result.
const script: [keyof typeof KEYS | null, number][] = [
  [null, 1600],
  ["down", 500], ["right", 1100], ["right", 1400], ["left", 700], ["left", 1000],
  ["down", 500], ["left", 1400], ["right", 900], ["right", 1500],
  ["down", 500], ["right", 600], ["right", 600], ["right", 900],
  ["down", 500], ["right", 1100],
  ["tab", 2400], ["tab", 700],
  ["down", 2600],
];
const frames = script.map(([key, ms]) => {
  if (key) card.handleInput!(KEYS[key]);
  return { key, ms, lines: card.render(WIDTH) };
});
await Bun.write(`${here}/dashboard.json`, JSON.stringify({ width: WIDTH, frames }, null, 1));
console.log(`captured ${frames.length} dashboard frames`);
