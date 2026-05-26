#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/fly-stats.sh [today|week|month|all]
#
# Pulls access.log from the Fly volume and runs stats locally.

PERIOD="${1:-today}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Read app name from fly.toml
APP_NAME=$(grep '^app\s*=' "$PROJECT_DIR/fly.toml" | sed "s/app\s*=\s*'//;s/'//")

TMPDIR=$(mktemp -d)
TMPLOG="$TMPDIR/access.log"

trap 'rm -rf "$TMPDIR"' EXIT

echo "Fetching access.log from Fly ($APP_NAME)..."
fly ssh sftp get /data/logs/access.log "$TMPLOG" -a "$APP_NAME"

"$SCRIPT_DIR/stats.sh" "$PERIOD" "$TMPLOG"
