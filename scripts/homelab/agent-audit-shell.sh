#!/usr/bin/env bash
# scripts/homelab/agent-audit-shell.sh — a forced command that RECORDS and then
# RUNS, unrestricted. Checkpoint 10.8.5 (ADR-079 §4): the owner's agent Ray is a
# trusted operator on the production host; its access is not reduced, but every
# command it sends over SSH is now visible. Bound in ~/.ssh/authorized_keys as
#   command="/home/himallinux/personal-os-ops/agent-audit-shell.sh hatch" ssh-ed25519 AAAA… hatch
# (no `restrict`, so port forwarding, pty, scp, sftp and rsync keep working).
#
# What it does for every session: append one line to ~/.personal-os-ops/agent-ssh.log
# (UTC time, key label, client IP, a flag, the command — secrets-shaped
# assignments scrubbed, newlines folded, 400 chars max), post the line to ntfy
# immediately when the command is destructive (prune/rm/rmi/down/rm -rf/
# authorized_keys/.env), then exec exactly what was asked:
#   no command      → the login shell (interactive)
#   "sftp"          → the sftp subsystem
#   anything else   → $SHELL -c "<command>"
# It never refuses anything. If this file is missing sshd refuses the login, so
# check-host.sh verifies it exists and is executable.
LABEL="${1:-agent}"
OPS_DIR="$HOME/.personal-os-ops"; LOG="$OPS_DIR/agent-ssh.log"
NTFY_URL="${NTFY_URL:-http://100.117.78.19:8085/personal-os-ops}"
[ -f "$OPS_DIR/config" ] && . "$OPS_DIR/config"
mkdir -p "$OPS_DIR"; touch "$LOG"; chmod 600 "$LOG"

cmd="${SSH_ORIGINAL_COMMAND:-}"
ip="${SSH_CONNECTION%% *}"
shown="$(printf '%s' "$cmd" | tr '\n\r' '␤ ' | sed -E 's/((PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|CLIENT_SECRET)[A-Z_]*[=:] *)[^ ;&|"'"'"']+/\1[scrubbed]/gI' | cut -c1-400)"
flag="-"
case "$cmd" in
  *"prune"*|*"docker rmi"*|*"docker image rm"*|*"docker rm "*|*"docker container rm"*|*"volume rm"*|*"compose down"*|*"rm -rf"*|*"authorized_keys"*|*"personal-os/.env"*|*"reboot"*|*"shutdown"*|*"systemctl "*)
    flag="!" ;;
esac
printf '%s %s %s %s %s\n' "$(date -u +%FT%TZ)" "$LABEL" "$ip" "$flag" "${shown:-<interactive>}" >> "$LOG"
if [ "$flag" = "!" ]; then
  ( curl -s -m 5 -o /dev/null -X POST -H "Title: agent $LABEL: destructive command" -H "Priority: high" -H "Tags: warning,robot" \
      -d "$ip: ${shown}" "$NTFY_URL" >/dev/null 2>&1 & )
fi

if [ -z "$cmd" ]; then
  exec "${SHELL:-/bin/bash}" -l
elif [ "$cmd" = "sftp" ] || [ "$cmd" = "internal-sftp" ]; then
  exec /usr/lib/openssh/sftp-server
else
  exec "${SHELL:-/bin/bash}" -c "$cmd"
fi
