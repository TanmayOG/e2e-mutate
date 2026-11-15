#!/bin/sh
# Runs a command with a minimal environment: needed when e2e is started from
# inside a Claude Code session, so the nested Claude Code agent (through
# @e2e-dev/acp) uses its own login instead of the host session's variables.
exec env -i PATH="$PATH" HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL="$SHELL" \
  TMPDIR="$TMPDIR" LANG="${LANG:-en_US.UTF-8}" TERM=dumb E2E_TELEMETRY_DISABLED=1 "$@"
