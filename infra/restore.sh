#!/usr/bin/env bash
# Restore a dump made by backup.sh:  bash restore.sh backups/tacho-<time>.dump
# Replaces the whole database. web and bot are stopped while it runs, then
# started again (pending migrations of the running image are applied first).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

file="${1:?usage: restore.sh <file.dump> [--yes]}"
[ -f "$file" ] || {
	echo "No such file: $file" >&2
	exit 1
}
if [ "${2:-}" != "--yes" ]; then
	read -r -p "This replaces the database 'tacho' with $file. Type 'restore' to go on: " answer
	[ "$answer" = restore ] || exit 1
fi

"${COMPOSE[@]}" exec -T postgres pg_restore --list <"$file" >/dev/null
log "stopping web and bot"
"${COMPOSE[@]}" stop web bot
log "recreating database tacho"
"${COMPOSE[@]}" exec -T postgres psql -U tacho -d postgres -v ON_ERROR_STOP=1 \
	-c 'DROP DATABASE IF EXISTS tacho WITH (FORCE)' \
	-c 'CREATE DATABASE tacho OWNER tacho'
log "restoring $file"
"${COMPOSE[@]}" exec -T postgres pg_restore -U tacho -d tacho --no-owner --exit-on-error <"$file"
log "applying migrations and starting web and bot"
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d web bot
log "restore done"
