package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
)

const (
	tokenTTL       = 10 * time.Minute
	tokenPurgeFreq = 1 * time.Minute
	approvedFile   = "/data/approved-keys.json"
)

// ApprovedKey stores a verified RC member's SSH key.
type ApprovedKey struct {
	Fingerprint string `json:"fingerprint"`
	Name        string `json:"name"`
	RCUserID    int    `json:"rc_user_id"`
	ApprovedAt  string `json:"approved_at"`
}

// PendingToken maps a short-lived token to an SSH key fingerprint.
type PendingToken struct {
	Fingerprint string
	CreatedAt   time.Time
}

var (
	approvedKeys   = make(map[string]ApprovedKey) // fingerprint -> ApprovedKey
	approvedKeysMu sync.RWMutex

	pendingTokens   = make(map[string]PendingToken) // token -> PendingToken
	pendingTokensMu sync.Mutex
)

func generateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// IsKeyApproved checks if an SSH key fingerprint is on the approved list.
func IsKeyApproved(fingerprint string) (ApprovedKey, bool) {
	approvedKeysMu.RLock()
	defer approvedKeysMu.RUnlock()
	key, ok := approvedKeys[fingerprint]
	return key, ok
}

// CreatePendingToken creates a token for an unapproved SSH key.
func CreatePendingToken(fingerprint string) string {
	pendingTokensMu.Lock()
	defer pendingTokensMu.Unlock()

	// Reuse existing token if one exists for this fingerprint
	for token, pending := range pendingTokens {
		if pending.Fingerprint == fingerprint && time.Since(pending.CreatedAt) < tokenTTL {
			return token
		}
	}

	token := generateToken()
	pendingTokens[token] = PendingToken{
		Fingerprint: fingerprint,
		CreatedAt:   time.Now(),
	}
	return token
}

// LoadApprovedKeys reads the approved keys file from disk.
func LoadApprovedKeys() {
	approvedKeysMu.Lock()
	defer approvedKeysMu.Unlock()

	data, err := os.ReadFile(approvedFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Error("Failed to read approved keys", "error", err)
		}
		return
	}

	var keys []ApprovedKey
	if err := json.Unmarshal(data, &keys); err != nil {
		log.Error("Failed to parse approved keys", "error", err)
		return
	}

	for _, k := range keys {
		approvedKeys[k.Fingerprint] = k
	}
	log.Info("Loaded approved keys", "count", len(keys))
}

func saveApprovedKeys() {
	approvedKeysMu.RLock()
	keys := make([]ApprovedKey, 0, len(approvedKeys))
	for _, k := range approvedKeys {
		keys = append(keys, k)
	}
	approvedKeysMu.RUnlock()

	data, err := json.MarshalIndent(keys, "", "  ")
	if err != nil {
		log.Error("Failed to marshal approved keys", "error", err)
		return
	}

	if err := os.WriteFile(approvedFile, data, 0644); err != nil {
		log.Error("Failed to write approved keys", "error", err)
	}
}

func approveKey(fingerprint string, name string, rcUserID int) {
	approvedKeysMu.Lock()
	approvedKeys[fingerprint] = ApprovedKey{
		Fingerprint: fingerprint,
		Name:        name,
		RCUserID:    rcUserID,
		ApprovedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	approvedKeysMu.Unlock()
	saveApprovedKeys()
}

// StartTokenPurger periodically removes expired pending tokens.
func StartTokenPurger() {
	go func() {
		for {
			time.Sleep(tokenPurgeFreq)
			pendingTokensMu.Lock()
			for token, pending := range pendingTokens {
				if time.Since(pending.CreatedAt) > tokenTTL {
					delete(pendingTokens, token)
				}
			}
			pendingTokensMu.Unlock()
		}
	}()
}

// AuthMux returns an http.Handler for the /auth/ routes.
func AuthMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/", handleAuth)
	return mux
}

