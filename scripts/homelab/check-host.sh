#!/usr/bin/env bash
# scripts/homelab/check-host.sh — runs ON THE PRODUCTION HOST (cron, every 30 min).
#
# Checkpoint 10.8.5 (ADR-079). Read-only host watchdog for the Personal OS
# deployment on a host that is now shared with other stacks and an AI agent.
# It checks the things whose silent loss cost real time on 2026-09-18 and
# pushes to the ntfy topic already running on the host when the picture
# changes — never on every tick — plus one low-priority heartbeat a day so a
# dead watchdog is itself visible.
#
#   check-host.sh            cron mode: evaluate, notify on change, log a line
#   check-host.sh --report   human-readable report on stdout (no notification),
#                            exit 3 when anything is RED — the deploy preflight
#                            and the post-reboot validation both use this.
#
# Checks: root disk usage; the four Personal OS containers (running, restart
# count, health); GET /health (status, worker staleness); at least one
# rollback-pre-* tag per service; a saved image set in $IMAGE_STORE; the
# deployment SSH key still present in ~/.ssh/authorized_keys; containers with a
# WRITABLE Docker socket outside the allowlist; the reboot-required flag.
# --report adds tailscale serve, the public HTTPS health and today's NVMe AER
# count. Everything is a count, a status token or a name — no user data.
set -uo pipefail

OPS_DIR="${OPS_DIR:-$HOME/.personal-os-ops}"
CONFIG="$OPS_DIR/config"
mkdir -p "$OPS_DIR"
# Defaults; override in $OPS_DIR/config (a shell fragment).
NTFY_URL="${NTFY_URL:-http://100.117.78.19:8085/personal-os-ops}"
IMAGE_STORE="${IMAGE_STORE:-$HOME/personal-os-images}"
DEPLOY_KEY_FP="${DEPLOY_KEY_FP:-SHA256:+7UVEergzuSiOvnI9RLsS7/bxbhxunlms42m89EjOp4}"
ALLOWED_SOCKET_RW="${ALLOWED_SOCKET_RW:-watchtower}"
DISK_WARN="${DISK_WARN:-80}"
DISK_CRIT="${DISK_CRIT:-90}"
HEARTBEAT_HOUR="${HEARTBEAT_HOUR:-08}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://personal-os.tail62a68f.ts.net/health}"
[ -f "$CONFIG" ] && . "$CONFIG"

MODE="${1:-cron}"
problems=()   # "RED name: message" / "YELLOW name: message"
infos=()
red()    { problems+=("RED $1"); }
yellow() { problems+=("YELLOW $1"); }
info()   { infos+=("$1"); }

# --- disk -------------------------------------------------------------------
pct="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
if   [ "$pct" -ge "$DISK_CRIT" ]; then red "disk: / at ${pct}% (>= ${DISK_CRIT}%)"
elif [ "$pct" -ge "$DISK_WARN" ]; then yellow "disk: / at ${pct}% (>= ${DISK_WARN}%)"
else info "disk / ${pct}%"; fi

# --- docker + containers ----------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  red "docker: daemon unreachable"
else
  for c in personal-os-postgres-1 personal-os-api-1 personal-os-worker-1 personal-os-web-1; do
    st="$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$c" 2>/dev/null)" \
      || { red "container: $c missing"; continue; }
    set -- $st
    [ "$1" = running ] || red "container: $c is $1"
    [ "$2" = 0 ] || yellow "container: $c RestartCount=$2"
    case "$3" in healthy|-) ;; *) red "container: $c health=$3";; esac
  done
  # rollback tags: at least one rollback-pre-* per service
  for svc in api worker web; do
    n="$(docker images "personal-os-$svc" --format '{{.Tag}}' 2>/dev/null | grep -c '^rollback-pre-' || true)"
    [ "$n" -ge 1 ] || red "rollback: no personal-os-$svc:rollback-pre-* tag (image rollback needs a rebuild)"
  done
  # writable docker socket outside the allowlist
  while read -r name mounts; do
    case " $ALLOWED_SOCKET_RW " in *" $name "*) continue;; esac
    echo "$mounts" | grep -q 'docker.sock:rw' && yellow "socket: $name mounts the Docker socket read-write"
  done < <(docker ps -a --format '{{.Names}}' | while read -r n; do
             printf '%s %s\n' "$n" "$(docker inspect -f '{{range .Mounts}}{{.Source}}:{{if .RW}}rw{{else}}ro{{end}} {{end}}' "$n")"; done)
  imgs="$(docker system df --format '{{.Type}} {{.TotalCount}} {{.Size}} {{.Reclaimable}}' 2>/dev/null | tr '\n' ';')"
  info "docker: $imgs"
fi

# --- saved image set --------------------------------------------------------
newest="$(ls -1t "$IMAGE_STORE" 2>/dev/null | head -1 || true)"
if [ -z "$newest" ]; then
  red "image-store: nothing saved under $IMAGE_STORE (run save-release-images.sh)"
