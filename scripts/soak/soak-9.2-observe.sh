#!/usr/bin/env bash
# scripts/soak/soak-9.2-observe.sh
#
# Checkpoint 9.2 adoption-soak observer. READ-ONLY against production: one SQL
# statement (soak-9.2-observe.sql) over SSH, container inspection, GET /health,
# and `grep -c` counts over container logs. It never prints a log line, never
# writes to production, never commits, and never touches the repo working tree.
#
# Output: ONE JSON line on stdout, appended to $SOAK_OBS_DIR/observations.jsonl
# (default ~/.personal-os-soak/9.2, mode 700). Modes:
#   baseline  -- soak_start := 'now'; also writes baseline.json (pretty)
#   observe   -- default; uses SOAK_START below
#   final     -- same as observe; also writes final.json (pretty)
#   check     -- evaluates the LAST observation line: prints GREEN, or one
#                RED/YELLOW/INFO line per condition (exit 3 when any RED).
#                Cumulative since-start counters alert on their DELTA versus
#                the previous ok observation; standing counts print as INFO.
#
# Privacy: the SQL returns counts/dates/status tokens only; log counting uses
# `grep -c` on fixed patterns and never emits a matching line; /health carries
# no user data. See docs/SOAK-9.2.md.
set -euo pipefail

# Frozen at baseline. The baseline run sets it from the database clock.
SOAK_START="${SOAK_START:-__SOAK_START_UNSET__}"
SOAK_TZ="${SOAK_TZ:-America/Chicago}"
SOAK_OBS_DIR="${SOAK_OBS_DIR:-$HOME/.personal-os-soak/9.2}"
SOAK_SSH_HOST="${SOAK_SSH_HOST:-personal-os}"
EXPECTED_MIGRATIONS="${SOAK_EXPECTED_MIGRATIONS:-17}"

MODE="${1:-observe}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$HERE/soak-9.2-observe.sql"
OBS_FILE="$SOAK_OBS_DIR/observations.jsonl"

mkdir -p "$SOAK_OBS_DIR"
chmod 700 "$SOAK_OBS_DIR"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

