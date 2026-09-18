#!/usr/bin/env bash
# scripts/homelab/preflight.sh — run FROM THE MAC before any deployment step.
# (1) proves the deployment key still works non-interactively — the first
# thing that failed on 2026-09-18 — and (2) runs the host watchdog in report
# mode: rollback tags, saved image set, disk, containers, /health, socket
# mounts, reboot flag. Exit 3 on any RED; do not deploy over a RED.
set -uo pipefail
HOST="${1:-personal-os}"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'echo ok' >/dev/null 2>&1; then
  echo "RED ssh: BatchMode login to $HOST failed — restore the deployment key first" >&2
  echo "     (ssh-copy-id -i ~/.ssh/id_ed25519.pub $HOST, or see docs/HOMELAB-RUNBOOK.md)" >&2
  exit 3
fi
ssh -o BatchMode=yes "$HOST" '~/personal-os-ops/check-host.sh --report'
rc=$?
ssh -o BatchMode=yes "$HOST" 'echo; echo "containers not created by Personal OS:"; docker ps --format "{{.Names}}" | grep -v "^personal-os-" | tr "\n" " "; echo'
exit $rc
