# OMP UwU

A tiny [Oh My Pi (OMP)](https://github.com/oh-my-pi/oh-my-pi) extension that asks the assistant to phrase its natural-language replies in playful uwu-speak. It aims to leave code, commands, paths, URLs, identifiers, and tool inputs unchanged.

> **How it works:** OMP extensions do not have a supported hook for rewriting the text already rendered in the chat. This extension adds a style instruction to the system prompt before a request. The model follows that instruction, so the transformation is not guaranteed, and the instruction uses a small amount of context. It does not modify the assistant's response after generation.

## Install

### Copy the extension file

1. Download [`uwu.ts`](./uwu.ts) from this repository.
2. Put it in OMP's auto-discovered extensions folder:
   - **Windows:** `%USERPROFILE%\.omp\agent\extensions\uwu.ts`
   - **macOS/Linux:** `~/.omp/agent/extensions/uwu.ts`
3. Start or restart OMP so it loads the extension.

Create the `extensions` directory first if it does not exist. Alternatively, pass the file explicitly when launching OMP with `--extension /path/to/uwu.ts`.

## Usage

UwU mode is enabled by default for each OMP session where the extension loads.

- `/uwu` — toggle the mode on or off
- `/uwu on` — enable it
- `/uwu off` — disable it

The setting is session-local and resets to enabled in a new session.

## Notes

- This extension changes the model's requested writing style; it does not alter conversation history or rewrite generated text.
- It tells the model not to uwufy code, commands, file contents, paths, URLs, identifiers, or tool arguments. As this is a prompt instruction, follow-through depends on the model.
- The extension uses OMP's `ExtensionAPI` from `@oh-my-pi/pi-coding-agent` and the `before_agent_start` event.
