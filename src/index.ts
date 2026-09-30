import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KawaiiTheme } from "./kawaii.ts";
import { type ContainerClass, installSparkles, sparkle, themePaint } from "./sparkle.ts";
import { createStatusCard, DEFAULT_SETTINGS, type UwuSettings, type UwuStatus } from "./status.ts";

import type { ExtensionAPI, ExtensionUIContext, Theme } from "@oh-my-pi/pi-coding-agent";
import { type UwuLevel, type UwuLocale, uwufy, uwufyProse } from "./uwufy.ts";

export const UWU_PROMPT = `
# uwu mode (display style only)
Write your prose replies to the user in playful "uwu" speak:
- replace r/l with w in most words ("weawwy", "hewwo"), "th" → "d" occasionally, "na/ne/no" → "nya/nye/nyo" sometimes
- occasional stutter ("h-hewwo") and cute kaomoji/emoticons, varied naturally: (◕ᴗ◕✿), (o^▽^o), (´｡• ω •｡\u0060), ٩(◕‿◕｡)۶, (✧ω✧), (๑˃ᴗ˂)ﻭ, ヽ(・∀・)ﾉ, (っ˘ω˘ς), (｡•̀ᴗ-)✧, (づ｡◕‿‿◕｡)づ, (ฅ^•ﻌ•^ฅ), (๑>◡<๑), owo, >w<, ^w^, :3; at most one at a sentence end
- now and then a cute emoji or sparkle instead (✨, 💖, 🌸, 🎀, ♡, ☆), never more than one per paragraph
- keep it readable; never let the style hide meaning, numbers or warnings
- the TUI colors kaomoji, uwu and sparkles by itself; never insert ANSI color codes into chat text

NEVER uwufy any of these — keep them exact and byte-for-byte correct:
- code, code blocks, inline code, shell commands, file paths, URLs, identifiers, config keys, error messages you quote
- tool call arguments, file contents the agent writes or edits, commit messages and prompts sent to subagents
- English negations, warnings and errors; in auto/tr also Turkish negations, warnings and errors (including inflected forms)
The style applies only to natural-language chat text shown to the user. Task quality and correctness are unchanged.
`.trim();

type UwuStyle = "rewrite" | "prompt" | "display";
const USAGE = "Usage: /uwu [on|off|rewrite|prompt|display|level low|mid|max|locale auto|en|tr|status|preview <text>|colors [on|off]]";

function stylePrompt(level: UwuLevel, locale: UwuLocale): string {
  let prompt = UWU_PROMPT;
  if (level === "low") {
    prompt = prompt
      .replace('replace r/l with w in most words ("weawwy", "hewwo"), "th" → "d" occasionally, "na/ne/no" → "nya/nye/nyo" sometimes',
        'use a light, mostly unchanged style: rarely replace r/l with w; very rarely use "th" → "d" or "na/ne/no" → "nya/nye/nyo"')
      .replace('occasional stutter ("h-hewwo") and cute kaomoji/emoticons', 'very rare stutter ("h-hewwo") and cute kaomoji/emoticons');
  } else if (level === "max") {
    prompt = prompt
      .replace('replace r/l with w in most words ("weawwy", "hewwo"), "th" → "d" occasionally, "na/ne/no" → "nya/nye/nyo" sometimes',
        'use a stronger but readable style: replace r/l with w in ordinary words; frequently use "th" → "d" and "na/ne/no" → "nya/nye/nyo"')
      .replace('occasional stutter ("h-hewwo") and cute kaomoji/emoticons', 'more frequent stutter ("h-hewwo") and cute kaomoji/emoticons');
  }
  if (locale === "en") {
    prompt = prompt.replace("in auto/tr also Turkish negations, warnings and errors (including inflected forms)", "English-focused style and critical-word protection");
  } else if (locale === "tr") {
    prompt += "\nUse Turkish-aware prose styling and protect Turkish critical words/inflections; English critical words remain protected. Do not translate the reply.";
  }
  return prompt;
}

type RewriteEvent = {
  message: { role: string; content: Array<{ type: string; text?: string; [key: string]: unknown }> };
};
type MessageEndEvent = { message: { role: string; stopReason?: string } };
type UiContext = {
  mode?: string;
  agent?: { kind?: string };
  ui?: {
    notify(message: string, level: "info" | "warning"): void;
    setStatus?(key: string, text: string | undefined): void;
    theme?: Theme;
    custom?: ExtensionUIContext["custom"];
  };
};

