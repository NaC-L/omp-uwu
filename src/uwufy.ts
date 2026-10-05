/**
 * Deterministic, markdown-aware uwu rewriter for finalized assistant text.
 *
 * Only natural-language words are touched. Everything that has to stay exact is
 * left byte-for-byte alone: fenced/indented code, math blocks, inline code,
 * URLs and link targets, HTML tags, quoted spans, and any token that
 * looks like an identifier, path, number, flag, acronym, or warning word.
 *
 * Every "sometimes" decision is keyed on the word's position (paragraph,
 * sentence, word) rather than on its text, and no transform adds or removes a
 * word token. Rewriting already-rewritten text therefore makes the same
 * decisions and finds nothing left to do: `uwufy(uwufy(x)) === uwufy(x)`.
 * That matters because rewritten replies go back into the model's context, and
 * the model may start answering in uwu-speak on its own.
 */

export type UwuLevel = "min" | "low" | "mid" | "max";
export type UwuLocale = "auto" | "en" | "tr";

export interface UwuOptions {
	level?: UwuLevel;
	locale?: UwuLocale;
}

/** Emoticons the rewriter appends at sentence ends. */
export const EMOTICONS = [
	"uwu", "owo", ">w<", "^w^", ":3", "(◕ᴗ◕✿)",
	"(o^▽^o)", "(´｡• ω •｡`)", "٩(◕‿◕｡)۶", "o(≧▽≦)o", "(✧ω✧)",
	"(๑˃ᴗ˂)ﻭ", "(ᵔ◡ᵔ)", "ヽ(・∀・)ﾉ", "(´• ω •`)", "(｡•́︿•̀｡)",
	"(ノ_<。)", "(っ˘ω˘ς)", "(≧◡≦)", "٩(◕‿◕)۶", "(o˘◡˘o)",
	"(♡˙︶˙♡)", "ヽ(♡‿♡)ノ", "(´꒳`)♡", "(ﾉ´ з `)ノ", "ヾ(・ω・*)",
	"(⌒ω⌒)ﾉ", "(ᵔ⩊ᵔ)", "(=^･ω･^=)", "(ฅ^•ﻌ•^ฅ)", "(ᵕ—ᴗ—)",
	"(｡•̀ᴗ-)✧", "(づ｡◕‿‿◕｡)づ", "(っ´▽`)っ", "( ˶ˆᗜˆ˵ )", "(๑>◡<๑)",
	"✨", "💖", "🌸", "🎀",
] as const;

/** Tokens treated as emoticons: never counted as words, never rewritten. */
export const EMOTICON_TOKENS: ReadonlySet<string> = new Set<string>([
	...EMOTICONS,
	"UwU",
	"OwO",
	"^_^",
	"^^",
	":)",
	":D",
	"<3",
	"x3",
]);

const EMOTICON_PATTERN = [...EMOTICON_TOKENS]
	.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
const EMOTICON_AHEAD = new RegExp(String.raw`^\s+(?:${EMOTICON_PATTERN})(?=\s|$)`, "iu");

/** Words that carry meaning a reader must not miss. Kept exact. */
const KEEP_WORDS = new Set([
	"no",
	"not",
	"nor",
	"never",
	"none",
	"nothing",
	"nowhere",
	"neither",
	"cannot",
	"can't",
	"don't",
	"doesn't",
	"didn't",
	"won't",
	"wouldn't",
	"shouldn't",
	"mustn't",
	"isn't",
	"aren't",
	"wasn't",
	"weren't",
	"haven't",
	"hasn't",
	"hadn't",
	"couldn't",
	"warning",
	"caution",
	"danger",
	"dangerous",
	"careful",
	"irreversible",
	"destructive",
	"error",
	"errors",
	"fail",
	"fails",
	"failed",
	"failure",
]);

const TH_WORDS = new Set(["the", "this", "that", "these", "those", "them", "then", "there", "their", "they", "than"]);