func handleAuth(w http.ResponseWriter, r *http.Request) {
	// Parse: /auth/callback, /auth/{token}, /auth/{token}/status
	path := strings.TrimPrefix(r.URL.Path, "/auth/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	// Fixed callback endpoint — token comes from ?state= param
	if parts[0] == "callback" {
		handleAuthCallback(w, r)
		return
	}

	// Admin endpoints
	if parts[0] == "admin" {
		handleAuthAdmin(w, r, parts)
		return
	}

	token := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "":
		handleAuthRedirect(w, r, token)
	case "status":
		handleAuthStatus(w, r, token)
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

func handleAuthRedirect(w http.ResponseWriter, r *http.Request, token string) {
	pendingTokensMu.Lock()
	_, ok := pendingTokens[token]
	pendingTokensMu.Unlock()

	if !ok {
		http.Error(w, "Invalid or expired token. Please SSH in again to get a new link.", http.StatusBadRequest)
		return
	}

	clientID := os.Getenv("RC_OAUTH_CLIENT_ID")
	if clientID == "" {
		http.Error(w, "OAuth not configured", http.StatusInternalServerError)
		return
	}

	baseURL := os.Getenv("RC_OAUTH_BASE_URL")
	if baseURL == "" {
		baseURL = "https://www.recurse.com"
	}

	publicURL := os.Getenv("PUBLIC_URL")
	if publicURL == "" {
		publicURL = "https://" + r.Host
	}

	redirectURI := fmt.Sprintf("%s/auth/callback", publicURL)

	authURL := fmt.Sprintf("%s/oauth/authorize?client_id=%s&redirect_uri=%s&response_type=code&state=%s",
		baseURL,
		url.QueryEscape(clientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape(token),
	)

	http.Redirect(w, r, authURL, http.StatusFound)
}

func handleAuthCallback(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("state")
	if token == "" {
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}

	pendingTokensMu.Lock()
	pending, ok := pendingTokens[token]
	pendingTokensMu.Unlock()

	if !ok {
		http.Error(w, "Invalid or expired token. Please SSH in again to get a new link.", http.StatusBadRequest)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	clientID := os.Getenv("RC_OAUTH_CLIENT_ID")
	clientSecret := os.Getenv("RC_OAUTH_CLIENT_SECRET")
	baseURL := os.Getenv("RC_OAUTH_BASE_URL")
	if baseURL == "" {
		baseURL = "https://www.recurse.com"
	}
	publicURL := os.Getenv("PUBLIC_URL")
	if publicURL == "" {
		publicURL = "https://" + r.Host
	}

	redirectURI := fmt.Sprintf("%s/auth/callback", publicURL)

	// Exchange code for token
	tokenResp, err := http.PostForm(baseURL+"/oauth/token", url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
	})
	if err != nil {
		log.Error("OAuth token exchange failed", "error", err)
		http.Error(w, "Authentication failed. Please try again.", http.StatusInternalServerError)
		return
	}
	defer tokenResp.Body.Close()

	var tokenData struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokenData); err != nil || tokenData.AccessToken == "" {
		log.Error("Failed to parse OAuth token", "error", err)
		http.Error(w, "Authentication failed. Please try again.", http.StatusInternalServerError)
		return
	}

	// Fetch RC profile
	profileReq, _ := http.NewRequest("GET", baseURL+"/api/v1/profiles/me", nil)
	profileReq.Header.Set("Authorization", "Bearer "+tokenData.AccessToken)
	profileResp, err := http.DefaultClient.Do(profileReq)
	if err != nil {
		log.Error("Failed to fetch RC profile", "error", err)
		http.Error(w, "Could not verify your identity. Please try again.", http.StatusInternalServerError)
		return
	}
	defer profileResp.Body.Close()

	body, _ := io.ReadAll(profileResp.Body)
	var profile struct {
		ID        int    `json:"id"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	}
	if err := json.Unmarshal(body, &profile); err != nil {
		log.Error("Failed to parse RC profile", "error", err, "body", string(body))
		http.Error(w, "Could not verify your identity. Please try again.", http.StatusInternalServerError)
		return
	}

	name := strings.TrimSpace(profile.FirstName + " " + profile.LastName)
	if name == "" {
		name = "RC Member"
	}

	// Approve the key
	approveKey(pending.Fingerprint, name, profile.ID)

	// Remove the pending token
	pendingTokensMu.Lock()
	delete(pendingTokens, token)
	pendingTokensMu.Unlock()

	logAccess(AccessLogEntry{
		Event:   "auth_success",
		UserKey: pending.Fingerprint,
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><title>Authenticated</title>
<style>
body { background: #1a1b26; color: #d0d0d0; font-family: monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.box { text-align: center; }
h1 { color: #c3e88d; }
</style></head>
<body><div class="box">
<h1>Welcome, %s!</h1>
<p>Your SSH key has been verified. You can close this tab.</p>
<p style="color: #676e95;">Your terminal session will update automatically.</p>
</div></body></html>`, name)
}

func handleAuthAdmin(w http.ResponseWriter, r *http.Request, parts []string) {
	adminToken := os.Getenv("ADMIN_TOKEN")
	if adminToken == "" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	auth := r.Header.Get("Authorization")
	if auth != "Bearer "+adminToken {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch action {
	case "clear-keys":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		approvedKeysMu.Lock()
		count := len(approvedKeys)
		approvedKeys = make(map[string]ApprovedKey)
		approvedKeysMu.Unlock()
		saveApprovedKeys()

		logAccess(AccessLogEntry{
			Event: "admin_clear_keys",
		})
		log.Info("Admin cleared all approved keys", "count", count)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"cleared": count,
		})
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request, token string) {
	pendingTokensMu.Lock()
	pending, pendingOk := pendingTokens[token]
	pendingTokensMu.Unlock()

	w.Header().Set("Content-Type", "application/json")

	if !pendingOk {
		// Token gone — either expired or already approved. Check if the fingerprint is approved.
		// We can't know the fingerprint from the token alone if it's been purged,
		// so return approved=false and let the TUI handle reconnection.
		json.NewEncoder(w).Encode(map[string]interface{}{"approved": false, "expired": true})
		return
	}

	approved, ok := IsKeyApproved(pending.Fingerprint)
	if ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"approved": true,
			"name":     approved.Name,
		})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{"approved": false})
	}
}
