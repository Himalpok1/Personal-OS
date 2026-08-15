#!/usr/bin/env bash
# Runs once, automatically, on first init of an empty Postgres data
# directory (docker-entrypoint-initdb.d convention). Creates the two
# roles the architecture requires: a DDL-rights migrator role and a
# least-privilege runtime role. Grants here cover the `public` schema
# only — the pg-boss `pgboss` schema doesn't exist yet at this point (it's
# created later by `pg-boss migrate` run as posops_migrator); its runtime
# grants for posops_app live in scripts/grant-pgboss-runtime.sql, run once
# after that migration.
set -euo pipefail

: "${POSTGRES_MIGRATOR_PASSWORD:?POSTGRES_MIGRATOR_PASSWORD must be set}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE posops_migrator LOGIN PASSWORD '${POSTGRES_MIGRATOR_PASSWORD}';
  GRANT ALL PRIVILEGES ON DATABASE "$POSTGRES_DB" TO posops_migrator;
  GRANT ALL ON SCHEMA public TO posops_migrator;

  CREATE ROLE posops_app LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO posops_app;
  GRANT USAGE ON SCHEMA public TO posops_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO posops_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO posops_app;

  -- Tables the migrator creates later (Phase 1+) are automatically
  -- readable/writable by the app role without a follow-up grant.
  ALTER DEFAULT PRIVILEGES FOR ROLE posops_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO posops_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE posops_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO posops_app;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
