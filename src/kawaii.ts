import type * as PiCodingAgent from "@oh-my-pi/pi-coding-agent";
import type { Theme, ThemeBg, ThemeColor } from "@oh-my-pi/pi-coding-agent";

export type ThemeRuntime = Pick<typeof PiCodingAgent, "Theme" | "setThemeInstance">;

const FG_KEYS: ThemeColor[] = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
  "thinkingText", "userMessageText", "customMessageText", "customMessageLabel", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder",
  "mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword",
  "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax",
  "bashMode", "pythonMode", "statusLineSep", "statusLineModel", "statusLinePath", "statusLineGitClean", "statusLineGitDirty",
  "statusLineContext", "statusLineSpend", "statusLineStaged", "statusLineDirty", "statusLineUntracked", "statusLineOutput",
  "statusLineCost", "statusLineSubagents",
];

const BG_KEYS: ThemeBg[] = ["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "statusLineBg"];
const FG_DEFAULT = "\x1b[39m";
const BG_DEFAULT = "\x1b[49m";

const DARK_PALETTE: Partial<Record<ThemeColor | ThemeBg, string>> = {
  accent: "#ff8fcf", border: "#b99aca", borderAccent: "#ff8fcf", thinkingText: "#cbb8ef",
  mdHeading: "#ff9ed8", mdLink: "#b5a8ff", mdLinkUrl: "#a08fd8", mdCode: "#8fe8c3",
  mdCodeBlockBorder: "#b99aca", mdQuote: "#ffc4e1", mdQuoteBorder: "#ff8fcf", mdHr: "#b99aca",
  mdListBullet: "#ffb38a", userMessageBg: "#3a2433",
};

const LIGHT_PALETTE: Partial<Record<ThemeColor | ThemeBg, string>> = {
  accent: "#c52f80", border: "#9c75b6", borderAccent: "#c52f80", thinkingText: "#735f9e",
  mdHeading: "#b32470", mdLink: "#624ac6", mdLinkUrl: "#7663b1", mdCode: "#087b5c",
  mdCodeBlockBorder: "#9c75b6", mdQuote: "#99416f", mdQuoteBorder: "#c52f80", mdHr: "#9c75b6",
  mdListBullet: "#c35424", userMessageBg: "#fde8f3",
};

/** Build a pastel copy of a host theme, retaining its colors outside the palette. */
export function buildKawaiiTheme(ThemeClass: ThemeRuntime["Theme"], base: Theme): Theme {
  const palette = base.isLight ? LIGHT_PALETTE : DARK_PALETTE;
  const fg: Partial<Record<ThemeColor, string>> = {};
  const bg: Partial<Record<ThemeBg, string>> = {};

  for (const key of FG_KEYS) {
    try {
      const ansi = base.getFgAnsi(key);
      fg[key] = palette[key] ?? (ansi === FG_DEFAULT ? "" : base.getColorHex(key));
    } catch {
      // A host newer than the plugin's type dependency may expose extra colors.
    }
  }
  for (const key of BG_KEYS) {
    try {
      const ansi = base.getBgAnsi(key);
      bg[key] = palette[key] ?? (ansi === BG_DEFAULT ? "" : base.getBgHex(key));
    } catch {
      // Missing theme colors are left to the host defaults.
    }
  }

  const preset = base.getSymbolPreset();
  return new ThemeClass(
    fg as Record<ThemeColor, string>,
    bg as Record<ThemeBg, string>,
    base.getColorMode(),
    preset,
    {},
    { status: base.getSpinnerFrames("status"), activity: base.getSpinnerFrames("activity") },
  );
}

/** A reversible, ephemeral kawaii theme; never edits the user's theme file. */
export class KawaiiTheme {
  #runtime: ThemeRuntime;
  #base: Theme | undefined;
  #overlay: Theme | undefined;

  constructor(runtime: ThemeRuntime) {
    this.#runtime = runtime;
  }


  enable(current: Theme): void {
    if (this.#overlay && current === this.#overlay) return;
    this.#base = current;
    this.#overlay = buildKawaiiTheme(this.#runtime.Theme, current);
    this.#runtime.setThemeInstance(this.#overlay);
  }

  disable(current: Theme | undefined): void {
    if (!this.#overlay) return;
    if (current === this.#overlay && this.#base) this.#runtime.setThemeInstance(this.#base);
    this.#base = undefined;
    this.#overlay = undefined;
  }
}
