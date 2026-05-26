#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/stats.sh [today|week|month|all] [path/to/access.log]
#
# Parses the mussheum NDJSON access log and reports:
#   - Total sessions (connect events)
#   - Unique visitors (by SSH key fingerprint)
#   - Average session duration
#   - Peak concurrent connections
#
# Defaults to "today" and "server/access.log"

PERIOD="${1:-today}"
LOG="${2:-server/access.log}"

if [ ! -f "$LOG" ]; then
  echo "No log file found at $LOG"
  exit 1
fi

# Determine date filter based on period
case "$PERIOD" in
  today)
    DATE_FILTER=$(date -u "+%Y-%m-%d")
    LABEL="Today ($DATE_FILTER)"
    ;;
  week)
    if date --version >/dev/null 2>&1; then
      DATE_FILTER=$(date -u -d "7 days ago" "+%Y-%m-%d")
    else
      DATE_FILTER=$(date -u -v-7d "+%Y-%m-%d")
    fi
    LABEL="Last 7 days (since $DATE_FILTER)"
    ;;
  month)
    if date --version >/dev/null 2>&1; then
      DATE_FILTER=$(date -u -d "30 days ago" "+%Y-%m-%d")
    else
      DATE_FILTER=$(date -u -v-30d "+%Y-%m-%d")
    fi
    LABEL="Last 30 days (since $DATE_FILTER)"
    ;;
  all)
    DATE_FILTER=""
    LABEL="All time"
    ;;
  *)
    echo "Usage: $0 [today|week|month|all] [logfile]"
    exit 1
    ;;
esac

echo "=== mussheum stats: $LABEL ==="
echo ""

# Extract field value from a JSON line (simple, no nested objects)
# Uses grep -o and sed since macOS awk lacks capture groups
jval() {
  echo "$1" | grep -o "\"$2\":\"[^\"]*\"" 2>/dev/null | head -1 | sed "s/\"$2\":\"//;s/\"$//" || echo ""
}
jnum() {
  echo "$1" | grep -o "\"$2\":[0-9]*" 2>/dev/null | head -1 | sed "s/\"$2\"://" || echo "0"
}

CONNECTS=0
UNIQUE_FILE=$(mktemp)
TOTAL_DURATION=0
DURATION_COUNT=0
PEAK=0
REJECTED=0
ERRORS=0

while IFS= read -r line; do
  ts=$(jval "$line" "timestamp")
  event=$(jval "$line" "event")

  # Date filtering
  if [ "$PERIOD" != "all" ] && [ -n "$DATE_FILTER" ]; then
    entry_date="${ts:0:10}"
    if [[ "$entry_date" < "$DATE_FILTER" ]]; then
      continue
    fi
  fi

  case "$event" in
    connect)
      CONNECTS=$((CONNECTS + 1))
      user_key=$(jval "$line" "user_key")
      if [ -n "$user_key" ] && [ "$user_key" != "anonymous" ]; then
        echo "$user_key" >> "$UNIQUE_FILE"
      fi
      cc=$(jnum "$line" "conn_count")
      if [ "$cc" -gt "$PEAK" ] 2>/dev/null; then
        PEAK=$cc
      fi
      ;;
    disconnect)
      dur=$(jnum "$line" "duration_ms")
      if [ "$dur" -gt 0 ] 2>/dev/null; then
        TOTAL_DURATION=$((TOTAL_DURATION + dur))
        DURATION_COUNT=$((DURATION_COUNT + 1))
      fi
      ;;
    rejected)
      REJECTED=$((REJECTED + 1))
      ;;
    error)
      ERRORS=$((ERRORS + 1))
      ;;
  esac
done < "$LOG"

UNIQUES=0
if [ -s "$UNIQUE_FILE" ]; then
  UNIQUES=$(sort -u "$UNIQUE_FILE" | wc -l | tr -d ' ')
fi
rm -f "$UNIQUE_FILE"

echo "  Sessions:          $CONNECTS"
echo "  Unique visitors:   $UNIQUES"

if [ "$DURATION_COUNT" -gt 0 ]; then
  AVG_MS=$((TOTAL_DURATION / DURATION_COUNT))
  AVG_SEC=$((AVG_MS / 1000))
  if [ "$AVG_SEC" -ge 60 ]; then
    echo "  Avg duration:      $((AVG_SEC / 60))m $((AVG_SEC % 60))s"
  else
    echo "  Avg duration:      ${AVG_SEC}s"
  fi
fi

echo "  Peak concurrent:   $PEAK"

if [ "$REJECTED" -gt 0 ]; then
  echo "  Rejected (full):   $REJECTED"
fi
if [ "$ERRORS" -gt 0 ]; then
  echo "  Errors:            $ERRORS"
fi

echo ""
