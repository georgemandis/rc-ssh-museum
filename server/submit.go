package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/gif"
	_ "image/png"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/charmbracelet/log"
	"github.com/charmbracelet/ssh"
	"github.com/charmbracelet/wish"
	gossh "golang.org/x/crypto/ssh"
)

const (
	maxZipSize        = 10 * 1024 * 1024 // 10 MB
	maxImageDimension = 2000
	maxImageFileSize  = 5 * 1024 * 1024 // 5 MB
	submitRateWindow  = 1 * time.Hour
	submitRateLimit   = 3 // max submissions per key per window
)

// SubmissionMeta is the expected schema of meta.json inside the zip.
type SubmissionMeta struct {
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Statement string `json:"statement"`
	URL       string `json:"url,omitempty"`
	ArtistURL string `json:"artistUrl,omitempty"`
	Email     string `json:"email,omitempty"`
}

// Rate limiter per SSH key fingerprint.
var (
	submitRates   = make(map[string][]time.Time)
	submitRateMu  sync.Mutex
)

func checkSubmitRate(fingerprint string) bool {
	submitRateMu.Lock()
	defer submitRateMu.Unlock()

	now := time.Now()
	cutoff := now.Add(-submitRateWindow)

	// Prune old entries
	times := submitRates[fingerprint]
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	submitRates[fingerprint] = valid

	if len(valid) >= submitRateLimit {
		return false
	}

	submitRates[fingerprint] = append(valid, now)
	return true
}

func newR2Client() (*s3.Client, string, error) {
	endpoint := os.Getenv("R2_ENDPOINT")
	bucket := os.Getenv("R2_BUCKET")
	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")

	if endpoint == "" || bucket == "" || accessKey == "" || secretKey == "" {
		return nil, "", fmt.Errorf("R2 credentials not configured")
	}

	client := s3.New(s3.Options{
		BaseEndpoint:  &endpoint,
		Region:        "auto",
		Credentials:   credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		UsePathStyle:  true,
	})

	return client, bucket, nil
}

// commandMiddleware intercepts non-PTY commands before activeterm rejects them.
func commandMiddleware() wish.Middleware {
	return func(next ssh.Handler) ssh.Handler {
		return func(s ssh.Session) {
			cmd := s.Command() // used only for command routing, not shell passthrough
			if len(cmd) > 0 {
				switch cmd[0] {
				case "submit":
					handleSubmission(s)
					return
				case "info":
					handleInfo(s)
					return
				}
			}
			next(s)
		}
	}
}

func handleSubmission(s ssh.Session) {
	userKey := "anonymous"
	if s.PublicKey() != nil {
		userKey = gossh.FingerprintSHA256(s.PublicKey())
	}
	remoteAddr := s.RemoteAddr().String()

	logAccess(AccessLogEntry{
		Event:      "submit_start",
		UserKey:    userKey,
		RemoteAddr: remoteAddr,
	})

	// Rate limit
	if !checkSubmitRate(userKey) {
		wish.Println(s, "Rate limit exceeded. Please try again later.")
		logAccess(AccessLogEntry{
			Event:      "submit_rejected",
			UserKey:    userKey,
			RemoteAddr: remoteAddr,
			Error:      "rate_limit",
		})
		return
	}

	// Read stdin (the piped zip file)
	wish.Println(s, "Reading submission...")
	limitedReader := io.LimitReader(s, maxZipSize+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		wish.Println(s, "Error reading input: "+err.Error())
		logAccess(AccessLogEntry{
			Event:      "submit_error",
			UserKey:    userKey,
			RemoteAddr: remoteAddr,
			Error:      "read_stdin: " + err.Error(),
		})
		return
	}

	if len(data) == 0 {
		wish.Println(s, "No data received. Usage: ssh <host> submit < submission.zip")
		return
	}

	if len(data) > maxZipSize {
		wish.Println(s, fmt.Sprintf("Submission too large (max %d MB).", maxZipSize/(1024*1024)))
		return
	}

	// Parse zip
	zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		wish.Println(s, "Invalid zip file.")
		logAccess(AccessLogEntry{
			Event:      "submit_error",
			UserKey:    userKey,
			RemoteAddr: remoteAddr,
			Error:      "invalid_zip",
		})
		return
	}

	// Validate contents
	meta, imageFile, imageExt, err := validateZip(zipReader)
	if err != nil {
		wish.Println(s, "Validation failed: "+err.Error())
		logAccess(AccessLogEntry{
			Event:      "submit_error",
			UserKey:    userKey,
			RemoteAddr: remoteAddr,
			Error:      "validation: " + err.Error(),
		})
		return
	}

	wish.Println(s, fmt.Sprintf("Validated: \"%s\" by %s", meta.Title, meta.Artist))

	// Upload to R2
	client, bucket, err := newR2Client()
	if err != nil {
		wish.Println(s, "Submission storage is not configured. Please try again later.")
		log.Error("R2 client error", "error", err)
		return
	}

	timestamp := time.Now().UTC().Format("20060102-150405")
	prefix := fmt.Sprintf("submissions/%s-%s", timestamp, sanitizeFilename(meta.Artist))

	ctx := context.Background()

	// Upload meta.json
	metaJSON, _ := json.MarshalIndent(meta, "", "  ")
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &bucket,
		Key:         aws.String(prefix + "/meta.json"),
		Body:        bytes.NewReader(metaJSON),
		ContentType: aws.String("application/json"),
	})
	if err != nil {
		wish.Println(s, "Upload failed. Please try again later.")
		log.Error("R2 upload error (meta)", "error", err)
		return
	}

	// Upload image
	imageContentType := "image/png"
	switch imageExt {
	case ".jpg", ".jpeg":
		imageContentType = "image/jpeg"
	case ".gif":
		imageContentType = "image/gif"
	}
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &bucket,
		Key:         aws.String(prefix + "/artwork" + imageExt),
		Body:        bytes.NewReader(imageFile),
		ContentType: aws.String(imageContentType),
	})
	if err != nil {
		wish.Println(s, "Upload failed. Please try again later.")
		log.Error("R2 upload error (image)", "error", err)
		return
	}

	// Upload original zip for reference
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &bucket,
		Key:         aws.String(prefix + "/submission.zip"),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("application/zip"),
	})
	if err != nil {
		log.Warn("R2 upload error (zip backup)", "error", err)
		// Non-fatal — meta and image are uploaded
	}

	wish.Println(s, "Submission uploaded successfully! We'll review it soon.")
	logAccess(AccessLogEntry{
		Event:      "submit_success",
		UserKey:    userKey,
		RemoteAddr: remoteAddr,
		SessionID:  prefix,
	})
}

