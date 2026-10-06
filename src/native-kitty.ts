import type { Loader, TUI } from "@oh-my-pi/pi-tui";
import type { NativeNode } from "@oh-my-pi/pi-tui/native/node";

const REGISTRY = Symbol.for("omp-uwu.native-kitty");
type Host = {
  Loader?: { prototype: Loader };
  TUI?: { prototype: TUI };
  isNativeRendering?: () => boolean;
};
type Control = { periodMs: number; pose(now: number): string | undefined };
type Clock = { now(): number; schedule(callback: () => void, delay: number): () => void };
const clock: Clock = {
  now: Date.now,
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

// Tern owns the animation clock and pane geometry. A non-modal, hoisted
// overlay leaves the working label and keyboard/pointer targets untouched.
const ROAM_STYLES = `
[data-role="uwu.kitty.roam"] {
  position: absolute; inset: 0; width: 100% !important; height: 100% !important;
  max-width: none !important; max-height: none !important; padding: 0; pointer-events: none;
}
[data-role="uwu.kitty.roam"] .sf-ov-card {
  position: absolute; inset: 0; width: 100% !important; height: 100% !important;
  max-width: none !important; max-height: none !important; margin: 0; padding: 0;
  background: transparent; border: none; box-shadow: none;
  backdrop-filter: none; border-radius: 0; pointer-events: none;
  animation: none; overflow: hidden;
}
[data-role="uwu.kitty.roam"] .sf-ov-card::after { display: none; }
[data-role="uwu.kitty.roam"] .sf-ov-body {
  position: absolute; inset: 8px 8px 48px 8px; padding: 0;
  overflow: hidden; pointer-events: none;
}
[data-role="uwu.kitty.walk"], [data-role="uwu.kitty.still"] {
  position: absolute; left: 0; top: calc(100% - 3em);
  font-size: 16px; width: 3em; height: 3em; pointer-events: none;
  transform-origin: center;
}
[data-role="uwu.kitty.walk"] { animation: uwu-kitty-crawl 40s linear infinite; }
[data-role="uwu.kitty.pose"], [data-role="uwu.kitty.step"] {
  position: absolute; left: 0; top: 0.75em; width: 3em; height: 1.5em;
  pointer-events: none; animation: uwu-kitty-gait 480ms steps(1, end) infinite;
}
[data-role="uwu.kitty.step"] { opacity: 0; animation-delay: -240ms; }
@keyframes uwu-kitty-gait {
  0%, 100% { opacity: 1; transform: translateY(0); }
  50% { opacity: 0; transform: translateY(-1px); }
}
@keyframes uwu-kitty-crawl {
  0% { left: 0; top: calc(100% - 3em); transform: rotate(0deg); }
  29% { left: calc(100% - 3em); top: calc(100% - 3em); transform: rotate(0deg); }
  31% { left: calc(100% - 3em); top: calc(100% - 3em); transform: rotate(-90deg); }
  48% { left: calc(100% - 3em); top: 0; transform: rotate(-90deg); }
  50% { left: calc(100% - 3em); top: 0; transform: rotate(-180deg); }
  79% { left: 0; top: 0; transform: rotate(-180deg); }
  81% { left: 0; top: 0; transform: rotate(-270deg); }
  98% { left: 0; top: calc(100% - 3em); transform: rotate(-270deg); }
  100% { left: 0; top: calc(100% - 3em); transform: rotate(-360deg); }
}
@media (prefers-reduced-motion: reduce) {
  [data-role="uwu.kitty.walk"], [data-role="uwu.kitty.pose"], [data-role="uwu.kitty.step"] { animation: none; }
}
`;

/** Roam in a Tern pane with styles; older terminals retain the spinner lane. */
export function installNativeKitty(host: Host, control: Control, animationClock: Clock = clock) {
  const loader = host.Loader?.prototype;
  const tui = host.TUI?.prototype;
  const native = host.isNativeRendering;
  const unsupported = { refresh() {}, dispose() {} };
  if (!loader || !tui || !native ||
      !["describe", "setWorkingRow", "start", "stop"].every((key) =>
        typeof Object.getOwnPropertyDescriptor(loader, key)?.value === "function") ||
      typeof Object.getOwnPropertyDescriptor(tui, "requestComponentRender")?.value !== "function") return unsupported;

  // Reloads retain weak owner/lifecycle links, but never inherit animation timers.
  const previous = (loader as unknown as Record<symbol, {
    dispose(): void; owners: WeakMap<Loader, TUI>; stopped: WeakSet<Loader>;
  }>)[REGISTRY];
  previous?.dispose();
  const originalDescribe = loader.describe;
  const originalStart = loader.start;
  const originalStop = loader.stop;
  const originalRequest = tui.requestComponentRender;
  const owners = previous?.owners ?? new WeakMap<Loader, TUI>();
  const stopped = previous?.stopped ?? new WeakSet<Loader>();
  const timers = new Map<Loader, () => void>();
  const cache = new WeakMap<NativeNode, { pose: string; step: string | undefined; roaming: boolean; still: boolean; node: NativeNode }>();
  const styled = new Set<TUI>();
  let disposed = false;

  const cancel = (instance: Loader) => {
    timers.get(instance)?.();
    timers.delete(instance);
  };
  function request(this: TUI, component: Parameters<TUI["requestComponentRender"]>[0]) {
    if (loader!.isPrototypeOf(component)) owners.set(component as Loader, this);
    return originalRequest.call(this, component);
  }
  function start(this: Loader) {
    stopped.delete(this);
    return originalStart.call(this);
  }
  function stop(this: Loader) {
    stopped.add(this);
    cancel(this);
    return originalStop.call(this);
  }
  function describe(this: Loader, cx: Parameters<Loader["describe"]>[0]): NativeNode {
    const source = originalDescribe.call(this, cx);
    const now = animationClock.now();
    const pose = control.pose(cx.reduceMotion ? 0 : now);
    const index = source.k === "row" && source.p?.role === "omp.working"
      ? source.c?.findIndex((child) => "k" in child && child.k === "spinner" && child.key === "spinner") ?? -1
      : -1;
    if (pose === undefined || index < 0 || disposed) {
      cancel(this);
      return source;
    }
    const owner = owners.get(this);
    const roaming = cx.feature("styles") && owner?.terminal !== undefined && native!();
    if (roaming && !styled.has(owner)) {
      owner.terminal.write(`\x1b_tsp;s;${JSON.stringify({ name: "omp-uwu-kitty", css: ROAM_STYLES })}\x1b\\`);
      styled.add(owner);
    }
    if (roaming || cx.reduceMotion || stopped.has(this) || !native!()) cancel(this);
    else if (!timers.has(this) && owners.has(this)) {
      const instance = this;
      const cancelTimer = animationClock.schedule(() => {
        timers.delete(instance);
        if (!disposed && !stopped.has(instance) && native!()) owners.get(instance)?.requestComponentRender(instance);
      }, Math.max(1, control.periodMs - now % control.periodMs));
      timers.set(this, cancelTimer);
    }
    const displayPose = roaming ? (control.pose(0) ?? pose).trim() : pose;
    const step = roaming && !cx.reduceMotion ? (control.pose(control.periodMs) ?? pose).trim() : undefined;
    const cached = cache.get(source);
    if (cached?.pose === displayPose && cached.step === step && cached.roaming === roaming && cached.still === cx.reduceMotion) return cached.node;
    const children = source.c!.slice();
    if (roaming) {
      children.push({
        k: "overlay", key: "kitty", p: { role: "uwu.kitty.roam", modal: false, size: "sm" },
        c: [step === undefined
          ? { k: "text", key: "cat", p: { role: "uwu.kitty.still", spans: [{ t: displayPose, s: "accent" }], wrap: "none" } }
          : { k: "row", key: "cat", p: { role: "uwu.kitty.walk" }, c: [
              { k: "text", key: "pose", p: { role: "uwu.kitty.pose", spans: [{ t: displayPose, s: "accent" }], wrap: "none" } },
              { k: "text", key: "step", p: { role: "uwu.kitty.step", spans: [{ t: step, s: "accent" }], wrap: "none" } },
            ] }],
      });
    } else {
      children[index] = { k: "text", key: "kitty", p: { spans: [{ t: pose, s: "accent" }], wrap: "none" } };
    }
    const node = { ...source, c: children };
    cache.set(source, { pose: displayPose, step, roaming, still: cx.reduceMotion, node });
    return node;
  }
  loader.describe = describe;
  loader.start = start;
  loader.stop = stop;
  tui.requestComponentRender = request;
  const installation = {
    refresh() {
      for (const instance of timers.keys()) {
        cancel(instance);
        owners.get(instance)?.requestComponentRender(instance);
      }
      for (const owner of styled) owner.requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of timers.keys()) cancel(instance);
      if (native!()) for (const owner of styled) {
        owner.terminal.write('\x1b_tsp;s;{"name":"omp-uwu-kitty","css":""}\x1b\\');
        owner.requestRender();
      }
      styled.clear();
      if (loader.describe === describe) loader.describe = originalDescribe;
      if (loader.start === start) loader.start = originalStart;
      if (loader.stop === stop) loader.stop = originalStop;
      if (tui.requestComponentRender === request) tui.requestComponentRender = originalRequest;
      if ((loader as unknown as Record<symbol, unknown>)[REGISTRY] === registry) {
        delete (loader as unknown as Record<symbol, unknown>)[REGISTRY];
      }
    },
  };
  const registry = { ...installation, owners, stopped };
  Object.defineProperty(loader, REGISTRY, { value: registry, configurable: true });
  return installation;
}
