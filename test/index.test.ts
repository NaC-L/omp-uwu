import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getThemeByName, Theme } from "@oh-my-pi/pi-coding-agent";
import uwuExtension, { UWU_PROMPT } from "../src/index.ts";
import { installSparkles, sparkle, themePaint } from "../src/sparkle.ts";
import { uwufy, uwufyProse } from "../src/uwufy.ts";

type Handler = (...args: unknown[]) => unknown;
type Command = (args: string, ctx: unknown) => Promise<void>;
let handlers: Record<string, Handler>;
type AgentStartResult = { systemPrompt: string[] } | undefined;
type RewriteResult = { content: Array<{ type: string; text?: string; id?: string }> } | undefined;
let command: Command;
let commandName: string;
let notices: string[];
let stateDir = "";
let baseTheme: Theme;
let activeTheme: Theme;
const ctx = {
  mode: "tui",
  ui: {
    notify: (msg: string) => notices.push(msg),
    setStatus: () => {},
    get theme() { return activeTheme; },
  },
};
const event = () => ({ systemPrompt: ["base policy"] });

class MockContainer {
  addChild(_child: unknown) {}
}
class MockAssistant extends MockContainer {
  transform: ((text: string) => string) | undefined;
  text = "";
  invalidations = 0;
  constructor(text: string) {
    super();
    this.addChild({});
    this.updateContent(text);
  }
  setTextColorTransform(transform?: (text: string) => string) { this.transform = transform; }
  updateContent(text: string) { this.text = text; }
  invalidate() { this.invalidations++; this.updateContent(this.text); }
  render() { return this.transform?.(this.text) ?? this.text; }
}

function installExtension(withContainer = true) {
  const pi = {
    pi: {
      getAgentDir: () => stateDir,
      Theme,
      setThemeInstance: (theme: Theme) => { activeTheme = theme; },
      get theme() { return activeTheme; },
      ...(withContainer ? { Container: MockContainer } : {}),
    },
    registerCommand(name: string, opts: { handler: Command }) {
      commandName = name;
      command = opts.handler;
    },
    on(name: string, handler: Handler) {
      handlers[name] = handler;
    },
  };
  uwuExtension(pi as never);
}

beforeEach(async () => {
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
  stateDir = await mkdtemp(join(tmpdir(), "omp-uwu-test-"));
  notices = [];
  handlers = {};
  baseTheme = await getThemeByName("dark") as Theme;
  activeTheme = baseTheme;
  installExtension();
});
afterEach(() => {
  installSparkles(MockContainer, { isActive: () => false, transform: (text) => text }).dispose();
});
afterAll(async () => {
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});