func validateZip(zr *zip.Reader) (*SubmissionMeta, []byte, string, error) {
	var metaFile *zip.File
	var imgFile *zip.File
	var imgExt string

	for _, f := range zr.File {
		name := f.Name
		// Skip directories and macOS resource forks
		if f.FileInfo().IsDir() || strings.HasPrefix(name, "__MACOSX") || strings.HasPrefix(path.Base(name), ".") {
			continue
		}

		base := strings.ToLower(path.Base(name))

		if base == "meta.json" {
			metaFile = f
		} else {
			ext := strings.ToLower(path.Ext(base))
			if ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" {
				if imgFile != nil {
					return nil, nil, "", fmt.Errorf("zip contains multiple images — include exactly one")
				}
				imgFile = f
				imgExt = ext
			}
		}
	}

	if metaFile == nil {
		return nil, nil, "", fmt.Errorf("missing meta.json")
	}
	if imgFile == nil {
		return nil, nil, "", fmt.Errorf("missing image file (png, jpg, or gif)")
	}

	// Parse meta.json
	mf, err := metaFile.Open()
	if err != nil {
		return nil, nil, "", fmt.Errorf("cannot read meta.json: %w", err)
	}
	defer mf.Close()

	var meta SubmissionMeta
	if err := json.NewDecoder(mf).Decode(&meta); err != nil {
		return nil, nil, "", fmt.Errorf("invalid meta.json: %w", err)
	}

	if meta.Title == "" {
		return nil, nil, "", fmt.Errorf("meta.json: title is required")
	}
	if meta.Artist == "" {
		return nil, nil, "", fmt.Errorf("meta.json: artist is required")
	}
	if meta.Statement == "" {
		return nil, nil, "", fmt.Errorf("meta.json: statement is required")
	}

	// Read and validate image
	imgReader, err := imgFile.Open()
	if err != nil {
		return nil, nil, "", fmt.Errorf("cannot read image: %w", err)
	}
	defer imgReader.Close()

	imgData, err := io.ReadAll(io.LimitReader(imgReader, maxImageFileSize+1))
	if err != nil {
		return nil, nil, "", fmt.Errorf("cannot read image: %w", err)
	}
	if len(imgData) > maxImageFileSize {
		return nil, nil, "", fmt.Errorf("image too large (max %d MB)", maxImageFileSize/(1024*1024))
	}

	// Decode to check dimensions
	cfg, _, err := image.DecodeConfig(bytes.NewReader(imgData))
	if err != nil {
		return nil, nil, "", fmt.Errorf("cannot decode image: %w", err)
	}
	if cfg.Width > maxImageDimension || cfg.Height > maxImageDimension {
		return nil, nil, "", fmt.Errorf("image dimensions %dx%d exceed max %dx%d", cfg.Width, cfg.Height, maxImageDimension, maxImageDimension)
	}

	return &meta, imgData, imgExt, nil
}

func sanitizeFilename(s string) string {
	s = strings.ToLower(s)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		if r == ' ' {
			return '-'
		}
		return -1
	}, s)
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}
