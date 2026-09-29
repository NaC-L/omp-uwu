import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, test } from "bun:test";
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
const ctx = { mode: "tui", ui: { notify: (msg: string) => notices.push(msg), setStatus: () => {} } };
const event = () => ({ systemPrompt: ["base policy"] });

function installExtension() {
  const pi = {
    pi: { getAgentDir: () => stateDir },
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
  installExtension();
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
    expect(await Bun.file(join(stateDir, "omp-uwu.json")).json()).toEqual({ enabled: false });
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
