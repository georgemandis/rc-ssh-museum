#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing TUI dependencies..."
cd tui
bun install
cd ..

echo "==> Building TUI binary..."
cd tui
bun build --compile tui.tsx --outfile mussheum-tui
cd ..

echo "==> Building SSH server..."
cd server
go build -o mussheum-server .
cd ..

echo ""
echo "Done! To run:"
echo "  1. cd server && ./mussheum-server  # start SSH on :2222"
echo ""
echo "Then connect:"
echo "  ssh -p 2222 localhost"
