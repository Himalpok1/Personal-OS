-- One-time grant, run as posops_migrator immediately after `pg-boss migrate`
-- creates the `pgboss` schema. Gives posops_app exactly the DML rights
-- pg-boss needs to operate at runtime with `migrate: false` — no CREATE,
-- no other DDL. Safe to re-run (every statement is idempotent/additive).
GRANT USAGE ON SCHEMA pgboss TO posops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO posops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO posops_app;

-- Future pg-boss migrations (schema version bumps, run again as
-- posops_migrator) keep posops_app's runtime access without a repeat grant.
ALTER DEFAULT PRIVILEGES FOR ROLE posops_migrator IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO posops_app;
ALTER DEFAULT PRIVILEGES FOR ROLE posops_migrator IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO posops_app;
