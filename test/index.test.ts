import { beforeEach, describe, expect, test } from "bun:test";
import uwuExtension, { UWU_PROMPT } from "../src/index.ts";

type Handler = (event: { systemPrompt: string[] }) => Promise<{ systemPrompt: string[] } | undefined>;
type Command = (args: string, ctx: unknown) => Promise<void>;

let beforeAgentStart: Handler;
let command: Command;
let commandName: string;
let notices: string[];
const ctx = { ui: { notify: (msg: string) => notices.push(msg) } };
const event = () => ({ systemPrompt: ["base policy"] });

beforeEach(() => {
	notices = [];
	const pi = {
		registerCommand(name: string, opts: { handler: Command }) {
			commandName = name;
			command = opts.handler;
		},
		on(name: string, handler: Handler) {
			expect(name).toBe("before_agent_start");
			beforeAgentStart = handler;
		},
	};
	uwuExtension(pi as never);
});

describe("omp-uwu", () => {
	test("registers /uwu", () => {
		expect(commandName).toBe("uwu");
	});

	test("is on by default and appends the style after the existing prompt", async () => {
		const result = await beforeAgentStart(event());
		expect(result?.systemPrompt).toEqual(["base policy", UWU_PROMPT]);
	});

	test("does not mutate the incoming system prompt", async () => {
		const input = event();
		await beforeAgentStart(input);
		expect(input.systemPrompt).toEqual(["base policy"]);
	});

	test("/uwu off disables, /uwu on enables", async () => {
		await command("off", ctx);
		expect(await beforeAgentStart(event())).toBeUndefined();
		await command(" ON ", ctx);
		expect((await beforeAgentStart(event()))?.systemPrompt).toContain(UWU_PROMPT);
	});

	test("bare /uwu toggles", async () => {
		await command("", ctx);
		expect(await beforeAgentStart(event())).toBeUndefined();
		await command("", ctx);
		expect(await beforeAgentStart(event())).toBeDefined();
		expect(notices).toHaveLength(2);
	});

	test("prompt protects exact-text surfaces", () => {
		for (const surface of ["code", "file paths", "URLs", "tool call arguments", "commit messages"]) {
			expect(UWU_PROMPT).toContain(surface);
		}
	});
});
