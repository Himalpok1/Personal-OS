#!/usr/bin/env bash
# scripts/homelab/ray-poll-wrapper.sh — a forced command for an AGENT's SSH key.
#
# The owner's agent ("Ray", on tailnet node muse) polls this host every three
# minutes for its wall dashboard with exactly two read-only commands. Bound
# to its key with
#   restrict,command="/home/himallinux/personal-os-ops/ray-poll-wrapper.sh" ssh-ed25519 AAAA... hatch
# in ~/.ssh/authorized_keys, the key can run ONLY the commands allowlisted
# below. Anything else — including the `docker image prune -a` of 2026-09-18 —
# is refused and logged (a counts-only line: date, command name). Host
# administration by the agent then needs a separate key the owner enables on
# purpose, never the always-on poll key (ADR-079).
LOG="$HOME/.personal-os-ops/agent-ssh.log"
cmd="${SSH_ORIGINAL_COMMAND:-}"
case "$cmd" in
  'docker ps --format "{{.Names}}|{{.State}}|{{.Status}}"'|\
  'docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"'|\
  'docker ps'|'docker ps -a'|'uptime'|'df -h /')
    printf '%s allow %s\n' "$(date -u +%FT%TZ)" "${cmd%% *}" >> "$LOG"
    exec /bin/sh -c "$cmd" ;;
  *)
    printf '%s DENY %s\n' "$(date -u +%FT%TZ)" "${cmd%% *}" >> "$LOG"
    echo "refused: this key is restricted to read-only status commands (ADR-079)" >&2
    exit 126 ;;
esac