# ---------------------------------------------------------------- check mode
# Evaluates the LAST observation. Cumulative since-start counters are compared
# against the PREVIOUS ok observation (delta alerting) so a single event does
# not re-alarm on every remaining day; standing counts are printed once as
# INFO. GREEN is printed only when no RED/YELLOW/INFO condition fired.
if [ "$MODE" = "check" ]; then
  [ -s "$OBS_FILE" ] || { echo "RED no observations recorded yet ($OBS_FILE)"; exit 3; }
  last="$(tail -n 1 "$OBS_FILE")"
  jq -e . >/dev/null 2>&1 <<<"$last" || { echo "RED last observation line is not valid JSON"; exit 3; }
  j() { jq -r "try ($1) // empty" <<<"$last"; }
  if [ "$(j '.ok | tostring')" != "true" ]; then
    echo "RED observation itself failed: $(j '.error' | head -c 300)"
    exit 3
  fi
  # previous OK observation (for deltas); empty when there is none
  prev="$(grep -F '"ok":true' "$OBS_FILE" | tail -n 2 | head -n 1)"
  [ "$prev" = "$last" ] && prev=""
  p() { [ -n "$prev" ] && jq -r "try ($1) // empty" <<<"$prev" || true; }
  base="$( [ -s "$SOAK_OBS_DIR/baseline.json" ] && cat "$SOAK_OBS_DIR/baseline.json" || echo '{}' )"
  b() { jq -r "try ($1) // empty" <<<"$base"; }
  red=0; fired=0
  emit() { echo "$1"; fired=1; case "$1" in RED*) red=1;; esac; }
  iso2s() { # ISO-8601 UTC -> epoch seconds (BSD or GNU date)
    local t="${1%%[.Z+]*}"
    date -u -j -f '%Y-%m-%dT%H:%M:%S' "$t" +%s 2>/dev/null || date -u -d "$1" +%s 2>/dev/null || echo 0
  }
  now_s="$(date -u +%s)"
  num_or0() { local v; v="$(j "$1")"; case "$v" in ''|null) echo 0;; *) echo "$v";; esac; }
  pnum_or0() { local v; v="$(p "$1")"; case "$v" in ''|null) echo 0;; *) echo "$v";; esac; }

  # --- freshness of the observation itself
  oa="$(j '.run_started_at // .observed_at')"
  if [ -n "$oa" ]; then
    age_h=$(( (now_s - $(iso2s "$oa")) / 3600 ))
    [ "$age_h" -le 26 ] || emit "RED last observation is ${age_h}h old (observer did not run)"
  fi

  # --- API / worker / schema
  [ "$(j '.host.health.status')" = "ok" ] || emit "RED GET /health status is not ok"
  [ "$(j '.host.health.db')" = "connected" ] || emit "RED GET /health db not connected"
  [ "$(j '.host.health.worker.stale | tostring')" = "false" ] || emit "RED GET /health reports worker stale"
  age="$(num_or0 '.db.worker_heartbeat_age_s')"; [ "$age" -le 300 ] || emit "RED worker heartbeat age ${age}s > 300s"
  [ "$(j '.db.migration_count')" = "$EXPECTED_MIGRATIONS" ] || emit "RED migration count $(j '.db.migration_count') != $EXPECTED_MIGRATIONS (unexpected schema change)"

  # --- containers (restart count RED; recreation YELLOW only when it changed since the previous observation)
  for c in api worker web postgres; do
    r="$(j ".host.containers.$c.restarts")"; st="$(j ".host.containers.$c.status")"
    [ "$st" = "running" ] || emit "RED container $c status=${st:-?}"
    [ "$r" = "0" ] || emit "RED container $c RestartCount=${r:-?}"
    cs="$(j ".host.containers.$c.started_at")"; ps_="$(p ".host.containers.$c.started_at")"; bs="$(b ".host.containers.$c.started_at")"
    if [ -n "$ps_" ] && [ "$ps_" != "$cs" ]; then emit "YELLOW container $c recreated since previous observation (log-epoch counters reset)"
    elif [ -z "$ps_" ] && [ -n "$bs" ] && [ "$bs" != "$cs" ]; then emit "YELLOW container $c recreated since baseline"; fi
  done

  # --- pg-boss (delta on cumulative since-start counters; current-state counters absolute)
  f="$(num_or0 '[.db.pgboss_failed_since_start_by_queue | to_entries[] | .value] | add')"
  pf="$(pnum_or0 '[.db.pgboss_failed_since_start_by_queue | to_entries[] | .value] | add')"
  if [ "$f" -gt "$pf" ]; then emit "RED $((f - pf)) new pg-boss job failure(s): $(j '.db.pgboss_failed_since_start_by_queue | tostring')"
  elif [ "$f" -gt 0 ]; then emit "INFO standing pg-boss failures since start: $(j '.db.pgboss_failed_since_start_by_queue | tostring')"; fi
  d="$(num_or0 '[.db.pgboss_dead_letter_since_start_by_queue | to_entries[] | .value] | add')"
  pd="$(pnum_or0 '[.db.pgboss_dead_letter_since_start_by_queue | to_entries[] | .value] | add')"
  if [ "$d" -gt "$pd" ]; then emit "RED $((d - pd)) new dead-letter arrival(s): $(j '.db.pgboss_dead_letter_since_start_by_queue | tostring')"
  elif [ "$d" -gt 0 ]; then emit "INFO standing dead letters since start: $(j '.db.pgboss_dead_letter_since_start_by_queue | tostring')"; fi
  [ "$(num_or0 '.db.pgboss_stale_created')" = "0" ] || emit "RED $(j '.db.pgboss_stale_created') pg-boss job(s) due >30 min and not started"
  [ "$(num_or0 '.db.pgboss_active_long')" = "0" ] || emit "RED $(j '.db.pgboss_active_long') pg-boss job(s) active >30 min"
  sc="$(num_or0 '.db.pgboss_schedule_count')"; [ "$sc" = "10" ] || emit "RED pg-boss schedule count $sc != 10"
  for cron in retention.cleanup occurrences.expand-window; do
    t="$(j ".db.pgboss_cron_last_completed[\"$cron\"]")"
    if [ -z "$t" ]; then emit "RED no completed $cron job in pg-boss history"
    else ch=$(( (now_s - $(iso2s "$t")) / 3600 )); [ "$ch" -le 26 ] || emit "RED last $cron completion is ${ch}h old (>26h)"; fi
  done
  [ "$(num_or0 '.host.worker_log.retention_last_tables_failed')" = "0" ] || emit "RED retention.cleanup reported tablesFailed>0"

  # --- monitoring
  [ "$(num_or0 '.db.monitor_incidents_open')" = "0" ] || emit "RED $(j '.db.monitor_incidents_open') open monitor incident(s)"
  mi="$(num_or0 '.db.monitor_incidents_since_start')"; pmi="$(pnum_or0 '.db.monitor_incidents_since_start')"
  [ "$mi" -le "$pmi" ] || emit "YELLOW $((mi - pmi)) monitor incident(s) opened since previous observation (now resolved unless RED above)"
  tot="$(num_or0 '[.db.monitor_checks_24h_by_status | to_entries[] | .value] | add')"
  [ "$tot" -ge 1000 ] || emit "RED monitor lane produced only $tot checks in 24h (expected ~3,700)"
  dn="$(num_or0 '.db.monitor_checks_24h_by_status.down')"; [ "$dn" = "0" ] || emit "YELLOW $dn sub-threshold down check(s) in 24h"

  # --- integrations: status, freshness, errors
  for k in calendar_connections mail_connections health_connections; do
    bad="$(num_or0 "[.db.$k[] | select(.status != \"active\" and .status != \"disconnected\")] | length")"
    [ "$bad" = "0" ] || emit "RED $bad $k in needs_reauth/revoked"
    he="$(num_or0 "[.db.$k[] | select(.has_error == true)] | length")"
    [ "$he" = "0" ] || emit "YELLOW $he $k carry a last_sync_error"
  done
  fresh() { # $1 label, $2 jq path, $3 max hours
    local t; t="$(j "$2")"
    if [ -z "$t" ]; then emit "RED $1: no last-success timestamp"; return; fi
    local h=$(( (now_s - $(iso2s "$t")) / 3600 ))
    [ "$h" -le "$3" ] || emit "RED $1 last success ${h}h ago (>$3h)"
  }
  fresh "calendar sync" '.db.calendar_last_success_at' 3
  fresh "mail sync" '.db.mail_last_success_at' 3
  fresh "health sync" '.db.health_last_success_at' 6
  hf="$(num_or0 '.db.health_sync_runs_since_start_by_status.failed')"; phf="$(pnum_or0 '.db.health_sync_runs_since_start_by_status.failed')"
  [ "$hf" -le "$phf" ] || emit "YELLOW $((hf - phf)) new failed health sync run(s)"
  mf="$(num_or0 '.db.mail_sync_runs_since_start_by_status.failed')"; pmf="$(pnum_or0 '.db.mail_sync_runs_since_start_by_status.failed')"
  [ "$mf" -le "$pmf" ] || emit "YELLOW $((mf - pmf)) new failed mail sync run(s)"
  ce="$(num_or0 '.db.mail_cursor_expired_since_start')"; pce="$(pnum_or0 '.db.mail_cursor_expired_since_start')"
  [ "$ce" -le "$pce" ] || emit "YELLOW $((ce - pce)) mail cursor expiry(ies) since previous observation (designed recovery path)"
  hb="$(b '.db.health_streams_enabled')"; hn="$(num_or0 '.db.health_streams_enabled')"
  if [ -n "$hb" ] && [ "$hn" -lt "$hb" ]; then emit "RED health_streams_enabled $hn < baseline $hb (a stream was disabled by breaker/scope)"; fi

  # --- capture pipeline
  cf="$(num_or0 '.db.w_captures_failed')"; pcf="$(pnum_or0 '.db.w_captures_failed')"
  if [ "$cf" -gt "$pcf" ]; then emit "RED $((cf - pcf)) new capture(s) in status=failed"
  elif [ "$cf" -gt 0 ]; then emit "INFO standing failed captures since start: $cf"; fi
  [ "$(num_or0 '.db.w_captures_pending_stale')" = "0" ] || emit "RED $(j '.db.w_captures_pending_stale') capture(s) pending >15 min (never enqueued or parse never ran)"

  # --- notifications / devices
  df="$(num_or0 '.db.notification_dispatch_failed_since_start')"; pdf="$(pnum_or0 '.db.notification_dispatch_failed_since_start')"
  if [ "$df" -gt "$pdf" ]; then emit "RED $((df - pdf)) new failed push dispatch(es) (dead token?)"
  elif [ "$df" -gt 0 ]; then emit "INFO standing failed push dispatches since start: $df"; fi
  [ "$(num_or0 '.db.devices_primary_active')" = "1" ] || emit "RED devices_primary_active=$(j '.db.devices_primary_active') (reminders schedule nowhere)"
  [ "$(num_or0 '.db.devices_primary_reminder_eligible')" = "1" ] || emit "RED primary device is not reminder-eligible (notifications disabled or revoked)"
  [ "$(num_or0 '.db.devices_active_with_push_token')" -ge 1 ] || emit "RED no active device holds a push token"
  da="$(j '.db.devices_active')"; bda="$(b '.db.devices_active')"
  if [ -n "$bda" ] && [ "$da" != "$bda" ]; then emit "YELLOW active device count $da != baseline $bda (re-pair? primary may be stranded)"; fi
  na="$(num_or0 '.db.notification_dispatch_since_start_by_prefix_status | map(select(.prefix != "confirmation" and .prefix != "mail-digest" and .prefix != "test")) | map(.n) | add')"
  pna="$(pnum_or0 '.db.notification_dispatch_since_start_by_prefix_status | map(select(.prefix != "confirmation" and .prefix != "mail-digest" and .prefix != "test")) | map(.n) | add')"
  [ "$na" -le "$pna" ] || emit "YELLOW $((na - pna)) new alert-class push(es) since previous observation: $(j '[.db.notification_dispatch_since_start_by_prefix_status[] | select(.prefix != "confirmation" and .prefix != "mail-digest" and .prefix != "test") | .prefix] | unique | tostring')"

  # --- log-level noise (informational)
  ae="$(num_or0 '.host.api_log.error_lines')"; pae="$(pnum_or0 '.host.api_log.error_lines')"
  [ "$ae" -le "$pae" ] || emit "YELLOW $((ae - pae)) new api error-level log line(s)"
  we="$(num_or0 '.host.worker_log.error_lines')"; pwe="$(pnum_or0 '.host.worker_log.error_lines')"
  [ "$we" -le "$pwe" ] || emit "YELLOW $((we - pwe)) new worker error-level log line(s)"
  pe="$(num_or0 '.host.worker_log.pgboss_error_lines')"; ppe="$(pnum_or0 '.host.worker_log.pgboss_error_lines')"
  [ "$pe" -le "$ppe" ] || emit "YELLOW $((pe - ppe)) new worker.pgboss.error line(s)"

  [ "$fired" = "1" ] || echo "GREEN"
  exit $(( red == 1 ? 3 : 0 ))
fi

# ------------------------------------------------------------- observe modes
case "$MODE" in baseline|observe|final) ;; *) echo "unknown mode: $MODE" >&2; exit 2;; esac
started_local="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

