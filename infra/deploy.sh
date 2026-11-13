#!/usr/bin/env bash
# Deploy (or roll back to) one image tag:  bash deploy.sh sha-<commit>
# Run in /opt/tacho on the server; the deploy workflow calls it over SSH.
# Migrations run first; if they fail, the running site is left alone.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

TAG="${1:?usage: deploy.sh <image tag, e.g. sha-0123abc...>}"

if grep -qE '^TAG=' "$ENV_FILE"; then
	sed -i "s/^TAG=.*/TAG=$TAG/" "$ENV_FILE"
else
	echo "TAG=$TAG" >>"$ENV_FILE"
fi
log "deploying $TAG"

# TACHO_LOCAL_TEST=1: images built on this machine, so no pull, and no pruning
# of a Docker that is not the server's alone.
[ -n "${TACHO_LOCAL_TEST:-}" ] || "${COMPOSE[@]}" pull --quiet
"${COMPOSE[@]}" up -d postgres
log "applying migrations"
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --remove-orphans

log "waiting for web to report healthy"
web="$("${COMPOSE[@]}" ps -q web)"
for _ in $(seq 1 30); do
	status="$(docker inspect -f '{{.State.Health.Status}}' "$web" 2>/dev/null || echo unknown)"
	if [ "$status" = healthy ]; then
		log "web is healthy on $TAG"
		if [ -z "${TACHO_LOCAL_TEST:-}" ]; then
			# Keep the images of the last three deploys for a quick rollback.
			prefix="$(envval IMAGE_PREFIX)"
			for app in web bot; do
				old_tags="$(docker image ls "$prefix/$app" --format '{{.Tag}}' | grep '^sha-' | grep -vx "$TAG" | tail -n +3 || true)"
				for old in $old_tags; do docker image rm "$prefix/$app:$old" >/dev/null || true; done
			done
			docker image prune -f >/dev/null
		fi
		exit 0
	fi
	sleep 5
done
log "web did not become healthy within 150 s (last status: $status)"
"${COMPOSE[@]}" logs --tail 50 web
exit 1
