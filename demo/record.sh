#!/usr/bin/env bash
# Capture the transcripts used by render.py: one real omp reply with the
# extension loaded, one without, same prompt and model.
#
# Runs in a throwaway agent dir so your own AGENTS.md, rules and extensions
# don't shape the replies. Copy your logged-in agent.db into it first:
#   mkdir -p /tmp/omp-demo && cp ~/.omp/agent/agent.db* /tmp/omp-demo/
set -euo pipefail
cd "$(dirname "$0")"

export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-/tmp/omp-demo}"
MODEL="${MODEL:-anthropic/claude-opus-5-5}"
prompt="$(cat prompt.txt)"

omp -p --no-session --no-tools --no-extensions --model "$MODEL" -e ../src/index.ts "$prompt" > uwu.txt
omp -p --no-session --no-tools --no-extensions --model "$MODEL" "$prompt" > plain.txt

echo "captured uwu.txt and plain.txt; now run: uv run --with pillow python demo/render.py"
