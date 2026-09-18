#!/usr/bin/env bash
# scripts/homelab/pull-backup.sh — run FROM THE MAC (launchd, daily; or by hand).
# Checkpoint 10.8.5, ADR-080: the off-host copy. The host's backups and image
# tarballs live on the same single NVMe as the data, so this pull is the only
# thing that survives that disk. rsync over SSH with the deployment key into
# $DEST (default ~/PersonalOS-Backups, mode 700), mirroring the host's
# retention (--delete). Never pushes anything to the host.
#
#   scripts/homelab/pull-backup.sh [ssh-host]
#   scripts/homelab/pull-backup.sh --install-launchd     daily at 09:30 local
set -euo pipefail
HOST="${HOST:-personal-os}"
DEST="${DEST:-$HOME/PersonalOS-Backups}"
LOG="$DEST/pull.log"
if [ "${1:-}" = "--install-launchd" ]; then
  plist="$HOME/Library/LaunchAgents/com.personal-os.pull-backup.plist"
  me="$(cd "$(dirname "$0")" && pwd)/pull-backup.sh"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.personal-os.pull-backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$me</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/PersonalOS-Backups/launchd.out</string>
  <key>StandardErrorPath</key><string>$HOME/PersonalOS-Backups/launchd.err</string>
</dict></plist>
PLIST
  mkdir -p "$DEST"; chmod 700 "$DEST"
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "installed $plist"; launchctl print "gui/$(id -u)/com.personal-os.pull-backup" | grep -E "state|last exit" || true
  exit 0
fi
[ -n "${1:-}" ] && HOST="$1"
mkdir -p "$DEST/host"; chmod 700 "$DEST"
start="$(date -u +%FT%TZ)"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'echo ok' >/dev/null
rsync -a --delete -e "ssh -o BatchMode=yes" "$HOST:personal-os-backups/" "$DEST/host/personal-os-backups/"
rsync -a --delete -e "ssh -o BatchMode=yes" "$HOST:personal-os-images/"  "$DEST/host/personal-os-images/"
# the shipped release directories are git archives; the repo itself is on GitHub — not copied
n="$(ls "$DEST/host/personal-os-backups/db" | grep -c '\.dump$' || true)"
echo "$start pulled: $n db dumps, images $(du -sh "$DEST/host/personal-os-images" | cut -f1), total $(du -sh "$DEST/host" | cut -f1)" | tee -a "$LOG"
