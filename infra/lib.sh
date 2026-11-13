# Shared by deploy.sh, backup.sh and restore.sh. Not run on its own.
# TACHO_COMPOSE and TACHO_ENV_FILE are only overridden for local tests.

cd "$(dirname "$0")"
ENV_FILE="${TACHO_ENV_FILE:-.env}"
read -r -a COMPOSE <<<"${TACHO_COMPOSE:-docker compose -f docker-compose.prod.yml}"

[ -f "$ENV_FILE" ] || {
	echo "No $ENV_FILE in $(pwd). Copy .env.example and fill it in (docs/DEPLOY.md)." >&2
	exit 1
}

# envval KEY: the value of KEY in the env file (last one wins), without sourcing it.
envval() {
	grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

log() {
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}
