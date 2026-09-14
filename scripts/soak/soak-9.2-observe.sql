-- scripts/soak/soak-9.2-observe.sql
--
-- Checkpoint 9.2 adoption-soak observation query. READ-ONLY.
--
-- PRIVACY CONTRACT: this statement returns COUNTS, DATES, TIMESTAMPS, STATUS
-- TOKENS and 8-character id prefixes ONLY. It never selects raw_text, title,
-- body, subject, address, display name, prompt, answer, health value, error
-- message or any other free-text column. Adding such a column is a contract
-- violation, not an enhancement.
--
-- DEFINITIONS ARE FROZEN AT SOAK START (2026-09-13). The same statement is run
-- for the baseline, every daily observation and the Day-21 final snapshot, so
-- the numbers are comparable by construction. Do not edit metric definitions
-- mid-soak; if a definition is found wrong, record it in docs/SOAK-9.2.md and
-- add a NEW field rather than changing an existing one.
--
-- Variables (psql -v): soak_start = timestamptz literal (the baseline run
-- passes 'now'); tz = IANA zone used for calendar-day attribution.
--
-- Run only through scripts/soak/soak-9.2-observe.sh.

\set ON_ERROR_STOP on

select (jsonb_build_object(
  'observed_at', now(),
  'soak_start', (:'soak_start')::timestamptz,
  'tz', :'tz',

  -- ---------------------------------------------------------------- system
  'migration_count', (select count(*) from drizzle.__drizzle_migrations),
  'worker_heartbeat_status', (select status from worker_heartbeat where id = 1),
  'worker_heartbeat_age_s', (select extract(epoch from (now() - last_beat_at))::int from worker_heartbeat where id = 1),

  -- --------------------------------------------------------------- pg-boss
  -- pg-boss retains job rows for 14 days and deletes them 7 days later, so
  -- these are only meaningful when observed daily; the durable failure record
  -- is inbox_items.status='failed' and notification_dispatch_log.
  'pgboss_jobs_by_state', (select coalesce(json_object_agg(state, n), '{}'::json)
                           from (select state, count(*) n from pgboss.job group by state) s),
  'pgboss_failed_since_start_by_queue', (select coalesce(json_object_agg(name, n), '{}'::json)
                           from (select name, count(*) n from pgboss.job
                                 where state = 'failed' and created_on >= (:'soak_start')::timestamptz
                                 group by name) s),
  'pgboss_retry_now_by_queue', (select coalesce(json_object_agg(name, n), '{}'::json)
                           from (select name, count(*) n from pgboss.job where state = 'retry' group by name) s),
  'pgboss_stale_created', (select count(*) from pgboss.job
                           where state = 'created' and start_after < now() - interval '30 minutes'),
  'pgboss_active_long', (select count(*) from pgboss.job
                           where state = 'active' and started_on < now() - interval '30 minutes'),
  'pgboss_schedule_count', (select count(*) from pgboss.schedule),
  -- pg-boss's own durable history (completed rows live ~7 days), independent
  -- of the worker log epoch: last completion of each nightly/daily cron.
  'pgboss_cron_last_completed', (select coalesce(json_object_agg(name, t), '{}'::json)
                           from (select name, max(completed_on) t from pgboss.job
                                 where state = 'completed'
                                   and name in ('retention.cleanup','occurrences.expand-window','mail.digest.cron','audio.sweep-orphan')
                                 group by name) s),
  'pgboss_dead_letter_since_start_by_queue', (select coalesce(json_object_agg(name, n), '{}'::json)
                           from (select name, count(*) n from pgboss.job
                                 where name like '%.dead' and created_on >= (:'soak_start')::timestamptz
                                 group by name) s),

  -- ------------------------------------------------------------ monitoring
  'monitor_targets_active', (select count(*) from monitor_targets where enabled and archived_at is null),
  'monitor_incidents_total', (select count(*) from monitor_incidents),
  'monitor_incidents_open', (select count(*) from monitor_incidents where status <> 'resolved'),
  'monitor_incidents_since_start', (select count(*) from monitor_incidents
                                    where opened_at >= (:'soak_start')::timestamptz),
  'monitor_checks_since_start_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                           from (select status, count(*) n from monitor_checks
                                 where checked_at >= (:'soak_start')::timestamptz group by status) s),
  'monitor_checks_24h_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                           from (select status, count(*) n from monitor_checks
                                 where checked_at >= now() - interval '24 hours' group by status) s)
) || jsonb_build_object(

  -- ---------------------------------------------------------- integrations
  'calendar_connections', (select coalesce(json_agg(json_build_object(
                             'id8', left(id::text, 8), 'provider', provider, 'status', status,
                             'has_error', last_sync_error is not null) order by created_at), '[]'::json)
                           from calendar_connections),
  'calendar_calendars_total', (select count(*) from calendar_connection_calendars),
  'calendar_calendars_enabled', (select count(*) from calendar_connection_calendars where sync_enabled),
  'calendar_last_success_at', (select max(last_successful_sync_at) from calendar_connection_calendars where sync_enabled),
  'mail_connections', (select coalesce(json_agg(json_build_object(
                             'id8', left(id::text, 8), 'provider', provider, 'status', status,
                             'has_error', last_sync_error is not null,
                             'last_sync_error_at', last_sync_error_at) order by created_at), '[]'::json)
                           from mail_connections),
  'mail_cursor_needs_full_resync', (select coalesce(bool_or(needs_full_resync), false) from mail_sync_cursors),
  'mail_last_success_at', (select max(last_successful_sync_at) from mail_sync_cursors),
  'mail_sync_runs_since_start_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                           from (select status, count(*) n from mail_sync_runs
                                 where started_at >= (:'soak_start')::timestamptz group by status) s),
  'mail_cursor_expired_since_start', (select count(*) from mail_sync_runs
                           where cursor_expired and started_at >= (:'soak_start')::timestamptz),
  'mail_messages_total', (select count(*) from mail_messages),
  'mail_digests_total', (select count(*) from mail_digests),
  'mail_digests_latest_date', (select max(digest_date) from mail_digests),
  'health_connections', (select coalesce(json_agg(json_build_object(
                             'id8', left(id::text, 8), 'provider', provider, 'status', status,
                             'has_error', last_sync_error is not null,
                             'last_sync_error_at', last_sync_error_at) order by created_at), '[]'::json)
                           from health_connections),
  'health_streams_total', (select count(*) from health_metric_streams),
  'health_streams_enabled', (select count(*) from health_metric_streams where sync_enabled),
  'health_last_success_at', (select max(last_successful_sync_at) from health_metric_streams where sync_enabled),
  'health_sync_runs_since_start_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                           from (select status, count(*) n from health_sync_runs
                                 where started_at >= (:'soak_start')::timestamptz group by status) s),
  'health_daily_metric_rows', (select count(*) from health_daily_metrics),
  'health_daily_metric_rows_with_data', (select count(*) from health_daily_metrics where has_data),
  'health_sessions_total', (select count(*) from health_sessions),

  -- --------------------------------------------------------- notifications
  -- The dedupe key is UNVALIDATED job data (a plain TS interface, no Zod), so
  -- the first segment is allowlisted to the known producer constants and
  -- everything else collapses to 'other'. The discriminator after the first
  -- ':' is never selected.
  'notification_dispatch_by_prefix_status', (select coalesce(json_agg(json_build_object(
                             'prefix', p, 'status', status, 'n', n) order by p, status), '[]'::json)
                           from (select case when split_part(dedupe_key, ':', 1) in
                                          ('confirmation','mail-digest','health-sync-alert','calendar-needs-reauth',
                                           'mail-needs-reauth','monitor','occurrences.generate-lazy.dead',
                                           'occurrences.expand-window.dead','alert','test')
                                        then split_part(dedupe_key, ':', 1) else 'other' end p, status, count(*) n
                                 from notification_dispatch_log group by 1, 2) s),
  'notification_dispatch_since_start_by_prefix_status', (select coalesce(json_agg(json_build_object(
                             'prefix', p, 'status', status, 'n', n) order by p, status), '[]'::json)
                           from (select case when split_part(dedupe_key, ':', 1) in
                                          ('confirmation','mail-digest','health-sync-alert','calendar-needs-reauth',
                                           'mail-needs-reauth','monitor','occurrences.generate-lazy.dead',
                                           'occurrences.expand-window.dead','alert','test')
                                        then split_part(dedupe_key, ':', 1) else 'other' end p, status, count(*) n
                                 from notification_dispatch_log
                                 where attempted_at >= (:'soak_start')::timestamptz group by 1, 2) s),
  'notification_dispatch_failed_since_start', (select count(*) from notification_dispatch_log
                           where status = 'failed' and attempted_at >= (:'soak_start')::timestamptz),

  -- --------------------------------------------------------------- devices
  'devices_total', (select count(*) from devices),
  'devices_active', (select count(*) from devices where revoked_at is null),
  'devices_primary_active', (select count(*) from devices where is_primary_reminder_device and revoked_at is null),
  'devices_active_with_push_token', (select count(*) from devices where revoked_at is null and push_token is not null),
  'devices_primary_reminder_eligible', (select count(*) from devices
                                        where is_primary_reminder_device and revoked_at is null and notifications_enabled),
  'devices_active_notifications_enabled', (select count(*) from devices where revoked_at is null and notifications_enabled),
  'device_primary_last_seen_at', (select max(last_seen_at) from devices where is_primary_reminder_device and revoked_at is null),

  -- ------------------------------------------------------------ AI routing
  'ai_task_routes', (select coalesce(json_agg(task_name order by task_name)
                              filter (where task_name in ('capture_parser','daily_brief','mail_digest','voice_transcribe','ask')),
                            '[]'::json) from ai_task_routes),
  'ai_task_routes_other', (select count(*) from ai_task_routes
                           where task_name not in ('capture_parser','daily_brief','mail_digest','voice_transcribe','ask')),
  'ask_route_present', (select exists(select 1 from ai_task_routes where task_name = 'ask')),
  'briefs_total', (select count(*) from ai_daily_briefs),
  'briefs_latest_date', (select max(brief_date) from ai_daily_briefs),
  'briefs_last_generated_at', (select max(generated_at) from ai_daily_briefs)
) || jsonb_build_object(

  -- --------------------------------------------------- content totals (all time)
  'inbox_total', (select count(*) from inbox_items),
  'inbox_by_source', (select coalesce(json_object_agg(source, n), '{}'::json)
                      from (select source, count(*) n from inbox_items group by source) s),
  'inbox_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                      from (select status, count(*) n from inbox_items group by status) s),
  'inbox_by_entity_type', (select coalesce(json_object_agg(coalesce(entity_type, 'none'), n), '{}'::json)
                      from (select entity_type, count(*) n from inbox_items group by entity_type) s),
  'inbox_audio_retained', (select count(*) from inbox_items where audio_path is not null),
  'tasks_total', (select count(*) from tasks),
  'tasks_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                      from (select status, count(*) n from tasks group by status) s),
  'tasks_archived', (select count(*) from tasks where archived_at is not null),
  'tasks_open_unarchived', (select count(*) from tasks where status in ('inbox','active') and archived_at is null),
  'tasks_recurring', (select count(*) from tasks where rrule is not null),
  'tasks_with_remind_at', (select count(*) from tasks where remind_at is not null),
  'tasks_live_future_reminders', (select count(*) from tasks
                                  where remind_at > now() and status in ('inbox','active') and archived_at is null),
  'notes_total', (select count(*) from notes),
  'notes_archived', (select count(*) from notes where archived_at is not null),
  'projects_total', (select count(*) from projects),
  'projects_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                      from (select status, count(*) n from projects group by status) s),
  'events_total', (select count(*) from events),
  'events_archived', (select count(*) from events where archived_at is not null),
  'events_linked', (select count(*) from events e where exists (select 1 from event_external_links l where l.event_id = e.id)),
  -- Self-check for the local-vs-ingested discriminator (see docs/SOAK-9.2.md):
  -- sync inserts an event and its link (or, for a detached instance, its
  -- calendar_event_instances row) in ONE transaction (identical created_at);
  -- local authoring links through a separate request (later) or not at all.
  -- Upstream removal DELETES the link/instance pointer but stamps ONLY
  -- events.archived_at (updated_at stays older), whereas every local archive
  -- route stamps archived_at = updated_at -- so the signature
  -- `archived_at is not null and updated_at < archived_at` marks an ingested
  -- event whose link is gone, and instance rows are matched by occurrence slot
  -- rather than by the child pointer the cancel path nulls out.
  'events_link_same_instant', (select count(*) from events e join event_external_links l on l.event_id = e.id
                               where l.created_at = e.created_at),
  'events_link_later', (select count(*) from events e join event_external_links l on l.event_id = e.id
                               where l.created_at > e.created_at),
  'occurrences_total', (select count(*) from occurrences),
  'occurrences_by_type_status', (select coalesce(json_agg(json_build_object(
                             'parent_type', parent_type, 'status', status, 'n', n) order by parent_type, status), '[]'::json)
                           from (select parent_type, status, count(*) n from occurrences group by 1, 2) s),
  'reviews_total', (select count(*) from reviews),
  'reviews_by_kind_status', (select coalesce(json_agg(json_build_object(
                             'kind', kind, 'status', status, 'n', n) order by kind, status), '[]'::json)
                           from (select kind, status, count(*) n from reviews group by 1, 2) s)
) || jsonb_build_object(

  -- ---------------------------------------------- window metrics (>= soak_start)
  -- Window membership is server receipt time (created_at / completed_at);
  -- calendar-day attribution uses the owner's zone (:tz).
  'w_captures', (select count(*) from inbox_items where created_at >= (:'soak_start')::timestamptz),
  'w_captures_by_source', (select coalesce(json_object_agg(source, n), '{}'::json)
                      from (select source, count(*) n from inbox_items
                            where created_at >= (:'soak_start')::timestamptz group by source) s),
  'w_captures_by_status', (select coalesce(json_object_agg(status, n), '{}'::json)
                      from (select status, count(*) n from inbox_items
                            where created_at >= (:'soak_start')::timestamptz group by status) s),
  'w_captures_by_entity_type', (select coalesce(json_object_agg(coalesce(entity_type, 'none'), n), '{}'::json)
                      from (select entity_type, count(*) n from inbox_items
                            where created_at >= (:'soak_start')::timestamptz group by entity_type) s),
  'w_captures_parsed_success', (select count(*) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz
                        and status in ('parsed','confirmed') and entity_id is not null),
  'w_captures_failed', (select count(*) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz and status = 'failed'),
  'w_captures_needs_confirm', (select count(*) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz and status = 'needs_confirm'),
  'w_captures_pending', (select count(*) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz and status = 'pending'),
  -- A capture the API stored but never enqueued (pg-boss unavailable at the
  -- API) stays pending forever with no job, no failure and no dead letter.
  'w_captures_pending_stale', (select count(*) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz and status = 'pending'
                        and created_at < now() - interval '15 minutes'),
  'w_capture_days', (select count(distinct (captured_at at time zone :'tz')::date) from inbox_items
                      where created_at >= (:'soak_start')::timestamptz),
  'w_tasks_created', (select count(*) from tasks where created_at >= (:'soak_start')::timestamptz),
  'w_tasks_created_via_capture', (select count(*) from tasks t
                      where t.created_at >= (:'soak_start')::timestamptz
                        and exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)),
  'w_tasks_created_direct', (select count(*) from tasks t
                      where t.created_at >= (:'soak_start')::timestamptz
                        and not exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)),
  'w_tasks_completed', (select count(*) from tasks
                      where status = 'done' and completed_at >= (:'soak_start')::timestamptz),
  'w_tasks_completed_of_window_created', (select count(*) from tasks
                      where status = 'done' and completed_at >= (:'soak_start')::timestamptz
                        and created_at >= (:'soak_start')::timestamptz),
  -- tasks has no drop timestamp; updated_at is bumped by every later edit, so
  -- only the window-created population is exactly derivable.
  'w_tasks_dropped_of_window_created', (select count(*) from tasks
                      where status = 'dropped' and created_at >= (:'soak_start')::timestamptz),
  'w_tasks_archived', (select count(*) from tasks where archived_at >= (:'soak_start')::timestamptz),
  'w_task_occurrences_done', (select count(*) from occurrences
                      where parent_type = 'task' and status = 'done' and completed_at >= (:'soak_start')::timestamptz),
  'w_task_occurrences_skipped', (select count(*) from occurrences
                      where parent_type = 'task' and status = 'skipped' and completed_at >= (:'soak_start')::timestamptz),
  'w_task_activity_days', (select count(distinct d) from (
                      select (created_at at time zone :'tz')::date d from tasks t
                       where created_at >= (:'soak_start')::timestamptz
                         and not exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)
                      union
                      select (completed_at at time zone :'tz')::date from tasks
                       where status = 'done' and completed_at >= (:'soak_start')::timestamptz
                      union
                      select (completed_at at time zone :'tz')::date from occurrences
                       where parent_type = 'task' and status in ('done','skipped')
                         and completed_at >= (:'soak_start')::timestamptz) x)
) || jsonb_build_object(

  'w_notes_created', (select count(*) from notes where created_at >= (:'soak_start')::timestamptz),
  'w_notes_created_via_capture', (select count(*) from notes n
                      where n.created_at >= (:'soak_start')::timestamptz
                        and exists (select 1 from inbox_items i where i.entity_type = 'note' and i.entity_id = n.id)),
  'w_notes_created_direct', (select count(*) from notes n
                      where n.created_at >= (:'soak_start')::timestamptz
                        and not exists (select 1 from inbox_items i where i.entity_type = 'note' and i.entity_id = n.id)),
  'w_note_days', (select count(distinct (created_at at time zone :'tz')::date) from notes
                      where created_at >= (:'soak_start')::timestamptz),
  'w_projects_created', (select count(*) from projects where created_at >= (:'soak_start')::timestamptz),
  'w_events_created_total', (select count(*) from events where created_at >= (:'soak_start')::timestamptz),
  'w_events_created_local', (select count(*) from events e
                      where e.created_at >= (:'soak_start')::timestamptz
                        and not exists (select 1 from event_external_links l
                                        where l.event_id = e.id and l.created_at = e.created_at)
                        and not exists (select 1 from calendar_event_instances ci
                                        where ci.local_parent_event_id = e.parent_event_id
                                          and ci.local_original_start_at = e.original_start_at
                                          and ci.created_at = e.created_at)
                        and not (e.archived_at is not null and e.updated_at < e.archived_at)),
  'w_events_created_ingested', (select count(*) from events e
                      where e.created_at >= (:'soak_start')::timestamptz
                        and (exists (select 1 from event_external_links l
                                     where l.event_id = e.id and l.created_at = e.created_at)
                          or exists (select 1 from calendar_event_instances ci
                                     where ci.local_parent_event_id = e.parent_event_id
                                       and ci.local_original_start_at = e.original_start_at
                                       and ci.created_at = e.created_at)
                          or (e.archived_at is not null and e.updated_at < e.archived_at))),
  'w_events_archived', (select count(*) from events where archived_at >= (:'soak_start')::timestamptz),
  'w_event_occurrences_done', (select count(*) from occurrences
                      where parent_type = 'event' and status = 'done' and completed_at >= (:'soak_start')::timestamptz),
  'w_event_occurrences_skipped', (select count(*) from occurrences
                      where parent_type = 'event' and status = 'skipped' and completed_at >= (:'soak_start')::timestamptz),
  'w_reviews_completed_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json)
                      from (select kind, count(*) n from reviews
                            where status = 'completed' and completed_at >= (:'soak_start')::timestamptz group by kind) s),
  'w_briefs_generated_rows', (select count(*) from ai_daily_briefs where generated_at >= (:'soak_start')::timestamptz),
  'w_mail_digests_generated_rows', (select count(*) from mail_digests where generated_at >= (:'soak_start')::timestamptz)
) || jsonb_build_object(

  -- ------------------------------------------------- active-day computation
  -- ACTIVE DAY (frozen): a calendar day in :tz with at least one durable
  -- product action of these kinds: capture · direct task creation · task
  -- completion (task or task occurrence done) · note creation · local
  -- calendar action (locally authored event, or event occurrence done/skipped)
  -- · review completion · project creation. Cloud Ask actions are log-only
  -- and are folded in by the observer from daily deltas, not here.
  -- w_daily_actions is the DESCRIPTIVE per-day breakdown: it additionally
  -- carries task_occurrence_skipped and note_created_direct (a note NOT
  -- committed from a capture), neither of which changes the active-day set.
  'w_active_days', (with acts as (
        select 'capture' k, (captured_at at time zone :'tz')::date d from inbox_items
         where created_at >= (:'soak_start')::timestamptz
        union all
        select 'task_created_direct', (created_at at time zone :'tz')::date from tasks t
         where created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)
        union all
        select 'task_completed', (completed_at at time zone :'tz')::date from tasks
         where status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'task_occurrence_done', (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'task' and status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'note_created', (created_at at time zone :'tz')::date from notes
         where created_at >= (:'soak_start')::timestamptz
        union all
        select 'event_local_created', (e.created_at at time zone :'tz')::date from events e
         where e.created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from event_external_links l where l.event_id = e.id and l.created_at = e.created_at)
           and not exists (select 1 from calendar_event_instances ci
                            where ci.local_parent_event_id = e.parent_event_id
                              and ci.local_original_start_at = e.original_start_at
                              and ci.created_at = e.created_at)
           and not (e.archived_at is not null and e.updated_at < e.archived_at)
        union all
        select 'event_occurrence_actioned', (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'event' and status in ('done','skipped') and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'review_completed', (completed_at at time zone :'tz')::date from reviews
         where status = 'completed' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'project_created', (created_at at time zone :'tz')::date from projects
         where created_at >= (:'soak_start')::timestamptz)
      select count(distinct d) from acts),
  -- Same set, restricted to Chicago dates on/after SOAK_START's local date
  -- (an offline-outbox capture made before the baseline but received after it
  -- attributes to a pre-window date and is excluded here).
  'w_active_days_in_window', (with acts as (
        select (captured_at at time zone :'tz')::date d from inbox_items
         where created_at >= (:'soak_start')::timestamptz
        union all
        select (created_at at time zone :'tz')::date from tasks t
         where created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)
        union all
        select (completed_at at time zone :'tz')::date from tasks
         where status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'task' and status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select (created_at at time zone :'tz')::date from notes
         where created_at >= (:'soak_start')::timestamptz
        union all
        select (e.created_at at time zone :'tz')::date from events e
         where e.created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from event_external_links l where l.event_id = e.id and l.created_at = e.created_at)
           and not exists (select 1 from calendar_event_instances ci
                            where ci.local_parent_event_id = e.parent_event_id
                              and ci.local_original_start_at = e.original_start_at
                              and ci.created_at = e.created_at)
           and not (e.archived_at is not null and e.updated_at < e.archived_at)
        union all
        select (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'event' and status in ('done','skipped') and completed_at >= (:'soak_start')::timestamptz
        union all
        select (completed_at at time zone :'tz')::date from reviews
         where status = 'completed' and completed_at >= (:'soak_start')::timestamptz
        union all
        select (created_at at time zone :'tz')::date from projects
         where created_at >= (:'soak_start')::timestamptz)
      select count(distinct d) from acts
       where d >= ((:'soak_start')::timestamptz at time zone :'tz')::date),
  'w_daily_actions', (with acts as (
        select 'capture' k, (captured_at at time zone :'tz')::date d from inbox_items
         where created_at >= (:'soak_start')::timestamptz
        union all
        select 'task_created_direct', (created_at at time zone :'tz')::date from tasks t
         where created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from inbox_items i where i.entity_type = 'task' and i.entity_id = t.id)
        union all
        select 'task_completed', (completed_at at time zone :'tz')::date from tasks
         where status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'task_occurrence_done', (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'task' and status = 'done' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'task_occurrence_skipped', (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'task' and status = 'skipped' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'note_created', (created_at at time zone :'tz')::date from notes
         where created_at >= (:'soak_start')::timestamptz
        union all
        select 'note_created_direct', (created_at at time zone :'tz')::date from notes n
         where created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from inbox_items i where i.entity_type = 'note' and i.entity_id = n.id)
        union all
        select 'event_local_created', (e.created_at at time zone :'tz')::date from events e
         where e.created_at >= (:'soak_start')::timestamptz
           and not exists (select 1 from event_external_links l where l.event_id = e.id and l.created_at = e.created_at)
           and not exists (select 1 from calendar_event_instances ci
                            where ci.local_parent_event_id = e.parent_event_id
                              and ci.local_original_start_at = e.original_start_at
                              and ci.created_at = e.created_at)
           and not (e.archived_at is not null and e.updated_at < e.archived_at)
        union all
        select 'event_occurrence_actioned', (completed_at at time zone :'tz')::date from occurrences
         where parent_type = 'event' and status in ('done','skipped') and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'review_completed', (completed_at at time zone :'tz')::date from reviews
         where status = 'completed' and completed_at >= (:'soak_start')::timestamptz
        union all
        select 'project_created', (created_at at time zone :'tz')::date from projects
         where created_at >= (:'soak_start')::timestamptz)
      select coalesce(json_agg(json_build_object('date', d, 'actions', a) order by d), '[]'::json)
        from (select d, json_object_agg(k, n) a
                from (select k, d, count(*) n from acts group by k, d) x
               group by d) y)
))::text;