fail_line() {
  # Record a failed observation so a gap is visible rather than silent. The
  # reason is a short operator string (ssh/psql/docker diagnostics), never data.
  jq -cn --arg at "$started_local" --arg mode "$MODE" --arg err "$(printf '%s' "$1" | head -c 300)" \
    '{observed_at:$at, mode:$mode, ok:false, error:$err}' | tee -a "$OBS_FILE"
  exit 1
}

if [ "$MODE" = "baseline" ]; then
  SOAK_START="now"
elif [ "$SOAK_START" = "__SOAK_START_UNSET__" ]; then
  # Default from the baseline the script itself wrote, so an unattended run
  # never depends on the value surviving in the scheduler's environment.
  SOAK_START="$(jq -r '.db.soak_start // empty' "$SOAK_OBS_DIR/baseline.json" 2>/dev/null || true)"
  [ -n "$SOAK_START" ] || fail_line "SOAK_START unset and no baseline.json in $SOAK_OBS_DIR"
fi

# ServerAlive* so a tailnet drop after the handshake fails within ~60 s and is
# recorded, instead of blocking on a dead socket for hours.
SSH=(ssh -o ConnectTimeout=25 -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$SOAK_SSH_HOST")

# 1) database: one statement, counts only.
if ! db_json="$("${SSH[@]}" "docker exec -i personal-os-postgres-1 psql -U postgres -d personalos -X -q -tA -v ON_ERROR_STOP=1 -v soak_start='$SOAK_START' -v tz='$SOAK_TZ' -f -" < "$SQL_FILE" 2>&1)"; then
  fail_line "db query failed: $(printf '%s' "$db_json" | head -c 300 | tr '\n' ' ')"
fi
jq -e . >/dev/null 2>&1 <<<"$db_json" || fail_line "db output not JSON: $(printf '%s' "$db_json" | head -c 200 | tr '\n' ' ')"

# 2) host: containers, /health, log COUNTS. Never prints a log line.
if ! host_kv="$("${SSH[@]}" bash -s 2>&1 <<'REMOTE'
set -u
for c in api worker web postgres; do
  n="personal-os-$c-1"
  echo "c_${c}_restarts=$(docker inspect -f '{{.RestartCount}}' "$n" 2>/dev/null || echo '?')"
  echo "c_${c}_started=$(docker inspect -f '{{.State.StartedAt}}' "$n" 2>/dev/null || echo '?')"
  echo "c_${c}_status=$(docker inspect -f '{{.State.Status}}' "$n" 2>/dev/null || echo '?')"
  echo "c_${c}_health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$n" 2>/dev/null || echo '?')"
  echo "c_${c}_image=$(docker inspect -f '{{.Image}}' "$n" 2>/dev/null | cut -c8-19 || echo '?')"
  echo "c_${c}_workdir=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$n" 2>/dev/null || echo '?')"
