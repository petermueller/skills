#!/usr/bin/env bash
# SessionStart: set up the environment that every later Bash tool call inherits (via $CLAUDE_ENV_FILE),
# and tell the agent about it.
#
#   1. mise: export the project's toolchain, so `mix`, `elixir`, `node`… are the pinned versions.
#   2. git:  route github.com remotes through HTTPS + `gh auth git-credential`, for shells where an
#            SSH agent can't prompt (e.g. a locked password-manager agent). Set AGENT_ENV_GIT_VIA_GH=0 to skip.
#   3. Mix:  if deps/ is missing, tell the agent to run the project's setup task first.
set -u
. "$(dirname "$0")/lib.sh"

input=$(cat)
cwd=$(jq -r '.cwd // empty' <<<"$input")
cwd=${cwd:-$PWD}
env_file=${CLAUDE_ENV_FILE:-}
notes=()

mise=$(find_bin mise)
if [ -n "$mise" ] && [ -n "$env_file" ] && exports=$(cd "$cwd" && "$mise" env -s bash 2>/dev/null) && [ -n "$exports" ]; then
  printf '%s\n' "$exports" >>"$env_file"
  notes+=("Bash commands in this session already run with the project's mise toolchain. Run tools directly (e.g. \`mix test\`); \`mise exec --\` is not needed.")
fi

gh=$(find_bin gh)
if [ "${AGENT_ENV_GIT_VIA_GH:-1}" != 0 ] && [ -n "$gh" ] && [ -n "$env_file" ] && "$gh" auth token >/dev/null 2>&1; then
  # The empty helper clears inherited helpers (e.g. a keychain with a stale token) for github.com only.
  cat >>"$env_file" <<EOF
export GIT_CONFIG_COUNT=4
export GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf
export GIT_CONFIG_VALUE_0=git@github.com:
export GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf
export GIT_CONFIG_VALUE_1=ssh://git@github.com/
export GIT_CONFIG_KEY_2=credential.https://github.com.helper
export GIT_CONFIG_VALUE_2=
export GIT_CONFIG_KEY_3=credential.https://github.com.helper
export GIT_CONFIG_VALUE_3='!$gh auth git-credential'
EOF
  notes+=("Git commands to github.com in this session use HTTPS with \`gh\` credentials, not SSH. If a push or fetch still fails, show the error to the user. Do not try other auth workarounds or SSH diagnostics.")
fi

if root=$(mix_root "$cwd") && [ ! -d "$root/deps" ]; then
  setup='mix deps.get'
  grep -qs '"worktree.setup"\|worktree\.setup' "$root/mix.exs" && setup='mix worktree.setup'
  notes+=("This Mix project has no deps/ folder yet. Run \`$setup\` in \`$root\` before any other mix command. If it fails, show the error to the user. Do not change services, databases or config to work around it.")
fi

[ ${#notes[@]} -eq 0 ] && exit 0
ctx=$(printf -- '- %s\n' "${notes[@]}")
jq -n --arg ctx "agent-env:"$'\n'"$ctx" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
