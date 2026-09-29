import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { getThemeByName, Theme, type ExtensionUIContext, type ExtensionUiComponent } from "@oh-my-pi/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@oh-my-pi/pi-tui";
import type { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import uwuExtension from "../src/index.ts";
import { installSparkles } from "../src/sparkle.ts";
import { uwufy, uwufyProse } from "../src/uwufy.ts";

type Handler = (...args: unknown[]) => unknown;
type Command = (args: string, ctx: unknown) => Promise<void>;
let dir: string;
let theme: Theme;
let dispose: (() => void) | undefined;
let restoreWriteSpy: (() => void) | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omp-uwu-status-"));
  theme = await getThemeByName("dark") as Theme;
});
afterEach(async () => {
  restoreWriteSpy?.();
  restoreWriteSpy = undefined;
  dispose?.();
  dispose = undefined;
  await rm(dir, { recursive: true, force: true });
});

function fixture(withContainer = true) {
  class Container { addChild(_child: unknown) {} }
  class Assistant extends Container {
    constructor() { super(); this.addChild({}); this.updateContent(); }
    transform?: (text: string) => string;
    setTextColorTransform(transform?: (text: string) => string) { this.transform = transform; }
    updateContent() {}
    invalidate() { mutations.push("refresh"); }
  }
  const handlers: Record<string, Handler> = {};
  let command!: Command;
  const mutations: string[] = [];
  const history = [{ role: "assistant", content: [{ type: "text", text: "really lovely `raw_history`" }] }];
  const notices: string[] = [];
  let component!: ExtensionUiComponent;
  let options: Parameters<ExtensionUIContext["custom"]>[1];
  let closeCount = 0;
  let onOpen = () => {};
  let renderCount = 0;
  const custom: ExtensionUIContext["custom"] = <T>(
    factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => ExtensionUiComponent | Promise<ExtensionUiComponent>,
    customOptions?: Parameters<ExtensionUIContext["custom"]>[1],
  ) => {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    options = customOptions;
    Promise.resolve(factory({ requestRender() { renderCount++; } } as never, theme, {} as never, (value) => {
      closeCount++;
      resolve(value);
    })).then((result) => {
      component = result;
      onOpen();
    }, reject);
    return promise;
  };
  const ui = {
    notify(message: string) { notices.push(message); },
    custom,
    get theme() { return theme; },
    setStatus() { mutations.push("setStatus"); },
  };
  uwuExtension({
    pi: {
      getAgentDir: () => dir,
      get theme() { return theme; },
      Theme,
      setThemeInstance(next: Theme) { theme = next; mutations.push("setThemeInstance"); },
      ...(withContainer ? { Container } : {}),
    },
    registerCommand(_name: string, registration: { handler: Command }) { command = registration.handler; },
    on(name: string, handler: Handler) { handlers[name] = handler; },
    sendMessage() { mutations.push("sendMessage"); },
    sendUserMessage() { mutations.push("sendUserMessage"); },
    appendEntry() { mutations.push("appendEntry"); },
  } as never);
  if (withContainer) dispose = () => installSparkles(Container, { isActive: () => false, transform: (text) => text }).dispose();
  return {
    command, handlers, notices, ui, history, mutations,
    discover() { return new Assistant(); },
    get closes() { return closeCount; },
    get renders() { return renderCount; },
    get options() { return options; },
    async status(mode = "tui") {
      const { promise: opened, resolve: open } = Promise.withResolvers<void>();
      onOpen = open;
      const finished = command("status", { mode, ui, sessionManager: { getBranch: () => history } });
      await opened;
      return { component, finished };
    },
  };
}

function content(component: ExtensionUiComponent, width = 80): string {
  return component.render(width).map(stripTerminalSequences).join("\n");
}

function press(component: ExtensionUiComponent, ...keys: string[]) {
  for (const key of keys) component.handleInput?.(key);
}

function flattened(component: ExtensionUiComponent, width: number): string {
  return content(component, width).replace(/[│\s]/g, "");
}

const sample = "Really lovely progress. Merhaba, bugün beraber çalışalım. Keep `raw_code` unchanged.";

