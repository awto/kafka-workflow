#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
KAFKA_BROKERS_DEFAULT="127.0.0.1:49092" \
TEST_TIMEOUT_MS_DEFAULT="120000" \
CHAOS_SETTLE_MS_DEFAULT="1000" \
exec "$SCRIPT_DIR/../../../_integration/run-chaos.sh" "$SCRIPT_DIR"
