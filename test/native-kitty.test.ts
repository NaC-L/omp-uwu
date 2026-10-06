import { afterEach, describe, expect, test } from "bun:test";
import { Loader, TUI } from "@oh-my-pi/pi-tui";
import type { DescribeContext } from "@oh-my-pi/pi-tui/native/node";
import { Reconciler } from "@oh-my-pi/pi-tui/native/reconcile";
import { installNativeKitty } from "../src/native-kitty.ts";
import { buildKawaiiTheme, KITTY_POSE_MS, kittyPoseAt } from "../src/kawaii.ts";
import { Theme } from "@oh-my-pi/pi-coding-agent";

const base = new Theme({} as never, {} as never, "truecolor", "unicode", {});
const kittyTheme = buildKawaiiTheme(Theme, base);
let installed: { refresh(): void; dispose(): void } | undefined;
let originalRequest: TUI["requestComponentRender"] | undefined;
const loaders: Loader[] = [];
afterEach(() => {
  for (const loader of loaders) loader.dispose();
  loaders.length = 0;
  installed?.dispose();
  installed = undefined;
  if (originalRequest) TUI.prototype.requestComponentRender = originalRequest;
  originalRequest = undefined;
});

function setup(pose: (now: number) => string | undefined, roaming = false) {
  let native = true;
  let now = 0;
  let timer: (() => void) | undefined;
  let canceled = false;
  let renders = 0;
  const host = { Loader, TUI, isNativeRendering: () => native };
  originalRequest = TUI.prototype.requestComponentRender;
  TUI.prototype.requestComponentRender = () => { renders++; };
  const originalDescribe = Loader.prototype.describe;
  const animationClock = {
    now: () => now,
    schedule: (callback: () => void) => {
      timer = callback;
      canceled = false;
      return () => { canceled = true; timer = undefined; };
    },
  };
  installed = installNativeKitty(host, { periodMs: KITTY_POSE_MS, pose }, animationClock);
  const ui = Object.create(TUI.prototype) as TUI;
  const writes: string[] = [];
  ui.terminal = { write: (data: string) => { writes.push(data); } } as unknown as TUI["terminal"];
  ui.requestRender = () => { renders++; };
  const loader = new Loader(ui, (text) => text, (text) => text, "working", [" esc"]);
  loaders.push(loader);
  loader.setWorkingRow(() => ({ label: "Working", startedAt: 0, interruptKey: "escape" }), () => {});
  const cx = { cols: 80, reduceMotion: false, dark: true, supports: () => true, feature: (name: string) => roaming && name === "styles" } as DescribeContext;
  return {
    loader, ui, cx, host, animationClock, writes,
    original: () => originalDescribe.call(loader, cx),
    tick(at: number) { now = at; timer?.(); },
    get canceled() { return canceled; }, get renders() { return renders; },
    setNative(value: boolean) { native = value; },
  };
}

