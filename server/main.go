package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/charmbracelet/log"
	"github.com/charmbracelet/ssh"
	"github.com/charmbracelet/wish"
	"github.com/charmbracelet/wish/activeterm"
	"github.com/charmbracelet/wish/logging"
	"github.com/creack/pty"
	gossh "golang.org/x/crypto/ssh"
)

//go:embed www/*
var wwwFS embed.FS

const (
	host           = "0.0.0.0"
	port           = "2222"
	httpPort       = "8080"
	maxConnections = 50
	logFile        = "access.log"
	visitorFile    = "../visitors.count"
)

var (
	connCount int
	connMu    sync.Mutex
	accessLog *json.Encoder
	logMu     sync.Mutex
)

type AccessLogEntry struct {
	Timestamp   string `json:"timestamp"`
	Event       string `json:"event"`
	UserKey     string `json:"user_key"`
	RemoteAddr  string `json:"remote_addr"`
	SessionID   string `json:"session_id,omitempty"`
	Terminal    string `json:"terminal,omitempty"`
	WindowW     int    `json:"window_w,omitempty"`
	WindowH     int    `json:"window_h,omitempty"`
	DurationMs  int64  `json:"duration_ms,omitempty"`
	ExitStatus  string `json:"exit_status,omitempty"`
	ConnCount   int    `json:"conn_count,omitempty"`
	Error       string `json:"error,omitempty"`
}

func writeVisitorCount() {
	connMu.Lock()
	count := connCount
	connMu.Unlock()
	os.WriteFile(visitorFile, []byte(strconv.Itoa(count)), 0644)
}

func logAccess(entry AccessLogEntry) {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	logMu.Lock()
	defer logMu.Unlock()
	if accessLog != nil {
		accessLog.Encode(entry)
	}
}

