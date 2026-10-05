/**
 * Render-time "sparkles": paints kaomoji, uwu/owo and cute symbols in the
 * assistant's chat prose with the kawaii palette.
 *
 * Nothing is written into message text, history or model context. omp renders
 * assistant prose through a per-component ANSI text transform or Tern native
 * Markdown text/marks. Both paths leave code and link targets untouched;
 * native marks use one semantic color per literal token, not ANSI escapes.
 */
import type { Theme, ThemeColor } from "@oh-my-pi/pi-coding-agent";
import { EMOTICON_TOKENS } from "./uwufy.ts";

/** Palette keys the kawaii theme sets; painting rotates through them. */
const TONES: readonly ThemeColor[] = ["accent", "mdLink", "mdCode", "mdListBullet", "mdHeading", "thinkingText"];

/**
 * Decorative monochrome glyphs worth a tint on their own. Color emoji ignore fg,
 * and a glyph carrying VS16 renders as emoji, so those are left alone.
 */
const SYMBOLS = "♡✧☆★✿❀⋆";

// Known emoticons, longest first so a kaomoji wins over the uwu/♡ inside it.
// Word-edge guards keep `:3` in `a:3` or `owo` in `owowl` unpainted.
const KNOWN = [...EMOTICON_TOKENS]
	.filter((token) => !/^\p{Extended_Pictographic}+$/u.test(token))
	.sort((a, b) => b.length - a.length)
	.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
// Unlisted kaomoji: parentheses holding at least one face feature (eyes,
// mouths, cheeks), no digits and no two letters in a row, optionally hugged by
// up to two arm glyphs, and not glued to a word. So `(x−y)`, `(a—b)`,
// `(şimdi)` and `ş(a…)ı` stay plain.
const FEATURES = "◕ᴗω▽◡•ᵔ˘≧≦˃˂・･︶﹏‿꒳ᗜﻌ∀ヮ´︿◉⊙ಠ︵□ᴥ＾｡⌒⩊ᵕ≖ˆ˶˵ᐛ⁀﹃ↀ✧♡";
const ARMS = String.raw`٩۶ヽﾉノづっ✧♡☆⌒ヾᕕᕗ\\/`;
const FACE = String.raw`(?<![\p{L}\p{N}])[${ARMS}]{0,2}\((?=[^()\n]*[${FEATURES}])(?![^()\n]*(?:\p{L}\p{M}*){2})[^()\n\p{N}]{1,16}\)[${ARMS}]{0,2}(?![\p{L}\p{N}])`;
// Symbols take their combining marks along, so no color code splits a grapheme.
const SPARKLE = new RegExp(
	String.raw`(?<![\p{L}\p{N}_])(?:${KNOWN})(?![\p{L}\p{N}_])|${FACE}|[${SYMBOLS}](?!\p{M}*\uFE0F)\p{M}*`,
	"gu",
);
const LETTERS = /^\p{L}+$/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type Paint = (tone: ThemeColor, text: string) => string;

