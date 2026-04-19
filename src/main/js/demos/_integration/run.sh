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

cleanup
trap cleanup EXIT
rm -rf "$repo_root/target/dependency"

docker compose up -d --build kafka
wait_for_health kafka
if [ "${FORCE_INTEGRATION_IMAGE_BUILD:-0}" = "1" ] || ! docker image inspect kafka-workflow-integration-tooling:node24-maven3.9.11 >/dev/null 2>&1; then
  docker compose build prepare
fi
docker compose run --rm --no-deps prepare
docker compose run --rm --no-deps topics
docker compose up -d --no-build --no-deps engine scheduler
docker compose run --rm --no-deps test
