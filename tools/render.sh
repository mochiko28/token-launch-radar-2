#!/usr/bin/env bash
set -euo pipefail

export XDG_CACHE_HOME=${XDG_CACHE_HOME:-/work/.tmp/cache}
mkdir -p -- "$XDG_CACHE_HOME"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: %s <output dir> [snapshot file or input dir]\n' "$0" >&2
  exit 2
fi

repo=$(cd -- "$(dirname -- "$0")/.." && pwd)
output=$1
input=${2:-/input/snapshot.json}
if [[ ! -f $input && $# -eq 1 && -f /work/kit/input/snapshot.json ]]; then
  input=/work/kit/input/snapshot.json
fi

node "$repo/main.ts" --input "$input" --output "$output"
node "$repo/tools/shoot.mjs" "$output" "$repo/screenshots"
node "$repo/main.ts" --input "$input" --output "$output"
