#!/usr/bin/env bash
# scripts/homelab/apply-os-updates.sh — runs ON THE HOST, NEEDS ROOT:
#   ssh -t personal-os 'sudo bash ~/personal-os-ops/apply-os-updates.sh'
#
# Applies every pending apt update (Checkpoint 10.8.5, after the prune root
# cause was understood). It does NOT reboot: the kernel/libc reboot is a
# separate, explicit owner command (see docs/HOMELAB-RUNBOOK.md → Reboot).
#
# Expect: if docker-ce/containerd are in the set, the Docker daemon restarts
# and EVERY container restarts with it (live-restore is off) — a ~30 s outage
# for Personal OS, postgres included; pg-boss jobs in flight are retried.
# Run it in a quiet window, not mid-deployment.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
echo "--- upgradable before:"; apt list --upgradable 2>/dev/null | grep -c upgradable || true
apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade
apt-get -y autoremove --purge
echo "--- upgradable after:"; apt list --upgradable 2>/dev/null | grep -c upgradable || true
if [ -f /var/run/reboot-required ]; then
  echo "REBOOT REQUIRED for: $(tr '\n' ' ' < /var/run/reboot-required.pkgs)"
  echo "when ready: sudo reboot   — then from the Mac: scripts/homelab/preflight.sh"
fi
echo "docker: $(docker --version 2>/dev/null)"; docker ps --format '{{.Names}} {{.Status}}' | grep '^personal-os-'
