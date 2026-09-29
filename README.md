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

Restart omp. uwu mode is **on** by default in every session.

- `/uwu` toggles it
- `/uwu on` / `/uwu off` sets it explicitly
- `/uwu rewrite` uses omp's finalized-message rewrite hook when available
- `/uwu prompt` asks the model to write in uwu style while it streams
- `/uwu colors on` / `/uwu colors off` enables or disables the optional kawaii palette (off by default; preference persists)

The palette colors chat markdown and the user-message bubble without putting ANSI codes into message text/history. It is applied as an in-memory TUI theme; components sharing those colors can change too. The host's in-memory theme setter pauses automatic theme detection until omp restarts. The TUI also shows a theme-accent `(◕ᴗ◕✿) uwu` status badge; other clients/plain output are not colorized.

## What gets uwufied, and what doesn't

| uwufied | kept byte-for-byte |
|---|---|
| Natural-language chat replies to you | Code blocks and inline code |
| | Shell commands, file paths, URLs |
| | Identifiers, config keys, quoted error messages |
| | Tool-call arguments and file contents the agent writes or edits |
| | Commit messages and prompts sent to subagents |

Style rules include `r`/`l` → `w`, occasional `th` → `d`, `na/ne/no` → `nya/nye/nyo`, occasional stutter, and a broad rotating selection of kaomoji. The kaomoji selection includes examples from [kaomoji.you](https://kaomoji.you/), such as `٩(◕‿◕｡)۶`, `(ฅ^•ﻌ•^ฅ)`, and `(づ｡◕‿‿◕｡)づ`. Meaning, numbers and warnings must stay readable.

Here's the same prompt and model, with the mode off and on:

![Two real omp replies side by side: plain English on the left, uwu-speak on the right, with an identical code block in both](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/before-after.png)

These are real, unedited replies from `anthropic/claude-opus-5-5`, rendered as images. Both code blocks are identical byte for byte. The transcripts are in [`demo/`](demo).

### kawaii/uwu-bench

On kawaii/uwu-bench, Opus 5.5 scores 0.1% on its own and 98.5% with omp-uwu enabled:

![kawaii/uwu-bench: Opus 5.5 scores 0.1%, Opus 5.5 with omp-uwu scores 98.5%](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/uwu-bench.png)

Only the two scores come from the benchmark run. The other numbers on the chart are computed from them, and the terminal and config panels are decoration.

## How it works

On the first turn, omp-uwu uses the prompt style until the host demonstrates support for the awaited `assistant_message` hook; after that, the default **rewrite** style deterministically uwufies finalized assistant text before it is added to history and context. This first-turn check makes the experience work on both older and newer omp builds. Only text in existing text blocks is changed; code/tool blocks and their metadata stay untouched. Rewrites are markdown-aware and preserve fenced/inline code, URLs, paths, numbers, quoted text, identifiers, and safety-critical words.

The hook runs after streaming has finished. The TUI refreshes the current assistant message at completion, but clients that render only streamed chunks may continue showing the original text. If the hook is unavailable (including omp `18.4.3`), prompt style remains enabled as the compatibility fallback. `/uwu prompt` selects live prompt styling directly.

- **Deterministic rewrite.** No style instruction/token overhead once the hook is detected.
- **Prompt style.** Model-dependent, with live uwu output while streaming.
- **Persistent settings.** `/uwu off` is remembered across sessions; `/uwu on` re-enables uwu. The colors preference is remembered too. Settings are stored in `~/.omp/agent/omp-uwu.json`. UwU mode remains on by default until explicitly changed.

## Install options

```sh
omp plugin install omp-uwu          # from npm (recommended)
omp plugin install omp-uwu@0.3.0    # pin a version
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
git tag v0.2.0
git push origin main v0.2.0
```

The workflow uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/), so the repository has no npm token. npm only allows trusted publishing on a package that already exists, so the first version is published by hand with `npm publish --access public`. After that, go to the package's Settings → Trusted publishing on npmjs.com and add GitHub Actions with user `NaC-L`, repository `omp-uwu`, and workflow `publish.yml`.

## License

MIT