describe("native kitty", () => {
  test("roams in a hoisted non-modal layer without changing the working row or sending animation repaints", () => {
    let active = true;
    const state = setup((now) => active ? kittyPoseAt(kittyTheme, now) : undefined, true);
    const source = state.original();
    const first = state.loader.describe(state.cx);
    for (const [index, child] of (source.c ?? []).entries()) expect(first.c?.[index]).toBe(child);
    expect(first.c?.at(-1)).toMatchObject({
      k: "overlay", key: "kitty", p: { role: "uwu.kitty.roam", modal: false, size: "sm" },
      c: [{ k: "row", p: { role: "uwu.kitty.walk" }, c: [
        { k: "text", p: { role: "uwu.kitty.pose", spans: [{ t: "ᓚᘏᗢ", s: "accent" }] } },
        { k: "text", p: { role: "uwu.kitty.step", spans: [{ t: "ᓗᘎᗢ", s: "accent" }] } },
      ] }],
    });
    const reconciler = new Reconciler("kitty-smoke");
    const ops = reconciler.reconcile({ main: [state.loader], dock: [], layer: [] }, state.cx);
    const overlay = ops.find((op) => op[0] === "add" && op[2] === "layer" && op[4]?.k === "overlay");
    expect(overlay).toBeDefined();
    const renders = state.renders;
    state.tick(KITTY_POSE_MS * 5);
    expect(state.renders).toBe(renders);
    expect(state.loader.describe(state.cx)).toBe(first);
    active = false;
    installed!.refresh();
    expect(state.renders).toBeGreaterThan(renders);
    const off = state.loader.describe(state.cx);
    expect(off.c?.some((child) => "k" in child && child.k === "overlay")).toBe(false);
    expect(off.c?.[0]).toMatchObject({ k: "spinner" });
    active = true;
    expect(state.loader.describe(state.cx).c?.at(-1)).toMatchObject({ k: "overlay" });
    installed!.dispose();
    expect(state.loader.describe(state.cx).c?.some((child) => "k" in child && child.k === "overlay")).toBe(false);
    expect(state.writes.at(-1)).toContain('"css":""');
  });

  test("reduced motion keeps the roaming cat still and switching back preserves its layer identity", () => {
    const state = setup((now) => kittyPoseAt(kittyTheme, now), true);
    const still = state.loader.describe({ ...state.cx, reduceMotion: true });
    expect(still.c?.at(-1)).toMatchObject({ key: "kitty", c: [{ p: { role: "uwu.kitty.still" } }] });
    const renders = state.renders;
    state.tick(KITTY_POSE_MS);
    expect(state.renders).toBe(renders);
    const moving = state.loader.describe(state.cx);
    expect(moving.c?.at(-1)).toMatchObject({ key: "kitty", c: [{ p: { role: "uwu.kitty.walk" } }] });
  });

  test("replaces only the working spinner and advances on host repaint requests", () => {
    const state = setup((now) => kittyPoseAt(kittyTheme, now));
    const first = state.loader.describe(state.cx);
    expect(first.k).toBe("row");
    expect(state.original().c?.[0]).toMatchObject({ k: "spinner", key: "spinner" });
    if (first.k !== "row") throw new Error("expected working row");
    expect(first.p?.role).toBe("omp.working");
    expect(first.c?.[0]).toMatchObject({ k: "text", key: "kitty" });
    expect(first.c?.some((child) => "k" in child && child.k === "spinner")).toBe(false);
    const kitty = first.c?.[0];
    expect(kitty).toMatchObject({ k: "text", key: "kitty", p: { spans: [{ t: "ᓚᘏᗢ    ", s: "accent" }], wrap: "none" } });
    const samePose = state.loader.describe(state.cx);
    expect(samePose).toBe(first);
    const untouched = first.c?.slice(1);
    state.tick(KITTY_POSE_MS);
    expect(state.renders).toBe(2);
    const advanced = state.loader.describe(state.cx);
    expect(advanced).not.toBe(first);
    expect(advanced.c?.[0]).toMatchObject({ p: { spans: [{ t: " ᓗᘎᗢ   " }] } });
    for (const [index, child] of (advanced.c?.slice(1) ?? []).entries()) expect(child).toBe(untouched![index]!);
    state.loader.stop();
    expect(state.canceled).toBe(true);
  });

  test("restores the native spinner when colors turn off and does not animate reduced motion", () => {
    let active = true;
    const state = setup((now) => active ? kittyPoseAt(kittyTheme, now) : undefined);
    const first = state.loader.describe(state.cx);
    active = false;
    const restored = state.loader.describe(state.cx);
    expect(restored).not.toBe(first);
    expect(restored.c?.[0]).toMatchObject({ k: "spinner", key: "spinner" });
    expect(state.canceled).toBe(true);

    active = true;
    const reduced = { ...state.cx, reduceMotion: true } as DescribeContext;
    const staticCat = state.loader.describe(reduced);
    expect(staticCat.c?.[0]).toMatchObject({ k: "text", key: "kitty" });
    expect(state.canceled).toBe(true);
  });

  test("preserves retry countdown rows and ordinary loaders", () => {
    const state = setup((now) => kittyPoseAt(kittyTheme, now));
    state.loader.setWorkingRow(() => ({
      label: "Retrying", startedAt: 0, variant: { kind: "retry", attempt: 1, max: 3, delayMs: 1000 },
    }), () => {});
    const retry = state.loader.describe(state.cx);
    expect(retry.c?.[0]).toMatchObject({ k: "meter", key: "countdown" });
    const ordinary = new Loader(state.ui, (text) => text, (text) => text, "Ordinary loader");
    loaders.push(ordinary);
    const row = ordinary.describe(state.cx);
    expect(row.p?.role).toBe("omp.loader");
    const group = row.c?.[0];
    expect(group && "k" in group ? group.c?.[0] : undefined).toMatchObject({ k: "spinner" });
    expect(row.c?.some((child) => "key" in child && child.key === "kitty")).toBe(false);
  });

  test("reload replaces the clock without freezing an existing loader or letting stale disposal remove the new hook", () => {
    const state = setup((now) => kittyPoseAt(kittyTheme, now));
    state.loader.describe(state.cx);
    const previous = installed!;
    installed = installNativeKitty(state.host, { periodMs: KITTY_POSE_MS, pose: (now) => kittyPoseAt(kittyTheme, now) }, state.animationClock);
    expect(state.canceled).toBe(true);
    previous.dispose();
    state.loader.describe(state.cx);
    state.tick(KITTY_POSE_MS);
    expect(state.renders).toBe(2);
    expect(state.loader.describe(state.cx).c?.[0]).toMatchObject({ k: "text", key: "kitty" });
    installed.dispose();
    expect(state.canceled).toBe(true);
    expect(state.loader.describe(state.cx).c?.[0]).toMatchObject({ k: "spinner", key: "spinner" });
  });
});
