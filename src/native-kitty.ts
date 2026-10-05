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

/** TSP has no custom spinner frames: repaint only the main working-row cat. */
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
  const cache = new WeakMap<NativeNode, { pose: string; node: NativeNode }>();
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
    if (cx.reduceMotion || stopped.has(this) || !native!()) cancel(this);
    else if (!timers.has(this) && owners.has(this)) {
      const instance = this;
      const cancelTimer = animationClock.schedule(() => {
        timers.delete(instance);
        if (!disposed && !stopped.has(instance) && native!()) owners.get(instance)?.requestComponentRender(instance);
      }, Math.max(1, control.periodMs - now % control.periodMs));
      timers.set(this, cancelTimer);
    }
    const cached = cache.get(source);
    if (cached?.pose === pose) return cached.node;
    const children = source.c!.slice();
    children[index] = { k: "text", key: "kitty", p: { spans: [{ t: pose, s: "accent" }], wrap: "none" } };
    const node = { ...source, c: children };
    cache.set(source, { pose, node });
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
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const instance of timers.keys()) cancel(instance);
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