export default function uwuExtension(pi: ExtensionAPI) {
  let enabled = DEFAULT_SETTINGS.enabled;
  let colorsEnabled = DEFAULT_SETTINGS.colorsEnabled;
  let stateReady: Promise<void> | undefined;
  let style: UwuStyle = DEFAULT_SETTINGS.style;
  let level: UwuLevel = DEFAULT_SETTINGS.level;
  let locale: UwuLocale = DEFAULT_SETTINGS.locale;
  let subagentTurn = false;
  let renderAllowed = true;
  let hookSupport: boolean | undefined;
  let promptAddedThisTurn = false;
  const statePath = join(pi.pi.getAgentDir(), "omp-uwu.json");
  const kawaiiTheme = new KawaiiTheme(pi.pi);
  const loadState = () => {
    stateReady ??= readFile(statePath, "utf8")
      .then((raw) => {
        const state: unknown = JSON.parse(raw);
        if (typeof state !== "object" || state === null) return;
        if ("enabled" in state && typeof state.enabled === "boolean") enabled = state.enabled;
        if ("colors" in state && typeof state.colors === "boolean") colorsEnabled = state.colors;
        if ("style" in state && (state.style === "rewrite" || state.style === "prompt" || state.style === "display")) style = state.style;
        if ("level" in state && (state.level === "low" || state.level === "mid" || state.level === "max")) level = state.level;
        if ("locale" in state && (state.locale === "auto" || state.locale === "en" || state.locale === "tr")) locale = state.locale;
      })
      .catch(() => {});
    return stateReady;
  };
  const saveState = () => writeFile(statePath, `${JSON.stringify({ enabled, colors: colorsEnabled, style, level, locale }, null, 2)}\n`, "utf8");

  const updateBadge = (ctx: UiContext) => {
    if (ctx.mode !== "tui" || ctx.agent?.kind === "sub" || !ctx.ui?.setStatus) return;
    const badge = enabled ? "(◕ᴗ◕✿) uwu" : undefined;
    ctx.ui.setStatus("omp-uwu", badge && ctx.ui.theme ? ctx.ui.theme.fg("accent", badge) : badge);
  };

  // Display and sparkle composition share the host's per-prose ANSI hook.
  // Prose is transformed before Markdown wrapping; no message/history changes.
  const paint = themePaint(() => pi.pi.theme);
  const host = pi.pi as { Container?: ContainerClass };
  const rendering = host.Container && installSparkles(host.Container, {
    isActive: () => renderAllowed && enabled && (style === "display" || colorsEnabled),
    transform: (text) => {
      const prose = style === "display" ? uwufyProse(text, { level, locale }) : text;
      return colorsEnabled ? sparkle(prose, paint) : prose;
    },
  });

  const syncColors = (ctx: UiContext) => {
    if (ctx.mode !== "tui" || ctx.agent?.kind === "sub" || !ctx.ui?.theme) return;
    if (enabled && colorsEnabled) kawaiiTheme.enable(ctx.ui.theme);
    else kawaiiTheme.disable(ctx.ui.theme);
  };

  const persistSettings = async (ctx: UiContext) => {
    try {
      await saveState();
    } catch {
      ctx.ui?.notify("UwU settings could not be saved; current changes apply only to this session. Try saving again from /uwu status.", "warning");
    }
    renderAllowed = ctx.mode === "tui";
    syncColors(ctx);
    rendering?.refresh();
    updateBadge(ctx);
  };

  pi.registerCommand("uwu", {
    description: "UwU settings: /uwu status opens controls; /uwu toggles styling",
    getArgumentCompletions: (prefix) => {
      const values = ["status", "on", "off", "rewrite", "prompt", "display", "level low", "level mid", "level max", "locale auto", "locale en", "locale tr", "colors on", "colors off", "preview"];
      const matches = values.filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, rawCtx) => {
      await loadState();
      const ctx = rawCtx as UiContext;
      if (ctx.agent?.kind === "sub") {
        ctx.ui?.notify("UwU settings are available only in the main conversation.", "warning");
        return;
      }
      const input = String(args ?? "").trim();
      const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input);
      const arg = (match?.[1] ?? "").toLowerCase();
      const option = (match?.[2] ?? "").trim();
      const value = option.toLowerCase();
      if (arg === "status" && !option) {
        const display = !host.Container ? "unavailable" : rendering?.isSupported() ? "available" : "waiting for first reply";
        const status: UwuStatus = {
          enabled, style, level, locale, colorsEnabled,
          rewrite: hookSupport === undefined ? "waiting for first reply" : hookSupport ? "available" : "unavailable",
          display,
          promptFallback: enabled && style === "rewrite" && hookSupport !== true,
        };
        if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
          const settings = await ctx.ui.custom<UwuSettings | undefined>((tui, theme, _keybindings, done) =>
            createStatusCard(status, theme, done, () => tui.requestRender()), {
              overlay: true,
              overlayOptions: { width: 68, anchor: "center", margin: 1 },
            });
          if (settings) {
            ({ enabled, style, level, locale, colorsEnabled } = settings);
            await persistSettings(ctx);
          }
        } else {
          ctx.ui?.notify(`uwu ${enabled ? "on" : "off"}; style=${style}; level=${level}; locale=${locale}; colors=${colorsEnabled ? "on" : "off"}; rewrite=${status.rewrite}; display=${display}; native/client display=unsupported; prompt fallback=${status.promptFallback ? "on" : "off"}`, "info");
        }
        return;
      }
      if (arg === "preview") {
        if (!option) {
          ctx.ui?.notify("Preview needs sample text. Usage: /uwu preview <text>", "warning");
          return;
        }
        ctx.ui?.notify(style === "display" ? uwufyProse(option, { level, locale }) : uwufy(option, { level, locale }), "info");
        return;
      }
      if (arg === "colors" && (value === "on" || value === "off" || !value)) {
        colorsEnabled = value ? value === "on" : !colorsEnabled;
      } else if (arg === "level" && (value === "low" || value === "mid" || value === "max")) {
        level = value;
      } else if (arg === "locale" && (value === "auto" || value === "en" || value === "tr")) {
        locale = value;
      } else if (!option && (arg === "prompt" || arg === "rewrite" || arg === "display")) {
        style = arg;
        enabled = true;
      } else if (!option && arg === "on") enabled = true;
      else if (!option && arg === "off") enabled = false;
      else if (!input) enabled = !enabled;
      else {
        const reason = arg === "level" ? "Level must be low, mid or max."
          : arg === "locale" ? "Locale must be auto, en or tr."
          : arg === "colors" ? "Colors accepts on or off, or no value to toggle."
          : ["on", "off", "rewrite", "prompt", "display", "status"].includes(arg) ? `${arg} does not accept extra text.`
          : `Unknown UwU action: ${arg}.`;
        ctx.ui?.notify(`${reason} ${USAGE} Open /uwu status for controls.`, "warning");
        return;
      }
      await persistSettings(ctx);
      if (arg === "colors") {
        ctx.ui?.notify(`UwU colors ${colorsEnabled ? "on" : "off"}${colorsEnabled && !enabled ? " (active when uwu mode is on)" : ""}. Settings: /uwu status`, "info");
      } else {
        ctx.ui?.notify(`${enabled ? `UwU on; style=${style}; level=${level}; locale=${locale}` : "UwU off; /uwu on restores styling"}. Settings: /uwu status`, "info");
      }
      if (enabled && style === "display") {
        ctx.ui?.notify(`Experimental display: terminal prose only; ${!host.Container ? "unavailable in this omp" : rendering?.isSupported() ? "available" : "waiting for first reply"}. Native/client rendering is unsupported; history stays unchanged and no prompt fallback is used.`, "info");
      }
    },
  });

  pi.on("session_start", async (_event, rawCtx) => {
    await loadState();
    const ctx = rawCtx as UiContext;
    syncColors(ctx);
    renderAllowed = ctx.mode === "tui" && ctx.agent?.kind !== "sub";
    rendering?.refresh();
    updateBadge(ctx);
  });

  pi.on("before_agent_start", async (event, rawCtx) => {
    await loadState();
    promptAddedThisTurn = false;
    const ctx = rawCtx as UiContext;
    subagentTurn = ctx.agent?.kind === "sub";
    if (subagentTurn) return undefined;
    // Start with the prompt until this host proves it has the finalized hook.
    // That styles the first reply on both old and new omp versions.
    const needsPrompt = style === "prompt" || (style === "rewrite" && hookSupport !== true);
    if (!enabled || !needsPrompt) return undefined;
    promptAddedThisTurn = true;
    return { systemPrompt: [...event.systemPrompt, stylePrompt(level, locale)] };
  });


  // The hook is newer than the bundled 18.4.3 types, so register structurally.
  // ExtensionAPI.on stores event names as strings; old hosts simply never emit it.
  (pi.on as unknown as (name: string, handler: (event: RewriteEvent, ctx?: UiContext) => unknown) => void)(
    "assistant_message",
    (event, ctx) => {
      if (ctx?.agent?.kind === "sub" || (!ctx?.agent && subagentTurn)) return;
      hookSupport = true;
      if (!enabled || style !== "rewrite" || promptAddedThisTurn || event.message.role !== "assistant") return;
      let changed = false;
      const content = event.message.content.map((block) => {
        if (block.type !== "text" || typeof block.text !== "string") return block;
        const text = uwufy(block.text, { level, locale });
        if (text === block.text) return block;
        changed = true;
        return { ...block, text };
      });
      return changed ? { content } : undefined;
    },
  );

  pi.on("message_end", (rawEvent, rawCtx) => {
    const ctx = rawCtx as UiContext | undefined;
    if (ctx?.agent?.kind === "sub" || (!ctx?.agent && subagentTurn)) return;
    const message = (rawEvent as MessageEndEvent).message;
    if (message.role === "assistant" && message.stopReason !== "aborted" && message.stopReason !== "error" && hookSupport === undefined) {
      hookSupport = false;
    }
  });
}
