#!/usr/bin/env bash
# scripts/homelab/save-release-images.sh — runs ON THE PRODUCTION HOST.
#
# Checkpoint 10.8.5 (ADR-079). Makes a set of Personal OS images survive an
# out-of-band `docker image prune -a` / `docker system prune -a`, and bounds
# how many old release images the host keeps.
#
#   save-release-images.sh <label>            save personal-os-{api,worker,web}:<label>
#   save-release-images.sh <label> --from-latest
#                                             tag :latest as :<label> first (the
#                                             "tag the serving images" deploy step)
#   save-release-images.sh --list             show what is saved / kept
#
# For each service it (1) `docker save`s the tagged image to
# $IMAGE_STORE/<label>/<svc>.tar.gz with a sha256 and a manifest — a tarball is
# immune to every prune verb; (2) creates a stopped "keeper" container that
# references the image, which is what makes `docker image prune -a` skip it
# (the exact verb that hit the host on 2026-09-18); (3) retires labels older
# than the newest $KEEP (default 2: current + previous release) — their
# tarballs, keeper containers and `:<label>` tags only. It never touches
# `:latest`, any non-personal-os image, any running container, or any volume.
set -euo pipefail

IMAGE_STORE="${IMAGE_STORE:-$HOME/personal-os-images}"
KEEP="${KEEP:-2}"
SERVICES=(api worker web)

usage() { sed -n '2,25p' "$0"; exit 2; }

list() {
  echo "image store: $IMAGE_STORE (keep newest $KEEP labels)"
  if [ -d "$IMAGE_STORE" ]; then
    for d in $(ls -1t "$IMAGE_STORE" 2>/dev/null); do
      printf '  %-24s %s\n' "$d" "$(du -sh "$IMAGE_STORE/$d" | cut -f1)  $(ls "$IMAGE_STORE/$d" | tr '\n' ' ')"
    done
  fi
  echo "keeper containers:"
  docker ps -a --filter label=io.personal-os.keeper=true --format '  {{.Names}}  {{.Image}}  {{.Status}}'
  echo "personal-os image tags:"
  docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedAt}}  {{.Size}}' \
    | { grep '^personal-os-' || true; } | sort | sed 's/^/  /'
}

[ $# -ge 1 ] || usage
case "$1" in --list) list; exit 0;; -h|--help) usage;; esac
LABEL="$1"; shift
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad label: $LABEL" >&2; exit 2; }
FROM_LATEST=0
[ "${1:-}" = "--from-latest" ] && FROM_LATEST=1

dir="$IMAGE_STORE/$LABEL"
mkdir -p "$dir"
for svc in "${SERVICES[@]}"; do
  img="personal-os-$svc:$LABEL"
  if [ "$FROM_LATEST" = 1 ]; then
    docker tag "personal-os-$svc:latest" "$img"
  fi
  id="$(docker image inspect -f '{{.Id}}' "$img" 2>/dev/null || true)"
  if [ -z "$id" ]; then echo "SKIP $img: no such image" >&2; continue; fi
  tar="$dir/$svc.tar.gz"
  if [ -f "$tar" ] && [ -f "$dir/$svc.manifest" ] && grep -q "$id" "$dir/$svc.manifest"; then
    echo "OK   $img already saved ($tar)"
  else
    echo "SAVE $img -> $tar"
    docker save "$img" | gzip -1 > "$tar.partial"
    mv "$tar.partial" "$tar"
    sha256sum "$tar" | cut -d' ' -f1 > "$tar.sha256"
    {
      echo "image=$img"; echo "id=$id"
      echo "created=$(docker image inspect -f '{{.Created}}' "$img")"
      echo "saved_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "size_bytes=$(stat -c %s "$tar")"
    } > "$dir/$svc.manifest"
  fi
  keeper="personal-os-keep-$LABEL-$svc"
  if ! docker container inspect "$keeper" >/dev/null 2>&1; then
    # `true` as the command: the container is created, never started.
    docker create --name "$keeper" --label io.personal-os.keeper=true \
      --label "io.personal-os.keeper.label=$LABEL" "$img" true >/dev/null
    echo "KEEP $keeper -> $img"
  fi
done
touch "$dir"

# Retention: retire everything older than the newest $KEEP saved labels.
mapfile -t labels < <(ls -1t "$IMAGE_STORE")
if [ "${#labels[@]}" -gt "$KEEP" ]; then
  for old in "${labels[@]:$KEEP}"; do
    echo "RETIRE $old (older than the newest $KEEP)"
    for svc in "${SERVICES[@]}"; do
      docker rm -f "personal-os-keep-$old-$svc" >/dev/null 2>&1 || true
      docker rmi "personal-os-$svc:$old" >/dev/null 2>&1 || true
    done
    rm -rf "${IMAGE_STORE:?}/$old"
  done
fi
echo; list
