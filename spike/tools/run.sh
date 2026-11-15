#!/bin/sh
# Usage: tools/run.sh <run-name> <mutant-file|none> <config> [e2e run args...]
# Runs one e2e pass with a clean environment, its own output dir, and a fresh
# copy of the baseline cache, so nothing outside runs/<run-name> is written.
set -u
name="$1"; mutant="$2"; config="$3"; shift 3
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
rm -rf "runs/$name" "runs/cache-$name"
mkdir -p "runs/cache-$name"
[ -d runs/cache-baseline ] && cp -R runs/cache-baseline/. "runs/cache-$name/"
inject=""
[ "$mutant" != "none" ] && inject="$root/mutants/$mutant"
env -i PATH="$PATH" HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL="$SHELL" \
  TMPDIR="$TMPDIR" LANG="${LANG:-en_US.UTF-8}" TERM=dumb E2E_TELEMETRY_DISABLED=1 \
  ${inject:+E2E_MUTATE_SCRIPT="$inject"} \
  ./node_modules/.bin/e2e run "$@" --config "$config" --output "runs/$name" \
  --cache-dir "runs/cache-$name" --retries 0 --workers 1 --trace=on > "runs/$name.log" 2>&1
echo "$name exit=$?"
