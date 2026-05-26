package main

import (
	"encoding/json"
	"os"

	"github.com/charmbracelet/ssh"
	"github.com/charmbracelet/wish"
)

// InfoResponse is the JSON returned by `ssh host info`.
type InfoResponse struct {
	Name       string      `json:"name"`
	Tagline    string      `json:"tagline,omitempty"`
	Exhibition string      `json:"exhibition,omitempty"`
	Hours      interface{} `json:"hours,omitempty"`
	Status     string      `json:"status"`
	Artworks   int         `json:"artworks"`
}

func handleInfo(s ssh.Session) {
	raw, err := os.ReadFile("../gallery/config.json")
	if err != nil {
		wish.Println(s, `{"error":"could not read gallery config"}`)
		return
	}

	var config map[string]interface{}
	if err := json.Unmarshal(raw, &config); err != nil {
		wish.Println(s, `{"error":"invalid gallery config"}`)
		return
	}

	// Count artwork directories
	artworkCount := 0
	entries, err := os.ReadDir("../gallery")
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				artworkCount++
			}
		}
	}

	// Determine status from hours config
	status := "open"
	hours := config["hours"]
	if hours != nil {
		if s, ok := hours.(string); ok && s == "closed" {
			status = "closed"
		} else {
			// Has scheduled hours — we report "scheduled" and let the client
			// check the hours rules. Full open/closed calculation requires
			// timezone logic that lives in the TUI.
			status = "scheduled"
		}
	}

	info := InfoResponse{
		Name:       stringOr(config, "name", "mussheum"),
		Tagline:    stringOr(config, "tagline", ""),
		Exhibition: stringOr(config, "exhibition", ""),
		Hours:      hours,
		Status:     status,
		Artworks:   artworkCount,
	}

	out, _ := json.MarshalIndent(info, "", "  ")
	wish.Println(s, string(out))
}

func stringOr(m map[string]interface{}, key, fallback string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return fallback
}
