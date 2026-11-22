#!/usr/bin/env bash
# Build the output, capture the screenshots from it, then rebuild so the dossier carries the new captures.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$here/../.tmp/out}
chrome=${CHROME:-$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64 | tail -1)/chrome-headless-shell}
mkdir -p "$out" && find "$out" -mindepth 1 -delete
MAKEFUN_OUTPUT_DIR="$out" node "$here/main.ts" --input "$here/../kit/input/snapshot.json" >/dev/null || true
node "$here/tools/shoot.mjs" "$chrome" "$out" "$here/screenshots"
find "$out/screenshots" -mindepth 1 -delete
MAKEFUN_OUTPUT_DIR="$out" node "$here/main.ts" --input "$here/../kit/input/snapshot.json"
