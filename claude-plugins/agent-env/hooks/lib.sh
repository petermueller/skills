# Shared helpers for agent-env hooks.

# Print the path of a binary. Hook processes often get a thin PATH, so also look in common install dirs.
# AGENT_ENV_<NAME> (e.g. AGENT_ENV_MISE=/path/to/mise) overrides the lookup.
find_bin() {
  local name=$1 override dir
  override=$(printenv "AGENT_ENV_$(tr '[:lower:]' '[:upper:]' <<<"$name")")
  if [ -n "$override" ]; then echo "$override"; return; fi
  command -v "$name" 2>/dev/null && return
  for dir in "$HOME/.local/bin" "$HOME/local/bin" /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$dir/$name" ]; then echo "$dir/$name"; return; fi
  done
}

# Print the outermost directory with a mix.exs between $1 and its git toplevel (the umbrella root, if any).
mix_root() {
  local dir=$1 top found=
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || top=/
  while :; do
    [ -f "$dir/mix.exs" ] && found=$dir
    [ "$dir" = "$top" ] || [ "$dir" = / ] && break
    dir=$(dirname "$dir")
  done
  [ -n "$found" ] && echo "$found"
}
