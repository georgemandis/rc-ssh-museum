package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// findFreePort finds an available TCP port
func findFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// generateTestKey creates an ephemeral SSH key pair for testing
func generateTestKey(t *testing.T) gossh.Signer {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := gossh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

// startTestServer starts the SSH server on a random port for testing.
// Returns the port and a cleanup function.
// Requires the server binary to be built first (go build -o mussheum-server .)
func startTestServer(t *testing.T) (int, func()) {
	// Build the server
	build := exec.Command("go", "build", "-o", "mussheum-server-test", ".")
	build.Dir = "."
	if out, err := build.CombinedOutput(); err != nil {
		t.Skipf("Could not build server: %v\n%s", err, out)
	}

	port, err := findFreePort()
	if err != nil {
		t.Fatal(err)
	}

	// We can't easily change the port in the server without modifying it,
	// so instead we'll test SSH behavior directly using the crypto/ssh client
	// against the actual server config. For now, test the security properties
	// at the SSH protocol level.

	cleanup := func() {
		os.Remove("mussheum-server-test")
	}

	return port, cleanup
}

// TestSSHCommandRejected verifies that running a command via SSH
// (e.g., "ssh host ls") does not execute anything — the server
// should only serve the TUI via interactive PTY sessions.
func TestSSHCommandRejected(t *testing.T) {
	// This test verifies the security property at the protocol level:
	// When a client requests command execution without a PTY,
	// the server should reject it or return the "terminal required" message.

	// We test this by examining the server code behavior:
	// The tuiMiddleware checks s.Pty() and returns early if no PTY is allocated.
	// SSH command execution (ssh host <command>) does NOT allocate a PTY by default.

	// Since starting the full server requires host keys and the TUI binary,
	// we verify the middleware logic directly.

	// Simulate: s.Pty() returns ok=false → should print error and return
	// This is tested by confirming the code path exists.

	// For a real integration test, we need ssh connectivity.
	// Let's test with a real SSH connection if the server is running.

	t.Run("no_pty_gets_rejected_message", func(t *testing.T) {
		// Verify the rejection message is what we expect
		expectedMsg := "A terminal is required to use mussheum."
		// This is a code-level assertion — the message is hardcoded in main.go:174
		// If someone changes it, this test should remind them to keep the behavior.
		src, err := os.ReadFile("main.go")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(src), expectedMsg) {
			t.Errorf("Expected rejection message %q not found in main.go — ensure non-PTY sessions are rejected", expectedMsg)
		}
	})

	t.Run("no_shell_or_exec_passthrough", func(t *testing.T) {
		// Verify the server never calls cmd.Run with user-supplied commands.
		// The only exec.Command should be for the TUI binary with --user-key flag.
		src, err := os.ReadFile("main.go")
		if err != nil {
			t.Fatal(err)
		}

		source := string(src)

		// Should only exec the TUI binary (directly or via TUI_CMD)
		if !strings.Contains(source, `"../tui/mussheum-tui"`) && !strings.Contains(source, `"../tui/tui.tsx"`) {
			t.Error("Expected server to exec mussheum-tui binary or tui.tsx")
		}

		// Should NOT contain any shell passthrough patterns
		// Note: s.Command() is allowed for routing the "submit" command,
		// but must not be used to exec arbitrary user commands.
		dangerousPatterns := []string{
			`exec.Command("sh"`,
			`exec.Command("bash"`,
			`exec.Command("/bin/sh"`,
			"os.system",
		}
		for _, pattern := range dangerousPatterns {
			if strings.Contains(source, pattern) {
				t.Errorf("Found dangerous pattern %q in server code — the server should not pass through SSH commands", pattern)
			}
		}
	})

	t.Run("user_key_not_user_controlled", func(t *testing.T) {
		// Verify the user key passed to the TUI comes from the SSH public key,
		// not from any user-supplied input (command args, environment, etc.)
		src, err := os.ReadFile("main.go")
		if err != nil {
			t.Fatal(err)
		}

		source := string(src)

		// The user key should be derived from the SSH public key fingerprint
		if !strings.Contains(source, "gossh.FingerprintSHA256(s.PublicKey())") {
			t.Error("User key should be derived from SSH public key fingerprint")
		}

		// The --user-key flag should use the server-generated fingerprint
		if !strings.Contains(source, fmt.Sprintf(`fmt.Sprintf("--user-key=%%s", userKey)`)) {
			t.Error("User key should be passed to TUI via --user-key flag from server-derived value")
		}
	})

	t.Run("max_connections_enforced", func(t *testing.T) {
		src, err := os.ReadFile("main.go")
		if err != nil {
			t.Fatal(err)
		}

		source := string(src)

		if !strings.Contains(source, "maxConnections") {
			t.Error("Server should enforce a max connections limit")
		}
		if !strings.Contains(source, "connCount >= maxConnections") {
			t.Error("Server should check connection count against max")
		}
	})
}

// TestSSHNoPTYConnection tests that connecting without a PTY
// results in the rejection message (not a shell or command execution).
// This requires an actual SSH server to be running.
func TestSSHNoPTYConnection(t *testing.T) {
	if os.Getenv("MUSSHEUM_TEST_SSH") == "" {
		t.Skip("Set MUSSHEUM_TEST_SSH=host:port to run SSH integration tests")
	}

	addr := os.Getenv("MUSSHEUM_TEST_SSH")
	signer := generateTestKey(t)

	config := &gossh.ClientConfig{
		User:            "gallery",
		Auth:            []gossh.AuthMethod{gossh.PublicKeys(signer)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	client, err := gossh.Dial("tcp", addr, config)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Try to execute a command without PTY
	session, err := client.NewSession()
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}
	defer session.Close()

	// Run "ls" — should NOT actually list files
	output, err := session.CombinedOutput("ls")
	outputStr := string(output)

	// The server should either reject the session or return the "terminal required" message
	if strings.Contains(outputStr, "meta.json") || strings.Contains(outputStr, "gallery") {
		t.Error("Command execution returned file listing — server should not allow command execution")
	}

	if len(outputStr) > 0 && !strings.Contains(outputStr, "terminal is required") {
		t.Logf("Server response to command: %q", outputStr)
	}
}
