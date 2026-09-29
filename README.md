# omp-uwu

**Your coding agent, but it says "hewwo" (◕ᴗ◕✿)**

Long sessions with an agent can get a little grey: diffs, stack traces, test output, repeat. omp-uwu is an [omp](https://github.com/can1357/oh-my-pi) extension that makes the agent write its chat replies in playful uwu-speak, while everything that has to be exact stays exact.

<p align="center">
  <img src="https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/demo.gif" alt="omp streaming an uwu-speak answer about an off-by-one loop, with the corrected code block unchanged" width="784">
</p>

The prose is uwufied, but the inline code, numbers and the fixed loop stay exactly as they should be.

## Quick start

```sh
omp plugin install omp-uwu
```

Restart omp. Defaults are **on**, **rewrite**, **mid**, **auto**, with colors **off** (unless saved preferences say otherwise).

- `/uwu` toggles it
- `/uwu on` / `/uwu off` sets it explicitly
- `/uwu rewrite` uses omp's finalized-message rewrite hook when available
- `/uwu prompt` asks the model to write in uwu style while it streams
- `/uwu display` explicitly opts into **experimental, ANSI-TUI-only** display styling; never changes history or adds a prompt
- `/uwu level low` / `/uwu level mid` / `/uwu level max` selects light, standard or stronger intensity
- `/uwu locale auto` / `/uwu locale en` / `/uwu locale tr` selects critical-word protection and prompt language guidance
- `/uwu status` reports settings and observed capabilities (unknown/pending is not a support guarantee)
- `/uwu preview <text>` shows a deterministic sample with its original case, without changing any settings—even if uwu is off
- `/uwu colors on` / `/uwu colors off` enables or disables the optional kawaii palette (off by default; preference persists)

The palette colors chat markdown and the user-message bubble without putting ANSI codes into message text/history. It is applied as an in-memory TUI theme; components sharing those colors can change too. The host's in-memory theme setter pauses automatic theme detection until omp restarts. The TUI also shows a theme-accent `(◕ᴗ◕✿) uwu` status badge; other clients/plain output are not colorized.

With colors on, the ANSI TUI also paints **sparkles** in the agent's chat prose: `uwu`/`owo` get a per-letter pastel rainbow, and kaomoji (listed or not, e.g. `(◕ᴗ◕✿)`, `(ﾉ◕ヮ◕)ﾉ`) and glyphs like `♡ ☆ ✧ ✿` get a pastel tint. This happens at render time through omp's per-message text color transform, so inline code, code blocks, link targets and stored message text stay untouched. Display styling works independently of colors; when both are on, prose is transformed first, then painted. A host-owned transform (such as live-voice transcript coloring) wins over both. omp's `AssistantMessageComponent` is not public extension API, so the plugin discovers it through the shared `Container` base class. If discovery is unavailable, display/sparkles do nothing; the palette can still apply. There is **no silent prompt fallback for display**.

## What gets uwufied, and what doesn't

| uwufied | kept byte-for-byte |
|---|---|
| Natural-language chat replies to you | Code blocks and inline code |
| | Shell commands, file paths, URLs |
| | Identifiers, config keys, quoted error messages |
| | Tool-call arguments and file contents the agent writes or edits |
| | Commit messages and prompts sent to subagents |

Style rules include `r`/`l` → `w`, occasional `th` → `d`, `na/ne/no` → `nya/nye/nyo`, occasional stutter, a broad rotating selection of kaomoji, and the odd cute emoji (`✨ 💖 🌸 🎀`). The kaomoji selection includes examples from [kaomoji.you](https://kaomoji.you/), such as `٩(◕‿◕｡)۶`, `(ฅ^•ﻌ•^ฅ)`, and `(づ｡◕‿‿◕｡)づ`. Meaning, numbers and warnings must stay readable.

Intensity and locale apply to rewrite, prompt and display. `mid` keeps the original rewrite strength; `low` changes fewer words and adds fewer decorations; `max` is stronger. `auto` protects English **and** Turkish critical words, not automatic language detection. `tr` also protects Turkish forms while retaining English protection; `en` uses English protection. These settings never translate text. Negations/warnings and common Turkish inflections are protected conservatively, not by a complete linguistic parser.

Here's the same prompt and model, with the mode off and on:

![Two real omp replies side by side: plain English on the left, uwu-speak on the right, with an identical code block in both](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/before-after.png)

These are real, unedited replies from `anthropic/claude-opus-5-5`, rendered as images. Both code blocks are identical byte for byte. The transcripts are in [`demo/`](demo).

### kawaii/uwu-bench

On kawaii/uwu-bench, Opus 5.5 scores 0.1% on its own and 98.5% with omp-uwu enabled:

![kawaii/uwu-bench: Opus 5.5 scores 0.1%, Opus 5.5 with omp-uwu scores 98.5%](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/uwu-bench.png)

Only the two scores come from the benchmark run. The other numbers on the chart are computed from them, and the terminal and config panels are decoration.

## How it works

In the default **rewrite** style, the first turn uses prompt styling until the host demonstrates support for the awaited `assistant_message` hook; after that, finalized assistant text is deterministically uwufied before it is added to history and context. This first-turn check supports both older and newer omp builds. Only existing text blocks change; code/tool blocks and metadata stay untouched. Rewrites preserve fenced/inline code, URLs, paths, numbers, quoted spans, identifiers and safety-critical words. Subagent prompts, messages and tool-call arguments are never styled.

The hook runs after streaming has finished. The TUI refreshes the current assistant message at completion, but clients that render only streamed chunks may continue showing the original text. If the hook is unavailable (including omp `18.4.3`), prompt style remains enabled as the compatibility fallback. `/uwu prompt` selects live prompt styling directly.

- **Deterministic rewrite.** No style instruction/token overhead once the hook is detected.
- **Prompt style.** Model-dependent, with live uwu output while streaming.
- **Experimental display.** Explicit opt-in, ANSI TUI only: `uwufyProse` transforms individual Markdown prose runs before width/wrapping, without rewriting stored content or injecting instructions. No appended emoticons or stutters. Display/level/locale/on/off changes invalidate existing discovered assistant components even with colors off.
- **Persistent settings.** Enabled state, colors, style, level and locale are saved in `~/.omp/agent/omp-uwu.json`. Older enabled/colors-only files load with rewrite/mid/auto defaults; invalid individual values keep their defaults.

Display is deliberately **fragment-based**: inline formatting, links, newlines and streaming edits can split runs and reset deterministic word positions, so effects may differ from a whole-message rewrite or preview. Identifiers, numbers and complete quoted spans within a run stay protected; a quote split across Markdown runs cannot be protected as a whole. Host paths that bypass its prose transform (including blockquotes, some table/heading/math rendering) may remain unchanged or differ from normal paragraphs. This is not a universal Markdown rewriting layer. Prompt-mode preview is only a deterministic approximation, not a prediction of model output.

Capability fallback is explicit: `/uwu status` distinguishes a missing `Container`, pending assistant discovery and an observed ANSI hook; rewrite support is reported as unknown/detected/not observed. Discovery alone does not prove every render path works. Native/client rendering is **unsupported**: the installed omp `18.4.4` native description sends raw Markdown rather than using the ANSI text transform. RPC/print/export output and history stay original in display mode. Use `/uwu rewrite` or `/uwu prompt` explicitly if you want another style; display never switches to them automatically.

## Install options

```sh
omp plugin install omp-uwu          # from npm (recommended)
omp plugin install omp-uwu@0.5.0    # pin a version
omp plugin uninstall omp-uwu        # remove
```

If you copied a loose `uwu.ts` into `~/.omp/agent/extensions/` earlier, delete it after installing the plugin. Otherwise `/uwu` is registered twice.

## Development

```sh
bun install
bun run check          # tsc against the omp package types
bun test
omp plugin link .      # use this checkout instead of the installed copy
omp -e ./src/index.ts  # or load it for a single run
```

The full-module integration tests exercise real omp Markdown/Assistant components, narrow wrapping, inline/fenced code preservation, unchanged raw messages, cache invalidation without colors, and host-transform precedence. They restore patched prototypes after each case. An additional installed-host test automatically uses `~/.bun/install/global/node_modules/@oh-my-pi/pi-tui` if present; set `OMP_UWU_HOST_TUI` to a different pi-tui package directory to test another installation (otherwise that case is skipped).

For an interactive smoke check, start `omp -e ./src/index.ts` in an isolated test agent directory, run `/uwu colors off`, `/uwu display`, then `/uwu status`. Ask for ordinary prose plus inline/fenced code and narrow the terminal; prose should be styled and rewrapped while code stays exact. Change `/uwu level low` to `max`, switch locales and `/uwu off` without enabling colors: existing assistant paragraphs should refresh. Reopen the saved transcript/export to confirm raw text is unchanged, and verify the next model prompt has no uwu instruction. On a native client, expect unchanged prose, not fallback prompt styling.

### Re-recording the demo

The GIF and the side-by-side image are rendered from real transcripts in `demo/`. `record.sh` captures one reply with the extension loaded and one without it. It runs in a throwaway agent dir, so your personal rules and extensions don't affect the replies. `render.py` then draws both images:

```sh
mkdir -p /tmp/omp-demo && cp ~/.omp/agent/agent.db* /tmp/omp-demo/
demo/record.sh
uv run --with pillow python demo/render.py
```

Model output varies between runs, so re-run `record.sh` until you get a reply that reads well.

The uwu-bench chart is drawn from [`demo/uwu-bench.html`](demo/uwu-bench.html). Edit the HTML, then take a 1536×960 screenshot with headless Chrome:

```sh
chrome --headless=new --hide-scrollbars --window-size=1536,960 --screenshot="$PWD/demo/uwu-bench.png" "file://$PWD/demo/uwu-bench.html"
```

### Releasing

CI (`.github/workflows/ci.yml`) runs `check` and the tests on pushes to `main` and on pull requests. Pushing a `v*` tag runs them again, checks that the tag matches `version` in `package.json`, and publishes to npm with provenance (`.github/workflows/publish.yml`).

```sh
# bump "version" in package.json, commit, then:
git tag v0.5.0
git push origin main v0.5.0
```

The workflow uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/), so the repository has no npm token. npm only allows trusted publishing on a package that already exists, so the first version is published by hand with `npm publish --access public`. After that, go to the package's Settings → Trusted publishing on npmjs.com and add GitHub Actions with user `NaC-L`, repository `omp-uwu`, and workflow `publish.yml`.

## License

MIT
