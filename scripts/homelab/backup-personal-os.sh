#!/usr/bin/env bash
# scripts/homelab/backup-personal-os.sh — runs ON THE HOST (cron, daily). Checkpoint
# 10.8.5, ADR-080 (amends ADR-024's "no backup"): the minimal backup.
#
#   backup-personal-os.sh          take a backup, apply retention
#   backup-personal-os.sh --list   show what exists
#
# Writes under $BACKUP_DIR (default ~/personal-os-backups, mode 700):
#   db/personalos-<UTC>.dump       pg_dump -Fc (custom, compressed) of `personalos`
#   db/globals-<UTC>.sql           pg_dumpall --globals-only (the two app roles)
#   config/<UTC>/                  .env (0600), the serving release's compose files,
#                                  tailscale serve status, crontab, authorized_keys
#                                  (public keys), docker inventory (images/containers),
#                                  the migration watermark, release provenance
#   latest -> config/<UTC>         symlink to the newest bundle
# Every file gets a sha256 sidecar. Retention: newest $KEEP_DAYS (14) of each.
# The image tarballs live separately in ~/personal-os-images (save-release-images.sh).
# On-host copies protect against mistakes; the off-host copy is pull-backup.sh
# on the Mac (launchd, daily) — this disk is the same disk the data lives on.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-$HOME/personal-os-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG="personal-os-postgres-1"
ENV_FILE="$HOME/personal-os/.env"
umask 077
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/config"; chmod 700 "$BACKUP_DIR"

if [ "${1:-}" = "--list" ]; then
  echo "backups under $BACKUP_DIR (keep $KEEP_DAYS days):"; du -sh "$BACKUP_DIR" | cut -f1
  ls -la "$BACKUP_DIR/db" | grep -E '\.dump$|\.sql$' | awk '{print "  "$5"\t"$NF}'
  echo "config bundles:"; ls -1 "$BACKUP_DIR/config" | sed 's/^/  /'; exit 0
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"
sum() { sha256sum "$1" | cut -d' ' -f1 > "$1.sha256"; }

# --- database -----------------------------------------------------------------
dump="$BACKUP_DIR/db/personalos-$ts.dump"
docker exec "$PG" pg_dump -U postgres -Fc personalos > "$dump.partial"
mv "$dump.partial" "$dump"; sum "$dump"
docker exec "$PG" pg_dumpall -U postgres --globals-only > "$BACKUP_DIR/db/globals-$ts.sql"; sum "$BACKUP_DIR/db/globals-$ts.sql"
# a dump that pg_restore cannot even list is not a backup
docker exec -i "$PG" pg_restore --list < "$dump" > /dev/null

# --- config bundle ------------------------------------------------------------
c="$BACKUP_DIR/config/$ts"; mkdir -p "$c"
[ -f "$ENV_FILE" ] && { cp "$ENV_FILE" "$c/env"; chmod 600 "$c/env"; sum "$c/env"; }
rel="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' personal-os-api-1 2>/dev/null || true)"
{
  echo "taken_at=$ts"; echo "release_dir=$rel"
  for s in api worker web postgres; do
    echo "container_$s=$(docker inspect -f '{{.Image}} started={{.State.StartedAt}} workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' "personal-os-$s-1" 2>/dev/null)"
  done
  echo "migrations=$(docker exec "$PG" psql -U postgres -d personalos -Atc 'select count(*)||chr(32)||max(created_at) from drizzle.__drizzle_migrations' 2>/dev/null)"
} > "$c/release.txt"
for f in docker-compose.yml docker-compose.prod.yml; do [ -n "$rel" ] && [ -f "$rel/$f" ] && cp "$rel/$f" "$c/$f"; done
tailscale serve status > "$c/tailscale-serve.txt" 2>&1 || true
crontab -l > "$c/crontab.txt" 2>/dev/null || true
cp "$HOME/.ssh/authorized_keys" "$c/authorized_keys.txt" 2>/dev/null || true
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}} {{.Size}}' | sort > "$c/docker-images.txt"
docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' | sort > "$c/docker-containers.txt"
ls -1 "$HOME/personal-os-images" > "$c/image-store.txt" 2>/dev/null || true
ln -sfn "$c" "$BACKUP_DIR/latest"

# --- retention ----------------------------------------------------------------
find "$BACKUP_DIR/db" -type f \( -name 'personalos-*.dump*' -o -name 'globals-*.sql*' \) -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR/config" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} +
echo "backup $ts ok: $(stat -c %s "$dump") bytes db, config $(ls "$c" | wc -l) files, store $(du -sh "$BACKUP_DIR" | cut -f1)"
