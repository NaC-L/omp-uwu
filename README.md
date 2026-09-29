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

Restart omp. uwu starts **on**, in **rewrite** style, at **mid** intensity with **auto** locale and colors **off**. Settings persist in `~/.omp/agent/omp-uwu.json`.

The easiest way to change them is `/uwu status`, an interactive dashboard (see below). Every setting also has a command:

| Command | What it does |
|---|---|
| `/uwu` | Toggle uwu on/off |
| `/uwu on` · `/uwu off` | Turn it on or off explicitly |
| `/uwu rewrite` | Rewrite finished replies deterministically (default) |
| `/uwu prompt` | Ask the model to write in uwu while it streams |
| `/uwu display` | **Experimental:** style prose only on screen, in the ANSI TUI |
| `/uwu level low\|mid\|max` | Light, standard or strong intensity |
| `/uwu locale auto\|en\|tr` | Which critical words to protect (never translates) |
| `/uwu colors [on\|off]` | Kawaii palette and sparkles (toggles without an argument) |
| `/uwu preview <text>` | Show a sample with the current settings, without changing anything |
| `/uwu status` | Open the dashboard (plain one-line summary outside the TUI) |

Selecting a style also turns uwu on. In prompt style, `/uwu preview` is a deterministic approximation, not a prediction of what the model will write.

### The `/uwu status` dashboard

- **Controls** tab: switches, style/level/locale chips, an intensity meter and a live sample.
- **Compatibility** tab: what omp has actually shown it supports in this session (rewrite hook, display hook, fallbacks). It reports observations, not guarantees.
- ↑/↓ moves focus, ←/→ or Enter/Space changes a value, Tab switches tabs.
- **Enter on Save** applies the draft. **Esc** discards it. Moving around never saves anything.

### Colors and sparkles

`/uwu colors on` applies a pastel palette to chat markdown and the user-message bubble, and adds a `(◕ᴗ◕✿) uwu` status badge. In the chat prose, `uwu`/`owo` get a per-letter rainbow, and kaomoji like `(◕ᴗ◕✿)` or `(ﾉ◕ヮ◕)ﾉ` and glyphs like `♡ ☆ ✧ ✿` get a pastel tint.

All of this happens at render time, in the ANSI TUI only:

- No ANSI codes go into message text or history. Code, code blocks and link targets are never painted.
- The palette is an in-memory TUI theme, so other components that share those colors can change too. It pauses omp's automatic theme detection until omp restarts.
- A transform the host already uses (for example, live-voice transcript coloring) takes precedence.
- Other clients and plain output are not colorized.

## What gets uwufied, and what doesn't

| uwufied | kept byte-for-byte |
|---|---|
| Natural-language chat replies to you | Code blocks and inline code |
| | Shell commands, file paths, URLs |
| | Identifiers, config keys, quoted error messages |
| | Tool-call arguments and file contents the agent writes or edits |
| | Commit messages and prompts sent to subagents |