else
  for svc in api worker web; do
    f="$IMAGE_STORE/$newest/$svc.tar.gz"
    [ -s "$f" ] || red "image-store: $newest/$svc.tar.gz missing"
  done
  info "image-store: newest=$newest labels=$(ls -1 "$IMAGE_STORE" | tr '\n' ' ')"
fi

# --- API health -------------------------------------------------------------
h="$(curl -s -m 5 http://127.0.0.1:3000/health 2>/dev/null || true)"
if [ -z "$h" ]; then
  red "api: GET /health failed"
else
  eval "$(printf '%s' "$h" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    w=d.get("worker") or {}
    print("H_STATUS=%r H_DB=%r H_STALE=%r" % (str(d.get("status")), str(d.get("database", d.get("db"))), str(w.get("stale"))))
except Exception as e:
    print("H_STATUS=parse-error H_DB=? H_STALE=?")' 2>/dev/null)"
  [ "${H_STATUS:-}" = ok ] || red "api: /health status=${H_STATUS:-?}"
  [ "${H_STALE:-}" = False ] || red "worker: heartbeat stale=${H_STALE:-?}"
  info "api /health status=${H_STATUS:-?} db=${H_DB:-?} worker.stale=${H_STALE:-?}"
fi

# --- deployment key ---------------------------------------------------------
if [ -f "$HOME/.ssh/authorized_keys" ] && ssh-keygen -lf "$HOME/.ssh/authorized_keys" 2>/dev/null | grep -qF "$DEPLOY_KEY_FP"; then
  info "deploy key present ($(grep -c . "$HOME/.ssh/authorized_keys") keys in authorized_keys)"
else
  red "ssh: deployment key $DEPLOY_KEY_FP is NOT in ~/.ssh/authorized_keys"
fi

# --- OS ---------------------------------------------------------------------
[ -f /var/run/reboot-required ] && yellow "os: reboot required ($(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null))"

# --- report-only extras -----------------------------------------------------
if [ "$MODE" = "--report" ]; then
  info "tailscale serve: $(tailscale serve status 2>/dev/null | grep -cE 'tailnet only|https://') route lines"
  pub="$(curl -s -m 8 "$PUBLIC_HEALTH_URL" 2>/dev/null | head -c 200)"
  [ -n "$pub" ] && info "public https /health: ${pub:0:80}" || yellow "public https /health: no answer from $PUBLIC_HEALTH_URL"
  aer="$(journalctl -k --since today --no-pager 2>/dev/null | grep -c 'AER: Correctable error' || true)"
  [ "${aer:-0}" -gt 0 ] && yellow "nvme: $aer PCIe correctable errors today (hardware signal; no backups exist — ADR-024)"
  info "uptime: $(uptime -p 2>/dev/null)"
fi

# --- output -----------------------------------------------------------------
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
worst=GREEN
for p in "${problems[@]:-}"; do case "$p" in RED*) worst=RED;; YELLOW*) [ "$worst" = RED ] || worst=YELLOW;; esac; done

if [ "$MODE" = "--report" ]; then
  echo "personal-os host check $now — $worst"
  for p in "${problems[@]:-}"; do [ -n "$p" ] && echo "  $p"; done
  for i in "${infos[@]}"; do echo "  info $i"; done
  [ "$worst" = RED ] && exit 3 || exit 0
fi

# cron mode: log, notify on change, daily heartbeat
printf '%s %s problems=%s\n' "$now" "$worst" "$(printf '%s|' "${problems[@]:-}")" >> "$OPS_DIR/checks.log"
state="$OPS_DIR/last-problems"
cur="$(printf '%s\n' "${problems[@]:-}" | sort)"
prev="$(cat "$state" 2>/dev/null || true)"
notify() { # title priority tags body
  curl -s -m 10 -o /dev/null -X POST -H "Title: $1" -H "Priority: $2" -H "Tags: $3" -d "$4" "$NTFY_URL" || true
}
if [ "$cur" != "$prev" ]; then
  printf '%s\n' "$cur" > "$state"
  case "$worst" in
    RED)    notify "personal-os host: RED" high warning "$cur";;
    YELLOW) notify "personal-os host: YELLOW" default warning "$cur";;
    GREEN)  notify "personal-os host: all clear" low white_check_mark "$(printf '%s\n' "${infos[@]}")";;
  esac
fi
hb="$OPS_DIR/heartbeat-$(date +%Y-%m-%d)"
if [ "$(date +%H)" = "$HEARTBEAT_HOUR" ] && [ ! -f "$hb" ]; then
  touch "$hb"; find "$OPS_DIR" -name 'heartbeat-*' -mtime +3 -delete 2>/dev/null
  notify "personal-os host: daily $worst" low heartbeat "$(printf '%s\n' "${problems[@]:-}" "${infos[@]}")"
fi
exit 0
