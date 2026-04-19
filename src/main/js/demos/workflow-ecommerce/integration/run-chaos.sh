#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
KAFKA_BROKERS_DEFAULT="127.0.0.1:29092" \
exec "$SCRIPT_DIR/../../_integration/run-chaos.sh" "$SCRIPT_DIR"