Style rules include `r`/`l` → `w`, occasional `th` → `d`, `na/ne/no` → `nya/nye/nyo`, occasional stutter, a broad rotating selection of kaomoji, and the odd cute emoji (`✨ 💖 🌸 🎀`). The kaomoji selection includes examples from [kaomoji.you](https://kaomoji.you/), such as `٩(◕‿◕｡)۶`, `(ฅ^•ﻌ•^ฅ)`, and `(づ｡◕‿‿◕｡)づ`. Meaning, numbers and warnings must stay readable.

Here's the same prompt and model, with the mode off and on:

![Two real omp replies side by side: plain English on the left, uwu-speak on the right, with an identical code block in both](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/before-after.png)

These are real, unedited replies from `anthropic/claude-opus-5-5`, rendered as images. Both code blocks are identical byte for byte. The transcripts are in [`demo/`](demo).

### kawaii/uwu-bench

On kawaii/uwu-bench, Opus 5.5 scores 0.1% on its own and 98.5% with omp-uwu enabled:

![kawaii/uwu-bench: Opus 5.5 scores 0.1%, Opus 5.5 with omp-uwu scores 98.5%](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/uwu-bench.png)

Only the two scores come from the benchmark run. The other numbers on the chart are computed from them, and the terminal and config panels are decoration.

## How it works

There are three styles:

- **rewrite** (default). After a reply finishes streaming, its text blocks are uwufied deterministically before they go into history and context. No extra prompt tokens are needed. Code and tool blocks and metadata stay untouched. The first turn uses prompt style until omp shows that it supports the awaited `assistant_message` hook. If the hook never shows up (for example on omp `18.4.3`), prompt style stays on as the fallback. The TUI refreshes the message when streaming finishes, but clients that only render streamed chunks may keep showing the original text.
- **prompt**. A style instruction is added to the system prompt, so the reply is uwu while it streams. The result depends on the model.
- **display** (experimental). Nothing is sent to the model and history is never changed. Prose is restyled only when the ANSI TUI draws it (see below).

Rewrite and display protect fenced and inline code, URLs, paths, numbers, quoted spans, identifiers and safety-critical words. Subagent prompts, subagent messages and tool-call arguments are never styled.

Intensity and locale apply to all three styles. `mid` is the original strength, `low` changes fewer words and adds fewer decorations, and `max` is stronger. `auto` protects both English **and** Turkish critical words; it does not detect the language. `en` protects English only, and `tr` adds Turkish forms on top of English. Negations, warnings and common Turkish inflections are protected conservatively; this is not a full linguistic parser.

### Display mode (experimental)

Display mode uses omp's per-message text transform, which is not public extension API. The plugin finds `AssistantMessageComponent` through the shared `Container` base class. If it can't, display styling and sparkles do nothing (the palette still works), and there is **no silent fallback** to prompt or rewrite style. `/uwu status` shows whether the hook was found.

Things to expect:

- Styling happens on individual Markdown prose runs, before wrapping. Inline formatting, links, newlines and streaming edits split runs, so the result can differ from a rewrite or `/uwu preview`. No emoticons or stutters are added.
- Identifiers, numbers and quoted spans within a run stay protected. A quote that spans several runs can't be protected as a whole.
- Some render paths skip the transform (blockquotes, some tables, headings and math), so that text may stay unchanged.
- Native clients are **unsupported**: omp `18.4.4` sends them raw Markdown. RPC, print and export output also stay original.
- Changing display, level, locale or on/off refreshes messages already on screen, with or without colors.

## Install options

```sh
omp plugin install omp-uwu          # from npm (recommended)
omp plugin install omp-uwu@0.6.0    # pin a version
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

For an interactive smoke check, start `omp -e ./src/index.ts` with an isolated test agent directory and run `/uwu colors off`, `/uwu display`, then `/uwu status`:

1. Edit the draft and switch tabs. The sample should update, but existing messages and saved settings should not change.
2. Press Esc; nothing should be saved. Reopen, focus Save and press Enter; the settings should persist, and colors, the badge and assistant paragraphs on screen should refresh.
3. Ask for ordinary prose plus inline and fenced code. The prose should be styled and rewrapped (try a narrow terminal); the code should stay exact.
4. With colors still off, change intensity, locale and mode. Existing assistant paragraphs should refresh after Save.
5. Reopen the saved transcript or export: the raw text should be unchanged, and the next model prompt should have no uwu instruction in display mode.

On a native client, prose should stay unchanged, with no fallback to prompt styling.

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
git tag v0.6.0
git push origin main v0.6.0
```

The workflow uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/), so the repository has no npm token. npm only allows trusted publishing on a package that already exists, so the first version is published by hand with `npm publish --access public`. After that, go to the package's Settings → Trusted publishing on npmjs.com and add GitHub Actions with user `NaC-L`, repository `omp-uwu`, and workflow `publish.yml`.

## License

MIT
