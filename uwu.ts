/**
 * uwu mode — makes the agent's chat replies uwu-speak.
 *
 * Why system-prompt based: OMP gives extensions no hook to rewrite displayed
 * assistant text (`message_end` receives a detached clone), so the style is
 * requested from the model via `before_agent_start` → `systemPrompt`.
 *
 * Toggle with `/uwu` (or `/uwu on` / `/uwu off`). Enabled by default.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export const UWU_PROMPT = `
# uwu mode (display style only)
Write your prose replies to the user in playful "uwu" speak:
- replace r/l with w in most words ("weawwy", "hewwo"), "th" → "d" occasionally, "na/ne/no" → "nya/nye/nyo" sometimes
- occasional stutter ("h-hewwo") and cute emoticons at sentence ends (uwu, owo, >w<, ^w^, :3), at most one per sentence
- keep it readable; never let the style hide meaning, numbers, or warnings

NEVER uwufy any of these — keep them exact and byte-for-byte correct:
- code, code blocks, inline code, shell commands, file paths, URLs, identifiers, config keys, error messages you quote
- tool call arguments, file contents you write or edit, commit messages, and anything sent to subagents
The style applies only to natural-language chat text shown to the user. Task quality and correctness are unchanged.
`.trim();

export default function uwuExtension(pi: ExtensionAPI) {
	let enabled = true;

	pi.registerCommand("uwu", {
		description: "Toggle uwu mode (usage: /uwu [on|off])",
		handler: async (args, ctx) => {
			const arg = String(args ?? "").trim().toLowerCase();
			enabled = arg === "on" ? true : arg === "off" ? false : !enabled;
			ctx.ui.notify(enabled ? "uwu mode enabwed! (◕ᴗ◕✿)" : "uwu mode disabled", "info");
		},
	});

	pi.on("before_agent_start", async event => {
		if (!enabled) return undefined;
		return { systemPrompt: [...event.systemPrompt, UWU_PROMPT] };
	});
}
