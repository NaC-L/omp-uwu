import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getThemeByName, Theme } from "@oh-my-pi/pi-coding-agent";
import uwuExtension, { UWU_PROMPT } from "../src/index.ts";

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

function installExtension() {
  const pi = {
    pi: {
      getAgentDir: () => stateDir,
      Theme,
      setThemeInstance: (theme: Theme) => { activeTheme = theme; },
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
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: false, colors: false });
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
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: false, colors: true });
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
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: true, colors: true });
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
});
