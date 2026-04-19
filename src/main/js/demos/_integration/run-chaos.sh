#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
  cd "$1"
else
  cd "$(dirname "$0")"
fi

repo_root="$(git -C . rev-parse --show-toplevel)"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}

wait_for_health() {
  service="$1"
  container_id="$(docker compose ps -q "$service")"
  if [ -z "$container_id" ]; then
    echo "No container for service $service" >&2
    exit 1
  fi
  while :; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
    if [ "$status" = "healthy" ] || [ "$status" = "none" ]; then
      break
    fi
    sleep 1
  done
}

trap cleanup EXIT INT TERM

cleanup
rm -rf "$repo_root/target/dependency"
docker compose up -d --build kafka
wait_for_health kafka
docker compose run --rm --build --no-deps prepare
docker compose run --rm --build --no-deps topics
docker compose up -d --build --no-deps engine scheduler

export KAFKA_BROKERS="${KAFKA_BROKERS:-${KAFKA_BROKERS_DEFAULT:-127.0.0.1:19092}}"
export COMPOSE_FILE="${COMPOSE_FILE:-$(pwd)/compose.yaml}"

if [ -n "${TEST_TIMEOUT_MS_DEFAULT:-}" ]; then
  export TEST_TIMEOUT_MS="${TEST_TIMEOUT_MS:-$TEST_TIMEOUT_MS_DEFAULT}"
fi
if [ -n "${CHAOS_SETTLE_MS_DEFAULT:-}" ]; then
  export CHAOS_SETTLE_MS="${CHAOS_SETTLE_MS:-$CHAOS_SETTLE_MS_DEFAULT}"
fi

node ./chaos-test.mjs