done
echo "health_json=$(curl -s -m 10 http://localhost:3000/health || echo '{}')"
A="$(docker logs personal-os-api-1 2>&1)"
cnt() { printf '%s' "$A" | grep -c -- "$1" || true; }
echo "api_lines=$(printf '%s' "$A" | grep -c '' || true)"
echo "api_error_lines=$(cnt '"level":50')"
echo "api_warn_lines=$(cnt '"level":40')"
echo "api_search=$(cnt '"url":"/search')"
echo "api_export=$(cnt '"url":"/export')"
echo "api_ask_answered=$(cnt '"task":"ask"')"
echo "api_ask_failed=$(cnt 'ask.failed')"
echo "api_briefs_post=$(cnt '"method":"POST","url":"/briefs"')"
echo "api_briefs_get=$(cnt '"url":"/briefs/current')"
echo "api_today_get=$(cnt '"url":"/today')"
echo "api_agenda_get=$(cnt '"url":"/agenda')"
echo "api_capture_post=$(cnt '"method":"POST","url":"/capture"')"
echo "api_transcribe_post=$(cnt '"method":"POST","url":"/transcribe"')"
echo "api_tasks_post=$(cnt '"method":"POST","url":"/tasks"')"
echo "api_tasks_patch=$(cnt '"method":"PATCH","url":"/tasks/')"
echo "api_tasks_complete_post=$(cnt '"url":"/tasks/[^"]*/complete"')"
echo "api_notes_post=$(cnt '"method":"POST","url":"/notes"')"
echo "api_events_post=$(cnt '"method":"POST","url":"/events"')"
echo "api_events_patch=$(cnt '"method":"PATCH","url":"/events/')"
echo "api_events_range_get=$(cnt '"url":"/events/range')"
echo "api_events_cancel_occurrence_post=$(cnt '/cancel-occurrence"')"
echo "api_events_detach_post=$(cnt '/detach"')"
echo "api_occurrences_post=$(cnt '"method":"POST","url":"/occurrences/')"
echo "api_inbox_confirm_post=$(cnt '/confirm"')"
echo "api_reviews_post=$(cnt '"method":"POST","url":"/reviews')"
echo "api_projects_post=$(cnt '"method":"POST","url":"/projects"')"
W="$(docker logs personal-os-worker-1 2>&1)"
wcnt() { printf '%s' "$W" | grep -c -- "$1" || true; }
echo "worker_lines=$(printf '%s' "$W" | grep -c '' || true)"
echo "worker_error_lines=$(wcnt '"level":"error"')"
echo "worker_warn_lines=$(wcnt '"level":"warn"')"
echo "worker_pgboss_error_lines=$(wcnt 'worker.pgboss.error')"
echo "worker_capture_dead=$(wcnt 'capture.parse.dead_lettered')"
echo "worker_capture_failed=$(wcnt 'capture.parse.failed')"
echo "worker_occ_dead=$(wcnt 'dead_lettered')"
echo "worker_monitor_incident=$(wcnt 'monitor.incident')"
echo "worker_ai_usage=$(wcnt 'ai.usage')"
R="$(printf '%s' "$W" | grep -- 'retention.cleanup.completed' | tail -n 1 || true)"
echo "retention_last_ts=$(printf '%s' "$R" | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')"
echo "retention_last_tables_ok=$(printf '%s' "$R" | sed -n 's/.*"tablesOk":\([0-9]*\).*/\1/p')"
echo "retention_last_tables_failed=$(printf '%s' "$R" | sed -n 's/.*"tablesFailed":\([0-9]*\).*/\1/p')"
echo "retention_last_total_deleted=$(printf '%s' "$R" | sed -n 's/.*"totalDeleted":\([0-9]*\).*/\1/p')"
REMOTE
)"; then
  fail_line "host inspection failed: $(printf '%s' "$host_kv" | head -c 300 | tr '\n' ' ')"
