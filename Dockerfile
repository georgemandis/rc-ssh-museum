# Stage 1: Install TUI dependencies (Bun)
FROM oven/bun:1 AS tui-builder
WORKDIR /app/tui
COPY tui/package.json tui/bun.lock* ./
RUN bun install --production
COPY tui/ ./

# Stage 2: Build SSH server binary (Go)
FROM golang:1.25 AS server-builder
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -o mussheum-server .

# Stage 3: Runtime
FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy TUI source + dependencies (sharp needs native modules, can't use bun compile)
COPY --from=tui-builder /app/tui ./tui

# Copy Go server binary
COPY --from=server-builder /app/server/mussheum-server ./server/mussheum-server

# Copy gallery content
COPY gallery/ ./gallery/

# Copy entrypoint
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV FORCE_COLOR=1
ENV TERM=xterm-256color

EXPOSE 2222
EXPOSE 8080

# Fly.io: mount volume at /data
# Docker Compose: mount volumes at /app/server/.ssh and /app/data
VOLUME ["/app/server/.ssh", "/app/data"]

CMD ["./entrypoint.sh"]
