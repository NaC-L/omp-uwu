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

## What gets uwufied, and what doesn't

| uwufied | kept byte-for-byte |
|---|---|
| Natural-language chat replies to you | Code blocks and inline code |
| | Shell commands, file paths, URLs |
| | Identifiers, config keys, quoted error messages |
| | Tool-call arguments and file contents the agent writes or edits |
| | Commit messages and prompts sent to subagents |

Style rules the agent follows: `r`/`l` → `w` in most words, `th` → `d` sometimes, `na/ne/no` → `nya/nye/nyo` sometimes, the occasional stutter (`h-hewwo`), and at most one emoticon per sentence (`uwu`, `owo`, `>w<`, `^w^`, `:3`). Meaning, numbers and warnings must stay readable.

Here's the same prompt and model, with the mode off and on:

![Two real omp replies side by side: plain English on the left, uwu-speak on the right, with an identical code block in both](https://raw.githubusercontent.com/NaC-L/omp-uwu/main/demo/before-after.png)

These are real, unedited replies from `anthropic/claude-opus-5-5`, rendered as images. Both code blocks are identical byte for byte. The transcripts are in [`demo/`](demo).

## How it works

omp has no extension hook for rewriting assistant text after it's generated. The `message_end` event only gets a detached copy of the message. So omp-uwu asks the model instead: on `before_agent_start` it adds a short style instruction to the end of the system prompt.

This has some consequences:

- **It depends on the model.** Most models follow it well, but the style isn't guaranteed. If code ever comes back uwufied, open an issue with the model name.
- **History stays clean.** Nothing is rewritten after generation, so session history, compaction and tools see exactly what the model wrote.
- **Small cost.** The instruction adds roughly 200 tokens to the system prompt while the mode is on. `/uwu off` removes it from the next request.
- **Session-local toggle.** The on/off state isn't saved. Each new session starts with uwu mode on.

## Install options

```sh
omp plugin install omp-uwu          # from npm (recommended)
omp plugin install omp-uwu@0.1.0    # pin a version
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

### Releasing

CI (`.github/workflows/ci.yml`) runs `check` and the tests on pushes to `main` and on pull requests. Pushing a `v*` tag runs them again, checks that the tag matches `version` in `package.json`, and publishes to npm with provenance (`.github/workflows/publish.yml`).

```sh
# bump "version" in package.json, commit, then:
git tag v0.1.1
git push origin main v0.1.1
```

The workflow uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/), so the repository has no npm token. npm only allows trusted publishing on a package that already exists, so the first version is published by hand with `npm publish --access public`. After that, go to the package's Settings → Trusted publishing on npmjs.com and add GitHub Actions with user `NaC-L`, repository `omp-uwu`, and workflow `publish.yml`.

## License

MIT
