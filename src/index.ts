import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { uwufy } from "./uwufy.ts";

export const UWU_PROMPT = `
# uwu mode (display style only)
Write your prose replies to the user in playful "uwu" speak:
- replace r/l with w in most words ("weawwy", "hewwo"), "th" → "d" occasionally, "na/ne/no" → "nya/nye/nyo" sometimes
- occasional stutter ("h-hewwo") and cute kaomoji/emoticons, varied naturally: (◕ᴗ◕✿), (o^▽^o), (´｡• ω •｡\u0060), ٩(◕‿◕｡)۶, (✧ω✧), (๑˃ᴗ˂)ﻭ, ヽ(・∀・)ﾉ, (っ˘ω˘ς), (｡•̀ᴗ-)✧, (づ｡◕‿‿◕｡)づ, (ฅ^•ﻌ•^ฅ), (๑>◡<๑), owo, >w<, ^w^, :3; at most one at a sentence end
- keep it readable; never let the style hide meaning, numbers or warnings
- colors are only for UI chrome; never insert ANSI color codes into chat text

NEVER uwufy any of these — keep them exact and byte-for-byte correct:
- code, code blocks, inline code, shell commands, file paths, URLs, identifiers, config keys, error messages you quote
- tool call arguments, file contents the agent writes or edits, commit messages and prompts sent to subagents
The style applies only to natural-language chat text shown to the user. Task quality and correctness are unchanged.
`.trim();

type RewriteEvent = {
  message: { role: string; content: Array<{ type: string; text?: string; [key: string]: unknown }> };
};
type MessageEndEvent = { message: { role: string; stopReason?: string } };
type UiContext = {
  mode?: string;
  agent?: { kind?: string };
  ui?: {
    notify(message: string, level: "info"): void;
    setStatus?(key: string, text: string | undefined): void;
    theme?: { fg(color: string, text: string): string };
  };
};

export default function uwuExtension(pi: ExtensionAPI) {
  let enabled = true;
  let style: "rewrite" | "prompt" = "rewrite";
  let hookSupport: boolean | undefined;
  let promptAddedThisTurn = false;
  let notifiedFallback = false;

  const updateBadge = (ctx: UiContext) => {
    if (ctx.mode !== "tui" || ctx.agent?.kind === "sub" || !ctx.ui?.setStatus) return;
    const badge = enabled ? "(◕ᴗ◕✿) uwu" : undefined;
    ctx.ui.setStatus("omp-uwu", badge && ctx.ui.theme ? ctx.ui.theme.fg("accent", badge) : badge);
  };

  pi.registerCommand("uwu", {
    description: "UwU chat style and mode (usage: /uwu [on|off|prompt|rewrite])",
    handler: async (args, rawCtx) => {
      const ctx = rawCtx as UiContext;
      const arg = String(args ?? "").trim().toLowerCase();
      if (arg === "prompt" || arg === "rewrite") {
        style = arg;
        enabled = true;
      } else if (arg === "on") enabled = true;
      else if (arg === "off") enabled = false;
      else if (!arg) enabled = !enabled;
      else {
        ctx.ui?.notify("Usage: /uwu [on|off|prompt|rewrite]", "info");
        return;
      }
      updateBadge(ctx);
      ctx.ui?.notify(enabled ? `uwu mode ${style === "rewrite" ? "rewrite" : "prompt"}! (◕ᴗ◕✿)` : "uwu mode off", "info");
    },
  });

  pi.on("session_start", (_event, rawCtx) => updateBadge(rawCtx as UiContext));

  pi.on("before_agent_start", async (event, rawCtx) => {
    promptAddedThisTurn = false;
    const ctx = rawCtx as UiContext;
    if (ctx.agent?.kind === "sub") return undefined;
    // Start with the prompt until this host proves it has the finalized hook.
    // That styles the first reply on both old and new omp versions.
    const needsPrompt = style === "prompt" || hookSupport !== true;
    if (!enabled || !needsPrompt) return undefined;
    promptAddedThisTurn = true;
    return { systemPrompt: [...event.systemPrompt, UWU_PROMPT] };
  });

  // The hook is newer than the bundled 18.4.3 types, so register structurally.
  // ExtensionAPI.on stores event names as strings; old hosts simply never emit it.
  (pi.on as unknown as (name: string, handler: (event: RewriteEvent) => unknown) => void)(
    "assistant_message",
    (event) => {
      hookSupport = true;
      if (!enabled || style !== "rewrite" || promptAddedThisTurn || event.message.role !== "assistant") return;
      let changed = false;
      const content = event.message.content.map((block) => {
        if (block.type !== "text" || typeof block.text !== "string") return block;
        const text = uwufy(block.text);
        if (text === block.text) return block;
        changed = true;
        return { ...block, text };
      });
      return changed ? { content } : undefined;
    },
  );

  pi.on("message_end", (rawEvent) => {
    const message = (rawEvent as MessageEndEvent).message;
    if (message.role === "assistant" && message.stopReason !== "aborted" && message.stopReason !== "error" && hookSupport === undefined) {
      hookSupport = false;
      // The current response has already streamed; prompt fallback applies next turn.
      if (!notifiedFallback) notifiedFallback = true;
    }
  });
}
