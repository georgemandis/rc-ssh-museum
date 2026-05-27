#!/bin/sh
set -e

# Persistent volume at /data (managed by disco.json or Fly.io)
if [ -d /data ]; then
  mkdir -p /data/ssh-keys /data/logs
  # Symlink so the Go server finds its key and log in the expected locations
  ln -sfn /data/ssh-keys /app/server/.ssh
  # Touch the log so the symlink target exists
  touch /data/logs/access.log
  ln -sfn /data/logs/access.log /app/server/access.log
else
  mkdir -p /app/server/.ssh
fi

# Use bun to run TUI in Docker (sharp native modules don't work with bun compile)
# Locally, the compiled mussheum-tui binary is used by default
export TUI_CMD="${TUI_CMD:-bun}"

cd /app/server
exec ./mussheum-server
