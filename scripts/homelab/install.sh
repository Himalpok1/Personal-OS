#!/usr/bin/env bash
# scripts/homelab/install.sh — run FROM THE MAC. Copies the host-side scripts to
# ~/personal-os-ops on the production host (the stable path, like .env) and
# installs the user crontab line for check-host.sh idempotently. Needs no root.
#
#   scripts/homelab/install.sh [ssh-host]     default: personal-os
set -euo pipefail
HOST="${1:-personal-os}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ssh -o BatchMode=yes "$HOST" 'mkdir -p ~/personal-os-ops ~/.personal-os-ops && chmod 700 ~/.personal-os-ops'
scp -q "$HERE"/check-host.sh "$HERE"/save-release-images.sh "$HERE"/harden-ssh.sh \
       "$HERE"/apply-os-updates.sh "$HERE"/ray-poll-wrapper.sh "$HOST":personal-os-ops/
ssh -o BatchMode=yes "$HOST" '
  chmod 755 ~/personal-os-ops/*.sh
  line="*/30 * * * * $HOME/personal-os-ops/check-host.sh >> $HOME/.personal-os-ops/cron.log 2>&1"
  ( crontab -l 2>/dev/null | grep -vF "personal-os-ops/check-host.sh" ; echo "$line" ) | crontab -
  echo "installed:"; ls -1 ~/personal-os-ops; echo "crontab:"; crontab -l | grep personal-os-ops
'
