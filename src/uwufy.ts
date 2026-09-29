/**
 * Deterministic, markdown-aware uwu rewriter for finalized assistant text.
 *
 * Only natural-language words are touched. Everything that has to stay exact is
 * left byte-for-byte alone: fenced/indented code, math blocks, inline code,
 * URLs and link targets, HTML tags, double-quoted spans, and any token that
 * looks like an identifier, path, number, flag, acronym, or warning word.
 *
 * Every "sometimes" decision is keyed on the word's position (paragraph,
 * sentence, word) rather than on its text, and no transform adds or removes a
 * word token. Rewriting already-rewritten text therefore makes the same
 * decisions and finds nothing left to do: `uwufy(uwufy(x)) === uwufy(x)`.
 * That matters because rewritten replies go back into the model's context, and
 * the model may start answering in uwu-speak on its own.
 */

/** Emoticons the rewriter appends at sentence ends. */
export const EMOTICONS = [
	"uwu", "owo", ">w<", "^w^", ":3", "(◕ᴗ◕✿)",
	"(o^▽^o)", "(´｡• ω •｡`)", "٩(◕‿◕｡)۶", "o(≧▽≦)o", "(✧ω✧)",
	"(๑˃ᴗ˂)ﻭ", "(ᵔ◡ᵔ)", "ヽ(・∀・)ﾉ", "(´• ω •`)", "(｡•́︿•̀｡)",
	"(ノ_<。)", "(っ˘ω˘ς)", "(≧◡≦)", "٩(◕‿◕)۶", "(o˘◡˘o)",
	"(♡˙︶˙♡)", "ヽ(♡‿♡)ノ", "(´꒳`)♡", "(ﾉ´ з `)ノ", "ヾ(・ω・*)",
	"(⌒ω⌒)ﾉ", "(ᵔ⩊ᵔ)", "(=^･ω･^=)", "(ฅ^•ﻌ•^ฅ)", "(ᵕ—ᴗ—)",
	"(｡•̀ᴗ-)✧", "(づ｡◕‿‿◕｡)づ", "(っ´▽`)っ", "( ˶ˆᗜˆ˵ )", "(๑>◡<๑)",
] as const;

/** Tokens treated as emoticons: never counted as words, never rewritten. */
const EMOTICON_TOKENS = new Set<string>([
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

// Probabilities for the "sometimes" transforms.
const P_TH = 0.35;
const P_NY = 0.5;
const P_STUTTER = 0.12;
const P_EMOTICON = 0.3;

/**
 * Inline spans that are never rewritten. Only the first alternative captures,
 * so `\1` is the opening backtick run of a code span.
 */
const PROTECTED_INLINE = new RegExp(
	[
		String.raw`(\`+)[\s\S]*?\1(?!\`)`, // code span
		String.raw`\`.*$`, // unmatched backtick: keep the rest of the line
		String.raw`\]\([^)\s]*(?:\s+"[^"]*")?\)`, // markdown link target
		String.raw`<\/?[A-Za-z][^>\n]*>`, // HTML tag or autolink
		String.raw`\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*`, // bare URL
		String.raw`"[^"\n]*"`, // "quoted text"
		String.raw`“[^”\n]*”`, // “quoted text”
	].join("|"),
	"gi",
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

/** Rewrite the prose of a markdown string in uwu-speak. */
export function uwufy(text: string): string {
	const lines = text.split("\n");
	const kinds = classifyLines(lines);

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
		current.push({ index, decorate: !heading && !TABLE_ROW.test(line) });
		if (heading) current = undefined;
	}

	const out = [...lines];
	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		// Count once, then rewrite: the word count seeds this paragraph's decisions,
		// which keeps them varied between paragraphs yet stable across re-runs.
		const wordCount = walkParagraph(lines, paragraph, () => undefined);
		const seed = `${paragraphIndex}|${wordCount}`;
		walkParagraph(lines, paragraph, (event) => rewriteToken(event, seed), out);
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
	/** Text after the token within its prose segment, for emoticon lookahead. */
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
): number {
	let sentence = 0;
	let wordInSentence = 0;
	let word = 0;
	for (const { index, decorate } of paragraph) {
		const line = lines[index] ?? "";
		let rebuilt = "";
		let cursor = 0;
		const segments: Array<{ prose: boolean; text: string }> = [];
		for (const match of line.matchAll(PROTECTED_INLINE)) {
			const start = match.index ?? 0;
			if (start > cursor) segments.push({ prose: true, text: line.slice(cursor, start) });
			segments.push({ prose: false, text: match[0] });
			cursor = start + match[0].length;
		}
		if (cursor < line.length) segments.push({ prose: true, text: line.slice(cursor) });

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
						rest: segment.text.slice(offset + token.length),
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

function rewriteToken(event: TokenEvent, seed: string): string {
	const [, lead = "", core = "", trail = ""] = TOKEN_PARTS.exec(event.token) ?? [];
	const key = `${seed}|${event.sentence}|${event.word}`;
	let result = event.token;

	if (!isKeptWord(core)) {
		let word = core;
		if (TH_WORDS.has(word.toLowerCase()) && roll(`${key}|th`) < P_TH) {
			word = (word[0] === "T" ? "D" : "d") + word.slice(2);
		}
		word = word.replace(/[rl]/g, "w").replace(/[RL]/g, "W");
		if (roll(`${key}|ny`) < P_NY) word = word.replace(/([nN])(?=[aeo])/g, "$1y");
		if (
			event.decorate &&
			event.wordInSentence === 0 &&
			word.length >= 3 &&
			!STUTTERED.test(word) &&
			roll(`${key}|stutter`) < P_STUTTER
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
		!EMOTICON_TOKENS.has(/^\s+(\S+)/.exec(event.rest)?.[1] ?? "") &&
		roll(`${seed}|${event.sentence}|emoticon`) < P_EMOTICON
	) {
		result += ` ${EMOTICONS[Math.floor(roll(`${seed}|${event.sentence}|pick`) * EMOTICONS.length)]}`;
	}
	return result;
}

/** Acronyms, camelCase names, flags and meaning-critical words stay exact. */
function isKeptWord(core: string): boolean {
	if (KEEP_WORDS.has(core.toLowerCase().replaceAll("’", "'"))) return true;
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