describe("omp-uwu", () => {
  test("registers /uwu and assistant_message hook", () => {
    expect(commandName).toBe("uwu");
    expect(handlers.assistant_message).toBeFunction();
  });

  test("prompt-styles the first turn, then rewrites finalized text blocks", async () => {
    const first = await handlers.before_agent_start(event(), { agent: { kind: "main" } }) as AgentStartResult;
    expect(first?.systemPrompt).toContain(UWU_PROMPT);
    await handlers.assistant_message({ message: { role: "assistant", content: [{ type: "text", text: "first reply" }] } });
    expect(await handlers.before_agent_start(event(), { agent: { kind: "main" } })).toBeUndefined();

    const content = [{ type: "text", text: "really nice!" }, { type: "toolCall", id: "keep" }];
    const result = await handlers.assistant_message({ message: { role: "assistant", content } }) as RewriteResult;
    expect(result?.content).toHaveLength(2);
    expect(result?.content[0]?.text).not.toBe("really nice!");
    expect(result?.content[1]).toEqual(content[1]);
  });

  test("does not mutate input blocks", async () => {
    const content = [{ type: "text", text: "really nice!" }];
    await handlers.assistant_message({ message: { role: "assistant", content } });
    expect(content[0].text).toBe("really nice!");
  });

  test("falls back to prompt mode when host lacks the rewrite hook", async () => {
    await handlers.message_end({ message: { role: "assistant", stopReason: "stop" } });
    const input = event();
    expect((await handlers.before_agent_start(input, { agent: { kind: "main" } })) as AgentStartResult).toEqual({
      systemPrompt: ["base policy", UWU_PROMPT],
    });
    expect(input.systemPrompt).toEqual(["base policy"]);
  });

  test("/uwu off disables, /uwu on enables", async () => {
    await command("off", ctx);
    expect(await handlers.before_agent_start(event(), { agent: { kind: "main" } })).toBeUndefined();
    await command(" ON ", ctx);
    await handlers.message_end({ message: { role: "assistant", stopReason: "stop" } });
    expect(((await handlers.before_agent_start(event(), { agent: { kind: "main" } })) as AgentStartResult)?.systemPrompt).toContain(UWU_PROMPT);
  });

  test("remembers /uwu off across extension reloads", async () => {
    await command("off", ctx);
    handlers = {};
    installExtension();
    expect(await handlers.before_agent_start(event(), { agent: { kind: "main" } })).toBeUndefined();
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: false, colors: false, style: "rewrite", level: "mid", locale: "auto" });
  });

  test("applies reversible pastel chat colors only in the TUI", async () => {
    await handlers.session_start({}, ctx);
    expect(activeTheme).toBe(baseTheme);
    await command("colors on", ctx);
    const kawaiiTheme = activeTheme;
    expect(kawaiiTheme).not.toBe(baseTheme);
    expect(kawaiiTheme.getColorHex("mdHeading")).toBe("#ff9ed8");
    expect(kawaiiTheme.getColorHex("error")).toBe(baseTheme.getColorHex("error"));

    await command("colors off", ctx);
    expect(activeTheme).toBe(baseTheme);
    await command("colors on", ctx);
    expect(activeTheme).not.toBe(baseTheme);
    await command("off", ctx);
    expect(activeTheme).toBe(baseTheme);
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: false, colors: true, style: "rewrite", level: "mid", locale: "auto" });
  });

  test("remembers the colors preference and only applies it in TUI sessions", async () => {
    await command("colors on", ctx);
    expect(activeTheme).not.toBe(baseTheme);
    activeTheme = baseTheme;
    handlers = {};
    installExtension();
    const rpcContext = { mode: "rpc", ui: ctx.ui };
    await handlers.session_start({}, rpcContext);
    expect(activeTheme).toBe(baseTheme);
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: true, colors: true, style: "rewrite", level: "mid", locale: "auto" });
  });

  test("/uwu prompt selects live prompt-based style", async () => {
    await command("prompt", ctx);
    expect(((await handlers.before_agent_start(event(), { agent: { kind: "main" } })) as AgentStartResult)?.systemPrompt).toContain(UWU_PROMPT);
  });

  test("prompt protects exact-text surfaces and includes varied kaomoji", () => {
    for (const surface of ["code", "file paths", "URLs", "tool call arguments", "commit messages", "٩(◕‿◕｡)۶", "(ฅ^•ﻌ•^ฅ)"]) {
      expect(UWU_PROMPT).toContain(surface);
    }
  });

  test("persists display, level and locale and restores them without prompt/history styling", async () => {
    await command("display", ctx);
    await command("level MAX", ctx);
    await command("locale TR", ctx);
    await command("colors on", ctx);
    await command("off", ctx);
    const saved = { enabled: false, colors: true, style: "display", level: "max", locale: "tr" };
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual(saved);
    handlers = {};
    installExtension();
    await handlers.session_start({}, ctx);
    await command("status", ctx);
    expect(notices.at(-1)).toContain("uwu off; style=display; level=max; locale=tr; colors=on");
    await command("on", ctx);
    expect(await handlers.before_agent_start(event(), { agent: { kind: "main" } })).toBeUndefined();
    const content = [{ type: "text", text: "really lovely" }, { type: "toolCall", id: "exact" }];
    expect(await handlers.assistant_message({ message: { role: "assistant", content } })).toBeUndefined();
    expect(content).toEqual([{ type: "text", text: "really lovely" }, { type: "toolCall", id: "exact" }]);
    expect(new MockAssistant("really lovely").render()).toBe(sparkle(uwufyProse("really lovely", { level: "max", locale: "tr" }), themePaint(() => activeTheme)));
  });

  test("old settings keep compatible rewrite/mid/auto defaults", async () => {
    await Bun.write(join(stateDir, "omp-uwu.json"), JSON.stringify({ enabled: false, colors: true }));
    await handlers.session_start({}, ctx);
    await command("status", ctx);
    expect(notices.at(-1)).toContain("uwu off; style=rewrite; level=mid; locale=auto; colors=on");
    await command("on", ctx);
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: true, colors: true, style: "rewrite", level: "mid", locale: "auto" });
  });

  test("invalid stored settings retain safe defaults", async () => {
    await Bun.write(join(stateDir, "omp-uwu.json"), JSON.stringify({ enabled: "false", colors: 1, style: "other", level: "ultra", locale: "de" }));
    await handlers.session_start({}, ctx);
    await command("status", ctx);
    expect(notices.at(-1)).toContain("uwu on; style=rewrite; level=mid; locale=auto; colors=off");
  });

  test("display refreshes existing prose with colors off and honors level/locale/off changes", async () => {
    const text = "really lovely northern flowers yoktur tehlikelidir";
    const component = new MockAssistant(text);
    expect(component.render()).toBe(text);
    await command("display", ctx);
    expect(component.render()).toBe(uwufyProse(text));
    expect(component.invalidations).toBeGreaterThan(0);
    expect(activeTheme).toBe(baseTheme);
    await command("level low", ctx);
    expect(component.render()).toBe(uwufyProse(text, { level: "low", locale: "auto" }));
    await command("locale en", ctx);
    expect(component.render()).toBe(uwufyProse(text, { level: "low", locale: "en" }));
    await command("level max", ctx);
    expect(component.render()).toBe(uwufyProse(text, { level: "max", locale: "en" }));
    await command("off", ctx);
    expect(component.render()).toBe(text);
    await command("on", ctx);
    expect(component.render()).toBe(uwufyProse(text, { level: "max", locale: "en" }));
    await command("rewrite", ctx);
    expect(component.render()).toBe(text);
  });

  test("composes sparkles after display prose and leaves host transforms authoritative", async () => {
    const text = "really lovely uwu";
    const component = new MockAssistant(text);
    await command("display", ctx);
    await command("colors on", ctx);
    const expected = sparkle(uwufyProse(text), themePaint(() => activeTheme));
    expect(component.render()).toBe(expected);
    component.setTextColorTransform((run) => `HOST:${run}`);
    component.updateContent(text);
    await command("level max", ctx);
    await command("colors off", ctx);
    expect(component.render()).toBe(`HOST:${text}`);
    component.setTextColorTransform(undefined);
    component.invalidate();
    expect(component.render()).toBe(uwufyProse(text, { level: "max" }));
  });

  test("display never falls back to a prompt even without a Container or rewrite hook", async () => {
    installExtension(false);
    await command("display", ctx);
    await handlers.message_end({ message: { role: "assistant", stopReason: "stop" } });
    const input = event();
    expect(await handlers.before_agent_start(input, { agent: { kind: "main" } })).toBeUndefined();
    expect(input.systemPrompt).toEqual(["base policy"]);
    expect(await handlers.assistant_message({ message: { role: "assistant", content: [{ type: "text", text: "really lovely" }] } })).toBeUndefined();
    await command("status", ctx);
    expect(notices.at(-1)).toContain("display=unavailable (no Container)");
    expect(notices.at(-1)).toContain("native/client display=unsupported; prompt fallback=off");
  });

  test("status reports observation honestly and never changes settings", async () => {
    const file = Bun.file(join(stateDir, "omp-uwu.json"));
    await command("status", ctx);
    expect(notices.at(-1)).toContain("rewrite=unknown; display=pending component discovery");
    expect(await file.exists()).toBe(false);
    new MockAssistant("really lovely");
    await handlers.assistant_message({ message: { role: "assistant", content: [] } });
    await command("status", ctx);
    expect(notices.at(-1)).toContain("rewrite=detected; display=ANSI hook detected");
    expect(await file.exists()).toBe(false);
  });

  test("preview keeps sample case and settings unchanged, even while disabled", async () => {
    await command("off", ctx);
    await command("level max", ctx);
    await command("locale tr", ctx);
    const file = Bun.file(join(stateDir, "omp-uwu.json"));
    const saved = await file.text();
    const sample = 'Really Lovely rELAX `src/URL.ts` "Warning"';
    await command(`PrEvIeW ${sample}`, ctx);
    expect(notices.at(-1)).toBe(uwufy(sample, { level: "max", locale: "tr" }));
    expect(await file.text()).toBe(saved);
    await command("display", ctx);
    const displaySaved = await file.text();
    await command(`preview ${sample}`, ctx);
    expect(notices.at(-1)).toBe(uwufyProse(sample, { level: "max", locale: "tr" }));
    expect(await file.text()).toBe(displaySaved);
  });

  test("invalid commands and empty previews do not mutate settings", async () => {
    for (const input of ["level", "level ultra", "locale de", "display yes", "colors maybe", "status yes", "preview"]) {
      await command(input, ctx);
      expect(notices.at(-1)).toContain("Usage: /uwu");
      expect(await Bun.file(join(stateDir, "omp-uwu.json")).exists()).toBe(false);
    }
  });

  test("rewrite and prompt use the selected intensity and locale", async () => {
    await command("level low", ctx);
    await command("locale tr", ctx);
    const input = { message: { role: "assistant", content: [{ type: "text", text: "really lovely yoktur" }] } };
    const result = await handlers.assistant_message(input) as RewriteResult;
    expect(result?.content[0]?.text ?? input.message.content[0].text).toBe(uwufy(input.message.content[0].text, { level: "low", locale: "tr" }));
    await command("prompt", ctx);
    const low = await handlers.before_agent_start(event(), { agent: { kind: "main" } }) as AgentStartResult;
    expect(low?.systemPrompt[1]).toContain("light, mostly unchanged");
    expect(low?.systemPrompt[1]).toContain("Turkish-aware");
    expect(low?.systemPrompt[1]).toContain("English critical words remain protected");
    await command("level max", ctx);
    await command("locale en", ctx);
    const max = await handlers.before_agent_start(event(), { agent: { kind: "main" } }) as AgentStartResult;
    expect(max?.systemPrompt[1]).toContain("stronger but readable");
    expect(max?.systemPrompt[1]).toContain("English-focused");
    expect(max?.systemPrompt[1]).not.toContain("Turkish-aware");
  });

  test("subagent turns never style prompts, rewrites, displays or command settings", async () => {
    const sub = { ...ctx, agent: { kind: "sub" } };
    const text = "really lovely";
    const component = new MockAssistant(text);
    expect(await handlers.before_agent_start(event(), sub)).toBeUndefined();
    expect(await handlers.assistant_message({ message: { role: "assistant", content: [{ type: "text", text }] } }, sub)).toBeUndefined();
    await handlers.message_end({ message: { role: "assistant", stopReason: "stop" } }, sub);
    await command("display", sub);
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).exists()).toBe(false);
    await command("status", ctx);
    expect(notices.at(-1)).toContain("rewrite=unknown");
    await command("display", ctx);
    await handlers.session_start({}, sub);
    expect(component.render()).toBe(text);
    expect(activeTheme).toBe(baseTheme);
  });
});
