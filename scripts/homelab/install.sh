#!/usr/bin/env bash
# scripts/homelab/install.sh — run FROM THE MAC. Copies the host-side scripts to
# ~/personal-os-ops on the production host (the stable path, like .env) and
# installs the three user crontab lines (watchdog, event watcher @reboot, daily
# backup) idempotently and starts the event watcher. Needs no root. The agent
# audit shell is copied but binding it to a key is a one-time manual edit of
# ~/.ssh/authorized_keys (docs/HOMELAB-RUNBOOK.md §3).
#
#   scripts/homelab/install.sh [ssh-host]     default: personal-os
set -euo pipefail
HOST="${1:-personal-os}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ssh -o BatchMode=yes "$HOST" 'mkdir -p ~/personal-os-ops ~/.personal-os-ops && chmod 700 ~/.personal-os-ops'
scp -q "$HERE"/check-host.sh "$HERE"/save-release-images.sh "$HERE"/harden-ssh.sh \
       "$HERE"/apply-os-updates.sh "$HERE"/agent-audit-shell.sh "$HERE"/docker-events-watch.sh \
       "$HERE"/backup-personal-os.sh "$HOST":personal-os-ops/
ssh -o BatchMode=yes "$HOST" '
  chmod 755 ~/personal-os-ops/*.sh
  ( crontab -l 2>/dev/null | grep -vF "personal-os-ops/"
    echo "*/30 * * * * $HOME/personal-os-ops/check-host.sh >> $HOME/.personal-os-ops/cron.log 2>&1"
    echo "@reboot sleep 30 && $HOME/personal-os-ops/docker-events-watch.sh start >> $HOME/.personal-os-ops/cron.log 2>&1"
    echo "30 3 * * * $HOME/personal-os-ops/backup-personal-os.sh >> $HOME/.personal-os-ops/cron.log 2>&1"
  ) | crontab -
  ~/personal-os-ops/docker-events-watch.sh start >/dev/null 2>&1 || true
  echo "installed:"; ls -1 ~/personal-os-ops; echo "crontab:"; crontab -l | grep personal-os-ops
'