describe("/uwu status dashboard", () => {
  test("actual custom factory returns grouped, themed, width-safe controls and compatibility tabs", async () => {
    const app = fixture();
    const { component, finished } = await app.status();
    expect(app.options).toEqual({ overlay: true, overlayOptions: { width: 68, anchor: "center", margin: 1 } });
    expect(component.render(0)).toEqual([]);
    expect(component.render(-1)).toEqual([]);
    for (const width of [1, 2, 3, 4, 12, 24, 48, 80]) {
      const lines = component.render(width);
      expect(lines.length).toBeGreaterThan(10);
      expect(lines.every((line) => visibleWidth(line) === Math.min(width, 68))).toBe(true);
      if (width >= 4) {
        expect(stripTerminalSequences(lines[0])).toMatch(/^╭─+╮$/);
        expect(stripTerminalSequences(lines.at(-1)!)).toMatch(/^╰─+╯$/);
      }
      for (const value of ["UwU", "[ON]", "Controls", "Compatibility", "›Mode", "Style", "Intensity", "mid", "Locale", "auto", "Kawaiicolors", "Save", "Draftunchanged", "Preview", "EnteronSave", "Esccancel"]) {
        expect(flattened(component, width)).toContain(value);
      }
    }
    const controls = component.render(80).join("\n");
    expect(controls).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ Controls ]"))));
    expect(controls).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ mid ]"))));
    expect(content(component)).toContain("▰▰▰▰▱▱");
    expect(content(component)).not.toContain("Observed capabilities");
    const firstRender = component.render(48);
    expect(component.invalidate).toBeFunction();
    component.invalidate!();
    expect(component.render(48)).toEqual(firstRender);

    press(component, "\t");
    expect(content(component)).toContain("Observed capabilities");
    expect(content(component)).not.toContain("Intensity");
    for (const width of [12, 24, 48, 80]) {
      expect(component.render(width).every((line) => visibleWidth(line) === Math.min(width, 68))).toBe(true);
      for (const value of ["Rewrite", "unknown", "pendingcomponentdiscovery", "unsupported", "Promptfallback", "on", "notasupportguarantee", "Tabcontrols", "Esccancel"]) {
        expect(flattened(component, width)).toContain(value);
      }
    }
    expect(app.notices).toEqual([]);
    press(component, "\u001b");
    await finished;
  });

  test("focus wraps; navigation and tabs never edit or save; compatibility ignores editing keys", async () => {
    const app = fixture();
    const { component, finished } = await app.status();
    press(component, "\u001b[A");
    expect(content(component)).toContain("› [ Save ]");
    press(component, " ", "\u001b[C", "\u001b[D");
    expect(content(component)).toContain("Draft unchanged");
    expect(app.closes).toBe(0);
    press(component, "\u001b[B", "\u001b[B");
    expect(content(component)).toContain("› Style");
    press(component, "\t");
    const compatibility = component.render(80);
    press(component, "\u001b[A", "\u001b[B", "\u001b[C", "\u001b[D", "\r", " ");
    expect(component.render(80)).toEqual(compatibility);
    press(component, "\u001b[9u");
    expect(content(component)).toContain("› Style");
    expect(content(component)).toContain("Draft unchanged");
    expect(app.renders).toBe(5);
    expect(app.mutations).toEqual([]);
    expect(await Bun.file(join(dir, "omp-uwu.json")).exists()).toBe(false);
    press(component, "\u001b");
    await finished;
  });

  test("switches, preset chips and meter edit only the focused draft using arrows, Enter and Space", async () => {
    const app = fixture();
    const { component, finished } = await app.status();
    press(component, "\r");
    expect(content(component)).toContain("[OFF]");
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ OFF ● ]"))));
    expect(content(component)).toContain("1 unsaved change");
    press(component, " ");
    expect(content(component)).toContain("Draft unchanged");
    press(component, "\u001b[B", "\u001b[D");
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ display ]"))));
    expect(content(component)).toContain("prose only · experimental");
    press(component, "\u001b[C", "\r");
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ prompt ]"))));
    expect(content(component)).toContain("approximation");
    press(component, "\u001b[B", "\u001b[D");
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ low ]"))));
    expect(content(component)).toContain("▰▰▱▱▱▱");
    press(component, "\u001b[D");
    expect(content(component)).toContain("▰▰▰▰▰▰");
    press(component, "\u001b[B", " ");
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ en ]"))));
    press(component, "\u001b[B", "\u001b[32u");
    expect(content(component)).toContain("4 unsaved changes");
    expect(app.closes).toBe(0);
    expect(app.mutations).toEqual([]);
    expect(await Bun.file(join(dir, "omp-uwu.json")).exists()).toBe(false);
    press(component, "\u001b");
    await finished;
  });

  for (const key of ["\u001b", "\u001b[27u"]) {
    test(`Escape cancels an edited draft without any mutation (${JSON.stringify(key)})`, async () => {
      const path = join(dir, "omp-uwu.json");
      const saved = '{ "enabled": true, "colors": false, "style": "rewrite", "level": "mid", "locale": "auto", "future": 7 }\n';
      await writeFile(path, saved);
      const app = fixture();
      const originalHistory = structuredClone(app.history);
      const { component, finished } = await app.status();
      press(component, " ", "\u001b[B", "\u001b[C", "\u001b[B", "\u001b[C", "\u001b[B", "\u001b[C", "\u001b[B", " ", "\u001b[B");
      expect(content(component)).toContain("5 unsaved changes");
      component.render(24);
      press(component, key, "\r", "\u001b[13u");
      await finished;
      expect(app.closes).toBe(1);
      expect(await readFile(path, "utf8")).toBe(saved);
      expect(app.history).toEqual(originalHistory);
      expect(app.mutations).toEqual([]);
      const input = { systemPrompt: ["base policy"] };
      const result = await app.handlers.before_agent_start(input, { agent: { kind: "main" } }) as { systemPrompt: string[] };
      expect(result.systemPrompt).toHaveLength(2);
      expect(input.systemPrompt).toEqual(["base policy"]);
    });
  }

  test("unknown and modified keys do not change focus, tabs or draft or close the overlay", async () => {
    const app = fixture();
    const { component, finished } = await app.status();
    const initial = component.render(80);
    press(component, "x", "q", "\u001b[13;5u", "\u001b[27;5u", "\u001b[32;5u", "\u001b[9;5u", "\u001b[Z", "\u001b[1;5A", "\u001b[1;2B", "\u001b[1;3C", "\u001b[1;5D");
    expect(component.render(80)).toEqual(initial);
    expect(app.closes).toBe(0);
    expect(app.renders).toBe(0);
    expect(app.mutations).toEqual([]);
    press(component, "\u001b");
    await finished;
  });

  for (const key of ["\r", "\u001b[13u"]) {
    test(`Enter on Save persists exactly once and syncs colors, rendering and badge once (${JSON.stringify(key)})`, async () => {
      const app = fixture();
      const assistant = app.discover();
      const originalHistory = structuredClone(app.history);
      const { component, finished } = await app.status();
      const writeSpy = spyOn(fs, "writeFile");
      restoreWriteSpy = () => writeSpy.mockRestore();
      press(component, "\u001b[B", "\u001b[D", "\u001b[B", "\u001b[C", "\u001b[B", "\u001b[D", "\u001b[B", " ", "\u001b[B");
      expect(content(component)).toContain("4 unsaved changes");
      expect(writeSpy).toHaveBeenCalledTimes(0);
      expect(app.mutations).toEqual([]);
      press(component, key, key, "\u001b");
      await finished;
      expect(app.closes).toBe(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(join(dir, "omp-uwu.json"), "utf8"))).toEqual({
        enabled: true, colors: true, style: "display", level: "max", locale: "tr",
      });
      expect(app.mutations).toEqual(["setThemeInstance", "refresh", "setStatus"]);
      expect(app.history).toEqual(originalHistory);
      expect(await app.handlers.before_agent_start({ systemPrompt: ["base"] }, { agent: { kind: "main" } })).toBeUndefined();
      assistant.updateContent();
      expect(assistant.transform).toBeFunction();
      expect(stripTerminalSequences(assistant.transform!(sample))).toBe(uwufyProse(sample, { level: "max", locale: "tr" }));
      expect(app.notices).toEqual([]);
      const reopened = await app.status();
      expect(content(reopened.component)).toContain("Draft unchanged");
      expect(reopened.component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ display ]"))));
      press(reopened.component, "\u001b");
      await reopened.finished;
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  }

  test("Save refreshes existing display messages with colors off, and colors off restores the host theme", async () => {
    await writeFile(join(dir, "omp-uwu.json"), JSON.stringify({ enabled: true, colors: true, style: "display", level: "mid", locale: "auto" }));
    const app = fixture();
    const baseTheme = theme;
    const assistant = app.discover();
    await app.handlers.session_start({}, { mode: "tui", ui: app.ui });
    expect(theme).not.toBe(baseTheme);
    app.mutations.length = 0;
    const { component, finished } = await app.status();
    press(component, "\u001b[B", "\u001b[B", "\u001b[C", "\u001b[B", "\u001b[B", " ", "\u001b[B", "\r");
    await finished;
    expect(theme).toBe(baseTheme);
    expect(app.mutations).toEqual(["setThemeInstance", "refresh", "setStatus"]);
    assistant.updateContent();
    expect(assistant.transform!(sample)).toBe(uwufyProse(sample, { level: "max", locale: "auto" }));
    app.mutations.length = 0;
    const reopened = await app.status();
    press(reopened.component, "\u001b[B", "\u001b[B", "\u001b[D", "\u001b[B", "\u001b[B", "\u001b[B", "\r");
    await reopened.finished;
    expect(app.mutations).toEqual(["refresh", "setStatus"]);
    assistant.updateContent();
    expect(assistant.transform!(sample)).toBe(uwufyProse(sample, { level: "mid", locale: "auto" }));
  });

  test("live samples use the draft style, intensity and locale without changing history or prompt settings", async () => {
    const app = fixture();
    const originalHistory = structuredClone(app.history);
    const { component, finished } = await app.status();
    expect(flattened(component, 80)).toContain(uwufy(sample, { level: "mid", locale: "auto" }).replace(/\s/g, ""));
    press(component, "\u001b[B", "\u001b[D", "\u001b[B", "\u001b[C", "\u001b[B", "\u001b[D");
    expect(flattened(component, 80)).toContain(uwufyProse(sample, { level: "max", locale: "tr" }).replace(/\s/g, ""));
    expect(content(component)).toContain("`raw_code`");
    press(component, "\u001b[A", "\u001b[A", "\u001b[A", " ");
    expect(content(component)).toContain("Preview · mode off");
    expect(flattened(component, 80)).toContain(sample.replace(/\s/g, ""));
    expect(app.history).toEqual(originalHistory);
    expect(app.mutations).toEqual([]);
    expect(await Bun.file(join(dir, "omp-uwu.json")).exists()).toBe(false);
    const result = await app.handlers.before_agent_start({ systemPrompt: ["base"] }, { agent: { kind: "main" } }) as { systemPrompt: string[] };
    expect(result.systemPrompt).toHaveLength(2);
    press(component, "\u001b");
    await finished;
  });

  test("saved OFF display settings remain byte-identical on cancel and display is experimental", async () => {
    const path = join(dir, "omp-uwu.json");
    const saved = '{ "enabled": false, "colors": true, "style": "display", "level": "max", "locale": "tr" }\n';
    await writeFile(path, saved);
    const app = fixture(false);
    const { component, finished } = await app.status();
    for (const width of [12, 24, 48, 80]) {
      expect(component.render(width).every((line) => visibleWidth(line) === Math.min(width, 68))).toBe(true);
      for (const value of ["[OFF]", "display", "max", "tr", "Kawaiicolors", "Preview·modeoff"]) expect(flattened(component, width)).toContain(value);
    }
    expect(component.render(80).join("\n")).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ ● ON ]"))));
    press(component, "\t");
    for (const width of [12, 24, 48, 80]) {
      expect(component.render(width).every((line) => visibleWidth(line) === Math.min(width, 68))).toBe(true);
      for (const value of ["unavailable(noContainer)", "Promptfallback", "off", "Displayisexperimental", "unsupported"]) expect(flattened(component, width)).toContain(value);
    }
    press(component, "\u001b");
    await finished;
    expect(await readFile(path, "utf8")).toBe(saved);
    expect(app.mutations).toEqual([]);
    expect(await app.handlers.before_agent_start({ systemPrompt: ["base"] }, { agent: { kind: "main" } })).toBeUndefined();
  });

  test("explicit prompt style reports low/en settings without rewrite fallback", async () => {
    const path = join(dir, "omp-uwu.json");
    const saved = '{ "enabled": true, "colors": false, "style": "prompt", "level": "low", "locale": "en" }\n';
    await writeFile(path, saved);
    const app = fixture();
    const { component, finished } = await app.status();
    const lines = component.render(80).join("\n");
    for (const value of ["prompt", "low", "en"]) expect(lines).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold(`[ ${value} ]`))));
    expect(content(component)).toContain("Preview · approximation");
    expect(content(component)).not.toContain("experimental");
    press(component, "\t");
    expect(content(component)).toContain("Prompt fallback off");
    press(component, "\u001b");
    await finished;
    expect(await readFile(path, "utf8")).toBe(saved);
    expect(app.mutations).toEqual([]);
  });

  for (const rewrite of ["unknown", "detected", "not observed"] as const) {
    test(`honest rewrite observation ${rewrite} and ANSI discovery remain on Compatibility`, async () => {
      const app = fixture();
      if (rewrite === "detected") {
        app.discover();
        await app.handlers.assistant_message({ message: { role: "assistant", content: [] } });
      } else if (rewrite === "not observed") {
        await app.handlers.message_end({ message: { role: "assistant", stopReason: "stop" } });
      }
      const { component, finished } = await app.status();
      press(component, "\u001b[B", "\u001b[D", "\t");
      const text = content(component);
      expect(text).toContain(`Rewrite         ${rewrite}`);
      expect(text).toContain(rewrite === "detected" ? "ANSI hook detected" : "pending component discovery");
      expect(text).toContain(`Prompt fallback ${rewrite === "detected" ? "off" : "on"}`);
      expect(text).toContain("saved rewrite/on settings, not the draft.");
      expect(text).toContain("Native/client   unsupported");
      press(component, "\u001b");
      await finished;
    });
  }

  test("dashboard uses the current light host theme supplied to the factory", async () => {
    theme = await getThemeByName("light") as Theme;
    const app = fixture();
    const { component, finished } = await app.status();
    const lines = component.render(80).join("\n");
    expect(lines).toContain(theme.fg("accent", theme.bold("UwU")));
    expect(lines).toContain(theme.fg("success", theme.bold("[ON]")));
    expect(lines).toContain(theme.bg("selectedBg", theme.fg("accent", theme.bold("[ rewrite ]"))));
    expect(lines).toContain(theme.fg("borderMuted", "╭" + "─".repeat(66) + "╮"));
    press(component, "\u001b");
    await finished;
  });

  for (const mode of ["rpc", "print", undefined]) {
    test(`non-TUI ${mode} retains the exact plain summary even when custom exists`, async () => {
      const app = fixture();
      await app.command("status", { mode, ui: app.ui });
      expect(app.options).toBeUndefined();
      expect(app.notices).toEqual(["uwu on; style=rewrite; level=mid; locale=auto; colors=off; rewrite=unknown; display=pending component discovery; native/client display=unsupported; prompt fallback=on"]);
      expect(await Bun.file(join(dir, "omp-uwu.json")).exists()).toBe(false);
      expect(app.mutations).toEqual([]);
    });
  }

  test("TUI without custom retains the exact plain summary", async () => {
    const app = fixture(false);
    const { custom: _custom, ...ui } = app.ui;
    await app.command("status", { mode: "tui", ui });
    expect(app.options).toBeUndefined();
    expect(app.notices).toEqual(["uwu on; style=rewrite; level=mid; locale=auto; colors=off; rewrite=unknown; display=unavailable (no Container); native/client display=unsupported; prompt fallback=on"]);
    expect(app.mutations).toEqual([]);
  });
});
