#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): `mix format` the one Elixir file that was just edited,
# with the project's mise toolchain. Silent when there is nothing to do.
#
# - Deps not fetched or out of sync with mix.lock: skip, and tell the agent once per session.
# - Any other failure (usually a syntax error): exit 2, so the agent sees the error.
set -u
. "$(dirname "$0")/lib.sh"

input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
session=$(jq -r '.session_id // "none"' <<<"$input")

case "$file" in *.ex | *.exs | *.heex | *.eex | *.leex) ;; *) exit 0 ;; esac
[ -f "$file" ] || exit 0
root=$(mix_root "$(dirname "$file")") || exit 0

marker="${TMPDIR:-/tmp}/agent-env-format-skip-$session"
note_skip() {
  [ -e "$marker" ] && exit 0
  : >"$marker"
  jq -n --arg m "agent-env: mix format skipped: $1 Formatting starts again after that." \
    '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
  exit 0
}

[ -d "$root/deps" ] || note_skip "this project has no deps/ folder. Fetch deps (the project's setup task, or \`mix deps.get\`)."

mise=$(find_bin mise)
if [ -n "$mise" ]; then run=("$mise" exec -- mix); else run=(mix); fi

out=$(cd "$root" && "${run[@]}" format "$file" 2>&1) && exit 0

if grep -qE 'Unchecked dependencies|lock mismatch|dependency is not available|given to :import_deps|mix.lock contains merge conflicts' <<<"$out"; then
  note_skip "deps are not in sync with mix.lock. Run \`mix deps.get\`."
fi

printf 'mix format failed for %s:\n%s\n' "$file" "$(tail -n 20 <<<"$out")" >&2
exit 2