/** FNV-1a; picks a stable starting tone per token. */
function hash(value: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * Paint every sparkle in one plain-text run. Word emoticons (`uwu`, `OwO`) get
 * a per-letter rainbow; faces and symbols get one tone. Deterministic, so a
 * re-render of the same run yields the same bytes.
 */
export function sparkle(text: string, paint: Paint): string {
	let ordinal = 0;
	return text.replace(SPARKLE, (match) => {
		const start = hash(match) + ordinal++;
		if (!LETTERS.test(match)) return paint(TONES[start % TONES.length]!, match);
		let index = 0;
		let out = "";
		for (const { segment } of graphemes.segment(match)) out += paint(TONES[(start + index++) % TONES.length]!, segment);
		return out;
	});
}

/** Native Markdown marks style every prose occurrence of a literal token. */
export function sparkleMarks(text: string): { t: string; s: string }[] {
	const marks = new Map<string, { t: string; s: string }>();
	for (const [match] of text.matchAll(SPARKLE)) {
		if (match.length < 3 && /^[\x00-\x7f]+$/.test(match)) continue;
		if (!marks.has(match)) marks.set(match, { t: match, s: TONES[hash(match) % TONES.length]! });
	}
	return [...marks.values()];
}

/** A paint function over the live host theme; unknown colors fall back to plain text. */
export function themePaint(getTheme: () => Theme | undefined): Paint {
	return (tone, text) => {
		try {
			return getTheme()?.fg(tone, text) ?? text;
		} catch {
			return text;
		}
	};
}

type ColorTransform = (text: string) => string;

/** The assistant render methods shared with the host; native describe is optional. */
interface AssistantPrototype {
	updateContent(...args: unknown[]): unknown;
	setTextColorTransform(transform?: ColorTransform): void;
	describe?(...args: unknown[]): unknown;
}

/** omp's TUI `Container`, the base class of AssistantMessageComponent. */
export interface ContainerClass {
	prototype: { addChild(child: unknown): unknown };
}

export interface SparkleControl {
	/** Whether assistant prose should be transformed (independent of colors). */
	isActive(): boolean;
	transform: ColorTransform;
	native(text: string): { text: string; marks: readonly { t: string; s: string }[] };
}

export interface SparkleInstallation {
	/** Whether the assistant's ANSI prose hook was discovered. */
	isSupported(): boolean;
	/** Whether a Tern native describe hook was actually installed on that prototype. */
	isNativeSupported(): boolean;
	/** Refresh existing components, including when no theme change occurs. */
	refresh(): void;
	/** Restore host methods; useful for isolated integration tests. */
	dispose(): void;
}

/** Shared per host Container, so reloads replace controls without double patches. */
interface Registry {
	control: SparkleControl;
	transform: ColorTransform;
	assistant?: AssistantPrototype;
	nativeSupported?: boolean;
	components: Set<WeakRef<object & { invalidate?: () => void }>>;
	seen: WeakSet<object>;
	restoreAssistant?: () => void;
	restoreWatch?: () => void;
}
const REGISTRY = Symbol.for("omp-uwu.sparkles");

/** Walk up from an instance to the prototype that defines both assistant methods. */
function findAssistantPrototype(value: unknown): AssistantPrototype | undefined {
	for (let proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; proto; proto = Object.getPrototypeOf(proto)) {
		if (
			Object.hasOwn(proto, "setTextColorTransform") &&
			Object.hasOwn(proto, "updateContent") &&
			typeof proto.setTextColorTransform === "function" &&
			typeof proto.updateContent === "function"
		) {
			return proto as AssistantPrototype;
		}
	}
	return undefined;
}

/** Only these fields of the host's native description are inspected. */
interface NativeDescription {
	k?: unknown;
	key?: unknown;
	p?: unknown;
	c?: unknown;
}

/**
 * Give every assistant message component the sparkle transform while
 * `control.isActive()`. A transform set by the host itself (e.g. the
 * live-voice transcript tint) always wins over sparkles.
 */
function patchAssistant(proto: AssistantPrototype, registry: Registry): void {
	const originalSet = proto.setTextColorTransform;
	const originalUpdate = proto.updateContent;
	const hostTransforms = new WeakMap<object, ColorTransform>();
	const originalDescribe = Object.hasOwn(proto, "describe") && typeof proto.describe === "function" ? proto.describe : undefined;
	const nativeCache = new WeakMap<object, { token: ColorTransform; out: unknown }>();
	registry.nativeSupported = originalDescribe !== undefined;
	const applied = new WeakMap<object, ColorTransform | undefined>();

	proto.setTextColorTransform = function (this: object, transform?: ColorTransform) {
		if (transform) hostTransforms.set(this, transform);
		else hostTransforms.delete(this);
		applied.delete(this);
		originalSet.call(this, transform);
	};
	proto.updateContent = function (this: object, ...args: unknown[]) {
		if (!registry.seen.has(this)) {
			registry.seen.add(this);
			registry.components.add(new WeakRef(this));
		}
		if (!hostTransforms.has(this)) {
			const wanted = registry.control.isActive() ? registry.transform : undefined;
			if (applied.get(this) !== wanted) {
				applied.set(this, wanted);
				originalSet.call(this, wanted);
			}
		}
		return originalUpdate.apply(this, args);
	};
	if (originalDescribe) {
		proto.describe = function (this: object, ...args: unknown[]) {
			const source = originalDescribe.apply(this, args);
			if (!registry.control.isActive() || hostTransforms.has(this)) return source;
			if (source === null || typeof source !== "object" || Array.isArray(source)) return source;
			const root = source as NativeDescription;
			if (root.k !== "col" || !Array.isArray(root.c)) return source;
			const token = registry.transform;
			const cached = nativeCache.get(source);
			if (cached?.token === token) return cached.out;
			const children = root.c.map((child: unknown) => {
				if (child === null || typeof child !== "object" || Array.isArray(child)) return child;
				const node = child as NativeDescription;
				if (node.k !== "md" || typeof node.key !== "string" || !/^t\d+$/.test(node.key)) return child;
				if (node.p === null || typeof node.p !== "object" || Array.isArray(node.p)) return child;
				const sourceProps = node.p as { text?: unknown; marks?: unknown };
				if (typeof sourceProps.text !== "string") return child;
				if (sourceProps.marks !== undefined && !Array.isArray(sourceProps.marks)) return child;
				const cachedChild = nativeCache.get(child);
				if (cachedChild?.token === token) return cachedChild.out;
				const prose = registry.control.native(sourceProps.text);
				const props = { ...sourceProps, text: prose.text };
				if (sourceProps.marks !== undefined || prose.marks.length) {
					props.marks = [...(sourceProps.marks ?? []), ...prose.marks];
				}
				const out = { ...child, p: props };
				nativeCache.set(child, { token, out });
				return out;
			});
			const out = { ...source, c: children };
			nativeCache.set(source, { token, out });
			return out;
		};
	}
	const patchedSet = proto.setTextColorTransform;
	const patchedUpdate = proto.updateContent;
	const patchedDescribe = proto.describe;
	registry.restoreAssistant = () => {
		if (proto.setTextColorTransform === patchedSet) proto.setTextColorTransform = originalSet;
		if (proto.updateContent === patchedUpdate) proto.updateContent = originalUpdate;
		if (originalDescribe && proto.describe === patchedDescribe) proto.describe = originalDescribe;
	};
}

/**
 * Hook sparkles into omp's AssistantMessageComponent.
 *
 * That class is not part of the extension API, and importing its module by
 * path loads a second, unused copy when omp runs from its bundle. What
 * extensions do share with the host is `Container`, its base class, and the
 * component adds its first child in its constructor before any content
 * update. So `addChild` is watched until the first assistant component shows
 * up, its prototype is patched, and the watch is removed again.
 */
export function installSparkles(Container: ContainerClass, control: SparkleControl): SparkleInstallation {
	const containerProto = Container.prototype as ContainerClass["prototype"] & { [REGISTRY]?: Registry };
	const registry = (containerProto[REGISTRY] ??= {
		control,
		transform: (text: string) => control.transform(text),
		components: new Set(),
		seen: new WeakSet(),
	});
	registry.control = control;
	const refresh = () => {
		// A new identity also drops the host's stable-row and Markdown caches.
		registry.transform = (text) => registry.control.transform(text);
		for (const ref of registry.components) {
			const component = ref.deref();
			if (component) component.invalidate?.();
			else registry.components.delete(ref);
		}
	};
	if (!registry.assistant && !registry.restoreWatch) {
		const originalAdd = containerProto.addChild;
		const watch = function (this: object, child: unknown) {
			const assistant = findAssistantPrototype(this) ?? findAssistantPrototype(child);
			if (assistant) {
				registry.restoreWatch?.();
				registry.restoreWatch = undefined;
				registry.assistant = assistant;
				patchAssistant(assistant, registry);
			}
			return originalAdd.call(this, child);
		};
		registry.restoreWatch = () => {
			if (containerProto.addChild === watch) containerProto.addChild = originalAdd;
		};
		containerProto.addChild = watch;
	}
	refresh();
	return {
		isSupported: () => registry.assistant !== undefined,
		isNativeSupported: () => registry.nativeSupported === true,
		refresh,
		dispose: () => {
			registry.control = { isActive: () => false, transform: (text) => text, native: (text) => ({ text, marks: [] }) };
			refresh();
			registry.restoreWatch?.();
			registry.restoreAssistant?.();
			delete containerProto[REGISTRY];
		},
	};
}