fi

kv() { printf '%s\n' "$host_kv" | sed -n "s/^$1=//p" | head -n 1; }
num() { v="$(kv "$1")"; case "$v" in ''|*[!0-9]*) echo null;; *) echo "$v";; esac; }
health_json="$(kv health_json)"; jq -e . >/dev/null 2>&1 <<<"$health_json" || health_json='{}'

host_json="$(jq -cn \
  --argjson health "$health_json" \
  --arg api_r "$(kv c_api_restarts)" --arg api_s "$(kv c_api_started)" --arg api_st "$(kv c_api_status)" --arg api_h "$(kv c_api_health)" --arg api_i "$(kv c_api_image)" --arg api_w "$(kv c_api_workdir)" \
  --arg wk_r "$(kv c_worker_restarts)" --arg wk_s "$(kv c_worker_started)" --arg wk_st "$(kv c_worker_status)" --arg wk_h "$(kv c_worker_health)" --arg wk_i "$(kv c_worker_image)" --arg wk_w "$(kv c_worker_workdir)" \
  --arg web_r "$(kv c_web_restarts)" --arg web_s "$(kv c_web_started)" --arg web_st "$(kv c_web_status)" --arg web_h "$(kv c_web_health)" --arg web_i "$(kv c_web_image)" --arg web_w "$(kv c_web_workdir)" \
  --arg pg_r "$(kv c_postgres_restarts)" --arg pg_s "$(kv c_postgres_started)" --arg pg_st "$(kv c_postgres_status)" --arg pg_h "$(kv c_postgres_health)" --arg pg_i "$(kv c_postgres_image)" \
  --argjson api_lines "$(num api_lines)" --argjson api_err "$(num api_error_lines)" --argjson api_warn "$(num api_warn_lines)" \
  --argjson search "$(num api_search)" --argjson export "$(num api_export)" --argjson ask_ok "$(num api_ask_answered)" --argjson ask_fail "$(num api_ask_failed)" \
  --argjson briefs_post "$(num api_briefs_post)" --argjson briefs_get "$(num api_briefs_get)" --argjson today "$(num api_today_get)" --argjson agenda "$(num api_agenda_get)" \
  --argjson capture "$(num api_capture_post)" --argjson transcribe "$(num api_transcribe_post)" --argjson tasks_post "$(num api_tasks_post)" --argjson tasks_patch "$(num api_tasks_patch)" --argjson tasks_complete "$(num api_tasks_complete_post)" \
  --argjson notes_post "$(num api_notes_post)" --argjson events_post "$(num api_events_post)" --argjson events_patch "$(num api_events_patch)" --argjson events_range "$(num api_events_range_get)" \
  --argjson events_cancel_occ "$(num api_events_cancel_occurrence_post)" --argjson events_detach "$(num api_events_detach_post)" \
  --argjson occ_post "$(num api_occurrences_post)" --argjson confirm "$(num api_inbox_confirm_post)" --argjson reviews_post "$(num api_reviews_post)" --argjson projects_post "$(num api_projects_post)" \
  --argjson w_lines "$(num worker_lines)" --argjson w_err "$(num worker_error_lines)" --argjson w_warn "$(num worker_warn_lines)" --argjson w_pgerr "$(num worker_pgboss_error_lines)" \
  --argjson w_cdead "$(num worker_capture_dead)" --argjson w_cfail "$(num worker_capture_failed)" --argjson w_dead "$(num worker_occ_dead)" --argjson w_inc "$(num worker_monitor_incident)" --argjson w_ai "$(num worker_ai_usage)" \
  --arg r_ts "$(kv retention_last_ts)" --argjson r_ok "$(num retention_last_tables_ok)" --argjson r_fail "$(num retention_last_tables_failed)" --argjson r_del "$(num retention_last_total_deleted)" \
  '{
    health: $health,
    containers: {
      api:      {restarts: ($api_r|tonumber? // $api_r), started_at: $api_s, status: $api_st, health: $api_h, image12: $api_i, workdir: $api_w},
      worker:   {restarts: ($wk_r|tonumber? // $wk_r),  started_at: $wk_s,  status: $wk_st,  health: $wk_h,  image12: $wk_i,  workdir: $wk_w},
      web:      {restarts: ($web_r|tonumber? // $web_r), started_at: $web_s, status: $web_st, health: $web_h, image12: $web_i, workdir: $web_w},
      postgres: {restarts: ($pg_r|tonumber? // $pg_r),  started_at: $pg_s,  status: $pg_st,  health: $pg_h,  image12: $pg_i}
    },
    api_log: {epoch_started_at: $api_s, lines: $api_lines, error_lines: $api_err, warn_lines: $api_warn,
      search: $search, export: $export, ask_answered: $ask_ok, ask_failed: $ask_fail,
      briefs_post: $briefs_post, briefs_current_get: $briefs_get, today_get: $today, agenda_get: $agenda,
      capture_post: $capture, transcribe_post: $transcribe, tasks_post: $tasks_post, tasks_patch: $tasks_patch, tasks_complete_post: $tasks_complete,
      notes_post: $notes_post, events_post: $events_post, events_patch: $events_patch, events_range_get: $events_range,
      events_cancel_occurrence_post: $events_cancel_occ, events_detach_post: $events_detach,
      occurrences_post: $occ_post, inbox_confirm_post: $confirm, reviews_post: $reviews_post, projects_post: $projects_post},
    worker_log: {epoch_started_at: $wk_s, lines: $w_lines, error_lines: $w_err, warn_lines: $w_warn, pgboss_error_lines: $w_pgerr,
      capture_dead_lettered: $w_cdead, capture_failed: $w_cfail, dead_lettered_any: $w_dead, monitor_incident_lines: $w_inc, ai_usage_lines: $w_ai,
      retention_last_ts: ($r_ts | if . == "" then null else . end), retention_last_tables_ok: $r_ok, retention_last_tables_failed: $r_fail, retention_last_total_deleted: $r_del}
  }')"

line="$(jq -cn --argjson db "$db_json" --argjson host "$host_json" --arg mode "$MODE" --arg at "$started_local" \
  '{observed_at: $db.observed_at, run_started_at: $at, mode: $mode, ok: true, db: $db, host: $host}')"

printf '%s\n' "$line" >> "$OBS_FILE"
case "$MODE" in
  baseline) jq . <<<"$line" > "$SOAK_OBS_DIR/baseline.json";;
  final)    jq . <<<"$line" > "$SOAK_OBS_DIR/final.json";;
esac
printf '%s\n' "$line"
