#!/usr/bin/env bash
# Nightly database dump: bash backup.sh  (systemd timer or cron, docs/DEPLOY.md)
# Writes BACKUP_DIR/tacho-<UTC time>.dump (pg_dump custom format), deletes
# dumps older than BACKUP_KEEP_DAYS, then copies the folder off the server
# with rclone (BACKUP_RCLONE_REMOTE) or rsync (BACKUP_RSYNC_TARGET) if set.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

dir="$(envval BACKUP_DIR)"
dir="${dir:-./backups}"
keep="$(envval BACKUP_KEEP_DAYS)"
keep="${keep:-14}"
mkdir -p "$dir"

file="$dir/tacho-$(date -u +%Y%m%dT%H%M%SZ).dump"
log "dumping to $file"
"${COMPOSE[@]}" exec -T postgres pg_dump -U tacho -d tacho --format=custom >"$file.partial"
# A dump pg_restore cannot list is not a backup.
"${COMPOSE[@]}" exec -T postgres pg_restore --list <"$file.partial" >/dev/null
mv "$file.partial" "$file"
chmod 600 "$file"
log "dump ok, $(du -h "$file" | cut -f1)"

find "$dir" -maxdepth 1 -name 'tacho-*.dump' -mtime +"$((keep - 1))" -print -delete
find "$dir" -maxdepth 1 -name 'tacho-*.dump.partial' -mmin +60 -delete

remote="$(envval BACKUP_RCLONE_REMOTE)"
target="$(envval BACKUP_RSYNC_TARGET)"
if [ -n "$remote" ]; then
	log "copying to $remote"
	rclone copy "$dir" "$remote" --include 'tacho-*.dump'
	rclone delete "$remote" --include 'tacho-*.dump' --min-age "${keep}d"
elif [ -n "$target" ]; then
	log "copying to $target"
	rsync -a --delete --include 'tacho-*.dump' --exclude '*' "$dir/" "$target/"
else
	log "no off-server target set (BACKUP_RCLONE_REMOTE or BACKUP_RSYNC_TARGET); local copy only"
fi
log "backup done"