// Mid retains the original probabilities; low also softens the r/l rewrite.
// Min never rewrites a word: it only appends uwu/owo/kaomoji/emoji at sentence ends.
const INTENSITY = {
	min: { rl: 0, th: 0, ny: 0, stutter: 0, emoticon: 0.4 },
	low: { rl: 0.4, th: 0.15, ny: 0.2, stutter: 0.04, emoticon: 0.1 },
	mid: { rl: 1, th: 0.35, ny: 0.5, stutter: 0.12, emoticon: 0.3 },
	max: { rl: 1, th: 0.75, ny: 0.85, stutter: 0.25, emoticon: 0.6 },
} as const satisfies Record<UwuLevel, { rl: number; th: number; ny: number; stutter: number; emoticon: number }>;

const TURKISH_KEEP_WORDS: Record<string, true> = { hayır: true, asla: true, hiç: true, hiçbir: true, sakın: true };
// Conservative lexical guards, not a morphological analyzer. Keep common
// case/possessive forms and conjugations (including negative deletion forms).
const TURKISH_CRITICAL = [
	/^değil[\p{L}\p{M}]*$/u,
	/^yok[\p{L}\p{M}]*$/u,
	/^(?:hata|uyarı)(?:lar|ler)?(?:[ıiuü]?m(?:[ıiuü]z)?|[ıiuü]?n(?:[ıiuü]z)?|s?[ıiuü])?(?:[ny]?[ıiuüae]|n?[dt][ae]n?|n?[ıiuü]n|y?l[ae]|s[ıiuü]z|l[ıiuü])?(?:ki)?(?:(?:[dt][ıiuü]|y[dt][ıiuü]|ym[ıiuü]ş|y[ıiuü]|s[ıiuü]n)[\p{L}\p{M}]*)?$/u,
	/^sil(?:e(?:r|ce[kğ]|lim|bil|me|mi)[\p{L}\p{M}]*|i(?:n|yor|ver|p)[\p{L}\p{M}]*|(?:me|mi|di|se|sin)[\p{L}\p{M}]*)?$/u,
];

/** Markdown syntax surfaces whose literal backticks cannot open code spans. */
const MARKDOWN_OPAQUE_INLINE = new RegExp([
	String.raw`\]\([^)\s]*(?:\s+"[^"]*")?\)`,
	String.raw`<\/?[A-Za-z][^>\n]*>`,
	String.raw`\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*`,
].join("|"), "giu");

const PROTECTED_NONCODE_INLINE = new RegExp(
	[
		MARKDOWN_OPAQUE_INLINE.source,
		String.raw`"[^"\n]*"`, // "quoted text"
		String.raw`“[^”\n]*”`, // “quoted text”
		// Word boundaries distinguish quote delimiters from we're / they're.
		String.raw`(?<![\p{L}\p{M}\p{N}_])'(?:[^'\n]|'(?=[\p{L}\p{M}\p{N}_]))*'(?![\p{L}\p{M}\p{N}_])`,
		String.raw`(?<![\p{L}\p{M}\p{N}_])‘(?:[^’\n]|’(?=[\p{L}\p{M}\p{N}_]))*’(?![\p{L}\p{M}\p{N}_])`,
		// Multi-token kaomoji must not change the word-position seed on re-runs.
		String.raw`(?<!\S)(?:${EMOTICON_PATTERN})(?!\S)`,
	].join("|"),
	"giu",
);

/** Only the first alternative captures: \1 is the opening backtick run. */
const PROTECTED_INLINE = new RegExp(
	["(`+)[\\s\\S]*?\\1(?!`)", "`.*$", PROTECTED_NONCODE_INLINE.source].join("|"),
	"giu",
);

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const MATH_FENCE = /^\s*\$\$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HTML_LINE = /^\s*<[A-Za-z/!]/;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:\s/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const TABLE_ROW = /^\s*\|/;