func main() {
	// Set up structured access log file
	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Fatal("Could not open access log", "error", err)
	}
	defer f.Close()
	accessLog = json.NewEncoder(f)

	logAccess(AccessLogEntry{
		Event: "server_start",
	})
	writeVisitorCount()

	// Load auth config and approved keys
	LoadAuthConfig("../gallery/config.json")
	if IsAuthEnabled() {
		LoadApprovedKeys()
		StartTokenPurger()
	}

	s, err := wish.NewServer(
		wish.WithAddress(fmt.Sprintf("%s:%s", host, port)),
		wish.WithHostKeyPath(".ssh/id_ed25519"),
		wish.WithPublicKeyAuth(func(_ ssh.Context, _ ssh.PublicKey) bool {
			return true // accept all keys
		}),
		wish.WithMiddleware(
			tuiMiddleware(),
			activeterm.Middleware(),
			commandMiddleware(),
			logging.Middleware(),
		),
	)
	if err != nil {
		log.Fatal("Could not create server", "error", err)
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	log.Info("Starting SSH server", "host", host, "port", port)
	go func() {
		if err := s.ListenAndServe(); err != nil && err != ssh.ErrServerClosed {
			log.Fatal("Server error", "error", err)
		}
	}()

	// Start HTTP server for the website + auth routes
	wwwRoot, _ := fs.Sub(wwwFS, "www")
	httpMux := http.NewServeMux()
	if IsAuthEnabled() {
		httpMux.Handle("/auth/", AuthMux())
	}
	httpMux.Handle("/", http.FileServer(http.FS(wwwRoot)))
	httpServer := &http.Server{
		Addr:    fmt.Sprintf("%s:%s", host, httpPort),
		Handler: httpMux,
	}
	log.Info("Starting HTTP server", "host", host, "port", httpPort)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("HTTP server error", "error", err)
		}
	}()

	<-done
	log.Info("Shutting down...")
	logAccess(AccessLogEntry{
		Event: "server_stop",
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	if err := s.Shutdown(ctx); err != nil {
		log.Fatal("Shutdown error", "error", err)
	}
}

func tuiMiddleware() wish.Middleware {
	return func(next ssh.Handler) ssh.Handler {
		return func(s ssh.Session) {
			start := time.Now()
			remoteAddr := s.RemoteAddr().String()
			sessionID := s.Context().SessionID()

			// Get user's public key fingerprint
			userKey := "anonymous"
			if s.PublicKey() != nil {
				userKey = gossh.FingerprintSHA256(s.PublicKey())
			}

			// Connection cap
			connMu.Lock()
			if connCount >= maxConnections {
				connMu.Unlock()
				logAccess(AccessLogEntry{
					Event:      "rejected",
					UserKey:    userKey,
					RemoteAddr: remoteAddr,
					SessionID:  sessionID,
					ConnCount:  connCount,
					Error:      "max_connections",
				})
				wish.Println(s, "Server is busy, please try again later.")
				return
			}
			connCount++
			currentCount := connCount
			connMu.Unlock()
			writeVisitorCount()
			defer func() {
				connMu.Lock()
				connCount--
				connMu.Unlock()
				writeVisitorCount()
			}()

			// Get PTY info
			ppty, winCh, ok := s.Pty()
			if !ok {
				logAccess(AccessLogEntry{
					Event:      "rejected",
					UserKey:    userKey,
					RemoteAddr: remoteAddr,
					SessionID:  sessionID,
					Error:      "no_pty",
				})
				wish.Println(s, "A terminal is required to use mussheum.")
				return
			}

			logAccess(AccessLogEntry{
				Event:      "connect",
				UserKey:    userKey,
				RemoteAddr: remoteAddr,
				SessionID:  sessionID,
				Terminal:   ppty.Term,
				WindowW:    ppty.Window.Width,
				WindowH:    ppty.Window.Height,
				ConnCount:  currentCount,
			})

			// Check if user is approved (OAuth)
			var authURL string
			if IsAuthEnabled() {
				if userKey == "anonymous" {
					wish.Println(s, "An SSH key is required. Please connect with: ssh -i ~/.ssh/id_ed25519 <host>")
					return
				}
				if _, approved := IsKeyApproved(userKey); !approved {
					token := CreatePendingToken(userKey)
					publicURL := os.Getenv("PUBLIC_URL")
					if publicURL == "" {
						publicURL = fmt.Sprintf("http://localhost:%s", httpPort)
					}
					authURL = fmt.Sprintf("%s/auth/%s", publicURL, token)
				}
			}

			// Build command — use compiled binary or bun run
			var cmd *exec.Cmd
			tuiCmd := os.Getenv("TUI_CMD")
			args := []string{}
			if tuiCmd != "" {
				args = append(args, "../tui/tui.tsx")
			}
			args = append(args, fmt.Sprintf("--user-key=%s", userKey))
			if authURL != "" {
				args = append(args, fmt.Sprintf("--auth-url=%s", authURL))
			}
			if tuiCmd != "" {
				cmd = exec.Command(tuiCmd, args...)
			} else {
				cmd = exec.Command("../tui/mussheum-tui", args...)
			}
			cmd.Dir = "."
			cmd.Env = append(os.Environ(),
				fmt.Sprintf("TERM=%s", ppty.Term),
				fmt.Sprintf("COLUMNS=%d", ppty.Window.Width),
				fmt.Sprintf("LINES=%d", ppty.Window.Height),
				fmt.Sprintf("BUTTONDOWN_API_KEY=%s", os.Getenv("BUTTONDOWN_API_KEY")),
			)

			// Start with PTY
			ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
				Rows: uint16(ppty.Window.Height),
				Cols: uint16(ppty.Window.Width),
			})
			if err != nil {
				log.Error("Failed to start TUI", "error", err)
				logAccess(AccessLogEntry{
					Event:      "error",
					UserKey:    userKey,
					RemoteAddr: remoteAddr,
					SessionID:  sessionID,
					Error:      fmt.Sprintf("pty_start: %v", err),
				})
				wish.Println(s, "Failed to start the gallery. Please try again.")
				return
			}
			defer ptmx.Close()

			// Handle window resize
			go func() {
				for win := range winCh {
					pty.Setsize(ptmx, &pty.Winsize{
						Rows: uint16(win.Height),
						Cols: uint16(win.Width),
					})
				}
			}()

			// Bridge I/O: SSH session <-> PTY
			go func() {
				io.Copy(ptmx, s) // stdin: SSH -> PTY
			}()
			io.Copy(s, ptmx) // stdout: PTY -> SSH (blocks until PTY closes)

			// Wait for process to exit, with timeout
			exitDone := make(chan error, 1)
			go func() {
				exitDone <- cmd.Wait()
			}()

			exitStatus := "normal"
			select {
			case err := <-exitDone:
				if err != nil {
					exitStatus = fmt.Sprintf("error: %v", err)
				}
			case <-time.After(5 * time.Second):
				cmd.Process.Kill()
				exitStatus = "timeout_killed"
			}

			duration := time.Since(start)
			logAccess(AccessLogEntry{
				Event:      "disconnect",
				UserKey:    userKey,
				RemoteAddr: remoteAddr,
				SessionID:  sessionID,
				DurationMs: duration.Milliseconds(),
				ExitStatus: exitStatus,
			})
		}
	}
}
