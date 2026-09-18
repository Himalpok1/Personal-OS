#!/usr/bin/env bash
# scripts/homelab/docker-events-watch.sh — runs ON THE HOST as a background
# process (started by the himallinux crontab @reboot; check-host.sh restarts it
# if it is not running). Checkpoint 10.8.5 (ADR-079 §5): the daemon's own event
# buffer is 256 events and dockerd does not journal image removals, so this is
# the durable record of what disappears.
#
#   docker-events-watch.sh start|stop|status
#
# Streams `docker events` for image untag/delete/prune, container destroy/prune,
# volume destroy/prune, network destroy/prune and builder prune into
# ~/.personal-os-ops/docker-events.log (one line each: time, type, action,
# name/id, reclaimed bytes for prunes). Pushes to ntfy immediately for:
# any `prune` event (with the reclaimed size); any image untag/delete or
# container/volume destroy whose name starts with personal-os- (compose
# one-off `-run-` containers excepted); and a burst of ≥5 image deletes inside
# 60 s (the signature of an `image prune -a` on foreign images).
set -uo pipefail
OPS_DIR="${OPS_DIR:-$HOME/.personal-os-ops}"; mkdir -p "$OPS_DIR"
LOG="$OPS_DIR/docker-events.log"; PID="$OPS_DIR/docker-events.pid"
NTFY_URL="${NTFY_URL:-http://100.117.78.19:8085/personal-os-ops}"
[ -f "$OPS_DIR/config" ] && . "$OPS_DIR/config"

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }
notify() { curl -s -m 5 -o /dev/null -X POST -H "Title: $1" -H "Priority: $2" -H "Tags: whale,warning" -d "$3" "$NTFY_URL" >/dev/null 2>&1 || true; }

watch() {
  echo $$ > "$PID"
  burst_t=0; burst_n=0
  docker events \
    --filter type=image --filter type=container --filter type=volume --filter type=network --filter type=builder \
    --format '{{.TimeNano}} {{.Type}} {{.Action}} {{.Actor.ID}} name={{index .Actor.Attributes "name"}} reclaimed={{index .Actor.Attributes "reclaimed"}}' \
  | while read -r tnano type action id name reclaimed; do
      case "$type:$action" in
        image:untag|image:delete|image:prune|container:destroy|container:prune|volume:destroy|volume:prune|network:destroy|network:prune|builder:prune) ;;
        *) continue ;;
      esac
      ts="$(date -u -d "@$((tnano/1000000000))" +%FT%TZ 2>/dev/null || date -u +%FT%TZ)"
      printf '%s %s %s %s %s %s\n' "$ts" "$type" "$action" "$id" "$name" "$reclaimed" >> "$LOG"
      n="${name#name=}"; r="${reclaimed#reclaimed=}"
      case "$action" in
        prune) notify "docker $type prune on personal-os host" high "$ts $type prune, reclaimed ${r:-?} bytes" ;;
      esac
      case "$type:$n" in
        image:personal-os-*|volume:personal-os_*) notify "personal-os $type removed" high "$ts $type $action $n ($id)" ;;
        container:personal-os-*-run-*) ;;
        container:personal-os-*) notify "personal-os container destroyed" high "$ts container destroy $n" ;;
      esac
      if [ "$type:$action" = image:delete ]; then
        now=$(date +%s)
        if [ $((now - burst_t)) -gt 60 ]; then burst_t=$now; burst_n=0; fi
        burst_n=$((burst_n+1))
        [ "$burst_n" = 5 ] && notify "bulk image removal on personal-os host" high "$ts: ≥5 image deletes within 60 s (image prune -a signature); see ~/.personal-os-ops/docker-events.log"
      fi
    done
  rm -f "$PID"
}

case "${1:-status}" in
  start)  running && { echo "already running pid $(cat "$PID")"; exit 0; }
          nohup "$0" _watch >> "$OPS_DIR/docker-events.err" 2>&1 &
          sleep 1; running && echo "started pid $(cat "$PID")" || { echo "failed to start" >&2; exit 1; } ;;
  _watch) watch ;;
  stop)   running && kill "$(cat "$PID")"; rm -f "$PID"; echo stopped ;;
  status) running && echo "running pid $(cat "$PID")" || { echo "not running"; exit 1; } ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