const TOKEN_PARTS = /^([(\[{"'“‘*_~]*)(.*?)([)\]}"'”’*_~.,;:!?…]*)$/su;
const WORD = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u;
const SENTENCE_END = /[.!?…]/;
const STUTTERED = /^(\p{L})-\1/iu;

type LineKind = "code" | "blank" | "prose";

interface ProseLine {
	index: number;
	/** Headings and tables get word rewrites but no stutters or emoticons. */
	decorate: boolean;
}

/** Rewrite markdown prose. Defaults to the original mid intensity and auto locale. */
export function uwufy(text: string, options: UwuOptions = {}): string {
	return rewriteText(text, options, true);
}

/**
 * Rewrite a render-time prose run without adding stutters or emoticons.
 * Min is decoration-only: it appends faces instead of rewriting words.
 * Quoted spans, identifiers and markdown protected surfaces still stay exact.
 * Positions reset per supplied run; changing renderer fragment boundaries can
 * change probabilistic choices. This is a lexical rewriter, not a translator.
 * Only balanced quotes contained in one supplied line/run are guarded; callers
 * must not split quoted or technical spans across independently rewritten runs.
 */
export function uwufyProse(text: string, options: UwuOptions = {}): string {
	return rewriteText(text, options, options.level === "min");
}

type MarkdownContainer = { kind: "quote" } | { kind: "list"; indent: number };
type SourceRange = { start: number; end: number };

/** Consume existing containers for detection only; source bytes are never rebuilt. */
function consumeMarkdownContainers(line: string, containers: readonly MarkdownContainer[]): { offset: number; count: number; column: number } {
	let offset = 0;
	let count = 0;
	let column = 0;
	for (const container of containers) {
		if (container.kind === "quote") {
			const quote = /^ {0,3}>[ \t]?/.exec(line.slice(offset));
			if (!quote) break;
			offset += quote[0].length;
			for (const char of quote[0]) column += char === "\t" ? 4 - column % 4 : 1;
		} else {
			let width = 0;
			let end = offset;
			while (end < line.length && width < container.indent) {
				if (line[end] === " ") width++;
				else if (line[end] === "\t") width += 4 - (column + width) % 4;
				else break;
				end++;
			}
			if (width !== container.indent) break;
			offset = end;
			column += width;
		}
		count++;
	}
	return { offset, count, column };
}

/**
 * Native full-Markdown display: preserve source ranges for container fences,
 * indented code and multi-line backtick spans before applying the prose helper.
 * Unclosed fences/spans protect their remaining input while streaming.
 * ANSI prose runs and finalized rewrite keep their existing semantics.
 */
export function uwufyMarkdownProse(text: string, options: UwuOptions = {}): string {
	const ranges: SourceRange[] = [];
	let containers: MarkdownContainer[] = [];
	let fence: { char: string; length: number; containers: MarkdownContainer[] } | undefined;
	let previousCodeOrBlank = true;
	let lineStart = 0;
	while (lineStart < text.length) {
		const newline = text.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? text.length : newline + 1;
		const line = text.slice(lineStart, newline === -1 ? text.length : newline).replace(/\r$/, "");
		if (fence) {
			const prefix = consumeMarkdownContainers(line, fence.containers);
			if (prefix.count === fence.containers.length || line.trim() === "" && fence.containers.slice(prefix.count).every((container) => container.kind === "list")) {
				ranges.push({ start: lineStart, end: lineEnd });
				const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.slice(prefix.offset));
				if (fence.char === "$" ? MATH_FENCE.test(line.slice(prefix.offset)) : close?.[1]?.[0] === fence.char && close[1].length >= fence.length) fence = undefined;
				previousCodeOrBlank = true;
				lineStart = lineEnd;
				continue;
			}
			// A quote/list container ended: its unclosed fence cannot consume a sibling.
			fence = undefined;
		}
		const previousContainers = containers;
		const inherited = consumeMarkdownContainers(line, containers);
		containers = containers.slice(0, inherited.count);
		let offset = inherited.offset;
		let column = inherited.column;
		let newList = false;
		while (offset < line.length) {
			const remainder = line.slice(offset);
			const quote = /^ {0,3}>[ \t]?/.exec(remainder);
			if (quote) {
				containers.push({ kind: "quote" });
				offset += quote[0].length;
				for (const char of quote[0]) column += char === "\t" ? 4 - column % 4 : 1;
				continue;
			}
			const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(remainder);
			if (!list) break;
			// CommonMark uses one padding space when the marker is followed by >4.
			const gap = list[1]!;
			const markerWidth = list[0].length - gap.length;
			let gapColumn = column + markerWidth;
			for (const char of gap) gapColumn += char === "\t" ? 4 - gapColumn % 4 : 1;
			const padding = gapColumn - column - markerWidth;
			const consumed = markerWidth + (padding > 4 ? 1 : gap.length);
			containers.push({ kind: "list", indent: markerWidth + (padding > 4 ? 1 : padding || 1) });
			for (let index = 0; index < consumed; index++) column += remainder[index] === "\t" ? 4 - column % 4 : 1;
			offset += consumed;
			newList = true;
		}
		const content = line.slice(offset);
		const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
		if (open?.[1] && (open[1][0] !== "`" || !open[2]!.includes("`"))) {
			fence = { char: open[1][0]!, length: open[1].length, containers: [...containers] };
			ranges.push({ start: lineStart, end: lineEnd });
			previousCodeOrBlank = true;
		} else if (MATH_FENCE.test(content)) {
			if (!/^\s*\$\$.*\$\$\s*$/.test(content) || content.trim() === "$$") {
				fence = { char: "$", length: 2, containers: [...containers] };
			}
			ranges.push({ start: lineStart, end: lineEnd });
			previousCodeOrBlank = true;
		} else if (/^(?: {4}|\t)/.test(content) && (previousCodeOrBlank || newList)) {
			ranges.push({ start: lineStart, end: lineEnd });
			previousCodeOrBlank = true;
		} else {
			previousCodeOrBlank = content.trim() === "";
			// Blank list lines need no indentation, but do not close the list.
			if (content.trim() === "" && containers.length === inherited.count && previousContainers.slice(inherited.count).every((container) => container.kind === "list")) {
				containers = previousContainers;
			}
		}
		lineStart = lineEnd;
	}
	// Merge adjacent protected block lines before scanning their prose gaps.
	ranges.sort((a, b) => a.start - b.start);
	const blocks: SourceRange[] = [];
	for (const range of ranges) {
		const previous = blocks.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else blocks.push({ ...range });
	}
	ranges.length = 0;
	for (const block of blocks) ranges.push(block);
	const opaque = [...text.matchAll(MARKDOWN_OPAQUE_INLINE)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
	let opaqueIndex = 0;
	// Maximal backtick runs close only at an exactly matching run length.
	const backticks = /`+/g;
	let gapStart = 0;
	for (let index = 0; index <= blocks.length; index++) {
		const gapEnd = blocks[index]?.start ?? text.length;
		let opening: { start: number; length: number } | undefined;
		backticks.lastIndex = gapStart;
		for (let match = backticks.exec(text); match && match.index < gapEnd; match = backticks.exec(text)) {
			if (opening) {
				if (match[0].length === opening.length) {
					ranges.push({ start: opening.start, end: match.index + match[0].length });
					opening = undefined;
				}
			} else {
				while (opaqueIndex < opaque.length && opaque[opaqueIndex]!.end <= match.index) opaqueIndex++;
				if (opaque[opaqueIndex] && opaque[opaqueIndex]!.start <= match.index) continue;
				let slashes = 0;
				for (let before = match.index - 1; before >= gapStart && text[before] === "\\"; before--) slashes++;
				if (slashes % 2 === 0) opening = { start: match.index, length: match[0].length };
			}
		}
		if (opening) ranges.push({ start: opening.start, end: gapEnd });
		gapStart = blocks[index]?.end ?? text.length;
	}
	ranges.sort((a, b) => a.start - b.start);
	return rewriteText(text, options, options.level === "min", ranges);
}

function rewriteText(text: string, options: UwuOptions, decorate: boolean, protectedRanges?: readonly SourceRange[]): string {
	const resolved: Required<UwuOptions> = { level: options.level ?? "mid", locale: options.locale ?? "auto" };
	const lines = text.split("\n");
	let sourceOffset = 0;
	let rangeIndex = 0;
	const protectedLines = protectedRanges?.length ? lines.map((line) => {
		const end = sourceOffset + line.length;
		while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex]!.end <= sourceOffset) rangeIndex++;
		let spans: SourceRange[] | undefined;
		for (let index = rangeIndex; index < protectedRanges.length && protectedRanges[index]!.start < end; index++) {
			const range = protectedRanges[index]!;
			(spans ??= []).push({ start: Math.max(0, range.start - sourceOffset), end: Math.min(line.length, range.end - sourceOffset) });
		}
		sourceOffset = end + 1;
		return spans;
	}) : undefined;
	const kinds: LineKind[] = protectedRanges
		? lines.map((line, index) => {
			if (!line.trim()) return "blank";
			return HTML_LINE.test(line) || LINK_DEFINITION.test(line) || protectedLines?.[index]?.some((span) => span.start === 0 && span.end === line.length) ? "code" : "prose";
		})
		: classifyLines(lines);

	const paragraphs: ProseLine[][] = [];
	let current: ProseLine[] | undefined;
	for (const [index, line] of lines.entries()) {
		if (kinds[index] !== "prose") {
			current = undefined;
			continue;
		}
		const heading = HEADING.test(line);
		// Headings, list items and table rows each start their own paragraph.
		if (!current || heading || LIST_ITEM.test(line) || TABLE_ROW.test(line)) {
			current = [];
			paragraphs.push(current);
		}
		current.push({ index, decorate: decorate && !heading && !TABLE_ROW.test(line) });
		if (heading) current = undefined;
	}

	const out = [...lines];
	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		// Count once, then rewrite: the word count seeds this paragraph's decisions,
		// which keeps them varied between paragraphs yet stable across re-runs.
		const wordCount = walkParagraph(lines, paragraph, () => undefined, undefined, protectedLines);
		const seed = `${paragraphIndex}|${wordCount}`;
		walkParagraph(lines, paragraph, (event) => rewriteToken(event, seed, resolved), out, protectedLines);
	}
	return out.join("\n");
}

function classifyLines(lines: string[]): LineKind[] {
	const kinds: LineKind[] = [];
	let fence: { char: string; length: number } | undefined;
	let math = false;
	let previous: LineKind = "blank";
	for (const line of lines) {
		let kind: LineKind;
		if (fence) {
			const close = FENCE_CLOSE.exec(line);
			if (close?.[1] && close[1][0] === fence.char && close[1].length >= fence.length) fence = undefined;
			kind = "code";
		} else if (math) {
			if (MATH_FENCE.test(line)) math = false;
			kind = "code";
		} else if (FENCE_OPEN.test(line)) {
			const open = FENCE_OPEN.exec(line)?.[1] ?? "```";
			fence = { char: open[0] ?? "`", length: open.length };
			kind = "code";
		} else if (MATH_FENCE.test(line)) {
			// A one-line `$$ x $$` block opens and closes on the same line.
			math = !/^\s*\$\$.*\$\$\s*$/.test(line) || line.trim() === "$$";
			kind = "code";
		} else if (line.trim() === "") {
			kind = "blank";
		} else if (
			(INDENTED_CODE.test(line) && !LIST_ITEM.test(line) && previous !== "prose") ||
			HTML_LINE.test(line) ||
			LINK_DEFINITION.test(line)
		) {
			kind = "code";
		} else {
			kind = "prose";
		}
		kinds.push(kind);
		previous = kind;
	}
	return kinds;
}

interface TokenEvent {
	token: string;
	/** Text after the token on its full line, including protected emoticons. */
	rest: string;
	/** Whether the segment ends the line (nothing protected follows it). */
	lineEnd: boolean;
	decorate: boolean;
	sentence: number;
	wordInSentence: number;
	word: number;
}

/**
 * Walk the word tokens of one paragraph. When `out` is given, each prose
 * segment is rebuilt from the callback's replacements. Returns the word count.
 */
function walkParagraph(
	lines: string[],
	paragraph: ProseLine[],
	visit: (event: TokenEvent) => string | undefined,
	out?: string[],
	protectedLines?: readonly (readonly SourceRange[] | undefined)[],
): number {
	let sentence = 0;
	let wordInSentence = 0;
	let word = 0;
	for (const { index, decorate } of paragraph) {
		const line = lines[index] ?? "";
		let rebuilt = "";
		let cursor = 0;
		const segments: Array<{ prose: boolean; text: string; start: number }> = [];
		const protectedSpans = protectedLines?.[index];
		const matches = protectedSpans?.length
			? [
				...[...line.matchAll(PROTECTED_INLINE)].filter((match) => !protectedSpans.some((span) => match.index >= span.start && match.index < span.end)),
				...protectedSpans.map((span) => ({ 0: line.slice(span.start, span.end), index: span.start })),
			].sort((a, b) => a.index - b.index)
			: line.matchAll(PROTECTED_INLINE);
		for (const match of matches) {
			const start = match.index ?? 0;
			const end = start + match[0].length;
			if (end <= cursor) continue;
			if (start > cursor) segments.push({ prose: true, text: line.slice(cursor, start), start: cursor });
			segments.push({ prose: false, text: line.slice(Math.max(cursor, start), end), start: Math.max(cursor, start) });
			cursor = end;
		}
		if (cursor < line.length) segments.push({ prose: true, text: line.slice(cursor), start: cursor });

		for (const [segmentIndex, segment] of segments.entries()) {
			if (!segment.prose) {
				rebuilt += segment.text;
				continue;
			}
			const lineEnd = segmentIndex === segments.length - 1;
			rebuilt += segment.text.replace(/\S+/g, (token, offset: number) => {
				if (EMOTICON_TOKENS.has(token)) return token;
				const [, , core = "", trail = ""] = TOKEN_PARTS.exec(token) ?? [];
				const isWord = WORD.test(core);
				let replacement: string | undefined;
				if (isWord) {
					replacement = visit({
						token,
						rest: line.slice(segment.start + offset + token.length),
						lineEnd,
						decorate,
						sentence,
						wordInSentence,
						word,
					});
					word++;
					wordInSentence++;
				}
				if ((isWord || core === "") && SENTENCE_END.test(trail)) {
					sentence++;
					wordInSentence = 0;
				}
				return replacement ?? token;
			});
		}
		if (out) out[index] = rebuilt;
	}
	return word;
}

function rewriteToken(event: TokenEvent, seed: string, options: Required<UwuOptions>): string {
	const intensity = INTENSITY[options.level];
	const [, lead = "", core = "", trail = ""] = TOKEN_PARTS.exec(event.token) ?? [];
	const key = `${seed}|${event.sentence}|${event.word}`;
	let result = event.token;

	if (options.level !== "min" && !isKeptWord(core, options.locale)) {
		let word = core;
		if (TH_WORDS.has(word.toLowerCase()) && roll(`${key}|th`) < intensity.th) {
			word = (word[0] === "T" ? "D" : "d") + word.slice(2);
		}
		if (roll(`${key}|rl`) < intensity.rl) word = word.replace(/[rl]/g, "w").replace(/[RL]/g, "W");
		if (roll(`${key}|ny`) < intensity.ny) word = word.replace(/([nN])(?=[aeo])/g, "$1y");
		if (
			event.decorate &&
			event.wordInSentence === 0 &&
			word.length >= 3 &&
			!STUTTERED.test(word) &&
			roll(`${key}|stutter`) < intensity.stutter
		) {
			word = `${word[0]}-${word}`;
		}
		// Never turn a word into something that reads as an emoticon (e.g. "ulu").
		if (!EMOTICON_TOKENS.has(word)) result = lead + word + trail;
	}

	if (
		event.decorate &&
		SENTENCE_END.test(trail) &&
		(/^\s/.test(event.rest) || (event.rest === "" && event.lineEnd)) &&
		!EMOTICON_AHEAD.test(event.rest) &&
		roll(`${seed}|${event.sentence}|emoticon`) < intensity.emoticon
	) {
		result += ` ${EMOTICONS[Math.floor(roll(`${seed}|${event.sentence}|pick`) * EMOTICONS.length)]}`;
	}
	return result;
}

/** Acronyms, camelCase names, flags and meaning-critical words stay exact. */
function isKeptWord(core: string, locale: UwuLocale): boolean {
	if (KEEP_WORDS.has(core.toLowerCase().replaceAll("’", "'"))) return true;
	if (locale !== "en") {
		const turkish = core.normalize("NFC").toLocaleLowerCase("tr");
		if (Object.hasOwn(TURKISH_KEEP_WORDS, turkish) || TURKISH_CRITICAL.some((pattern) => pattern.test(turkish))) return true;
	}
	if (core.endsWith("-") || core.includes("--")) return true;
	if (/\p{Ll}\p{Lu}/u.test(core)) return true; // camelCase, GitHub, iOS
	const letters = core.replace(/[^\p{L}]/gu, "");
	return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** FNV-1a hash of `key`, scaled to [0, 1). */
function roll(key: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 2 ** 32;
}
