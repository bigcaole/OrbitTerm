package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	traceIDContextKey                  = "traceID"
	traceIDHeader                      = "X-Trace-Id"
	syncPushIdempotencyHeader          = "X-Idempotency-Key"
	syncOperationPush                  = "push"
	syncOperationPull                  = "pull"
	syncOperationStatus                = "status"
	syncOperationUnknown               = "unknown"
	syncEventResultOK                  = "ok"
	syncEventResultFailed              = "failed"
	syncEventResultConflict            = "conflict"
	syncErrorCodeAuthRequired          = "SYNC_AUTH_REQUIRED"
	syncErrorCodeTokenInvalid          = "SYNC_TOKEN_INVALID"
	syncErrorCodeAuthCheckFailed       = "SYNC_AUTH_CHECK_FAILED"
	syncErrorCodeDeviceRevoked         = "SYNC_DEVICE_REVOKED"
	syncErrorCodeLicenseInactive       = "SYNC_LICENSE_INACTIVE"
	syncErrorCodeLicenseCheckFailed    = "SYNC_LICENSE_CHECK_FAILED"
	syncErrorCodeRateLimited           = "SYNC_RATE_LIMITED"
	syncErrorCodeHTTPSRequired         = "SYNC_HTTPS_REQUIRED"
	syncErrorCodeBodyTooLarge          = "SYNC_BODY_TOO_LARGE"
	syncErrorCodeInvalidRequest        = "SYNC_INVALID_REQUEST"
	syncErrorCodeInvalidVersion        = "SYNC_INVALID_VERSION"
	syncErrorCodeInvalidBlob           = "SYNC_INVALID_BLOB"
	syncErrorCodeInvalidIdempotencyKey = "SYNC_INVALID_IDEMPOTENCY_KEY"
	syncErrorCodeIdempotencyReused     = "SYNC_IDEMPOTENCY_KEY_REUSED"
	syncErrorCodeUploadFailed          = "SYNC_UPLOAD_FAILED"
	syncErrorCodePullFailed            = "SYNC_PULL_FAILED"
	syncErrorCodeStatusFailed          = "SYNC_STATUS_FAILED"
	syncErrorCodeVersionConflict       = "SYNC_VERSION_CONFLICT"
)

type syncEventVersions struct {
	RequestVersion  *int64
	AcceptedVersion *int64
	RemoteVersion   *int64
}

type syncEventRecord struct {
	TraceID        string
	UserID         string
	UserEmail      string
	Operation      string
	Result         string
	ErrorCode      string
	Message        string
	HTTPStatus     int
	Versions       syncEventVersions
	IdempotencyKey string
}

type syncErrorResponse struct {
	Message   string `json:"message"`
	Code      string `json:"code,omitempty"`
	TraceID   string `json:"traceId,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
}

func (a *app) traceIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		traceID := generateTraceID()
		c.Set(traceIDContextKey, traceID)
		c.Header(traceIDHeader, traceID)
		c.Next()
	}
}

func generateTraceID() string {
	var buf [12]byte
	if _, err := rand.Read(buf[:]); err != nil {
		fallback := strconv.FormatInt(time.Now().UTC().UnixNano(), 16)
		return "trc-" + fallback
	}
	return "trc-" + hex.EncodeToString(buf[:])
}

func traceIDFromContext(c *gin.Context) string {
	if c == nil {
		return generateTraceID()
	}
	value := strings.TrimSpace(c.GetString(traceIDContextKey))
	if value == "" {
		value = generateTraceID()
		c.Set(traceIDContextKey, value)
	}
	c.Header(traceIDHeader, value)
	return value
}

func syncOperationFromPath(path string) string {
	normalized := strings.TrimSpace(strings.ToLower(path))
	switch {
	case strings.Contains(normalized, "/sync/push"):
		return syncOperationPush
	case strings.Contains(normalized, "/sync/pull"):
		return syncOperationPull
	case strings.Contains(normalized, "/sync/status"):
		return syncOperationStatus
	default:
		return syncOperationUnknown
	}
}

func isSyncRequest(c *gin.Context) bool {
	if c == nil || c.Request == nil || c.Request.URL == nil {
		return false
	}
	fullPath := strings.TrimSpace(c.FullPath())
	if strings.HasPrefix(fullPath, "/sync") {
		return true
	}
	return strings.HasPrefix(strings.TrimSpace(c.Request.URL.Path), "/sync")
}

func (a *app) writeSyncError(
	c *gin.Context,
	operation string,
	status int,
	code string,
	message string,
	retryable bool,
	versions syncEventVersions,
) {
	if c == nil {
		return
	}
	traceID := traceIDFromContext(c)
	userID := strings.TrimSpace(c.GetString("userID"))
	userEmail := strings.TrimSpace(c.GetString("username"))

	a.recordSyncEvent(c.Request.Context(), syncEventRecord{
		TraceID:    traceID,
		UserID:     userID,
		UserEmail:  userEmail,
		Operation:  operation,
		Result:     syncEventResultFailed,
		ErrorCode:  code,
		Message:    message,
		HTTPStatus: status,
		Versions:   versions,
	})
	c.AbortWithStatusJSON(status, syncErrorResponse{
		Message:   message,
		Code:      code,
		TraceID:   traceID,
		Retryable: retryable,
	})
}

func (a *app) recordSyncEvent(ctx context.Context, record syncEventRecord) {
	operation := strings.TrimSpace(record.Operation)
	if operation == "" || operation == syncOperationUnknown {
		return
	}
	result := strings.TrimSpace(record.Result)
	if result == "" {
		result = syncEventResultOK
	}
	traceID := strings.TrimSpace(record.TraceID)
	if traceID == "" {
		traceID = generateTraceID()
	}

	writeCtx := ctx
	if writeCtx == nil {
		writeCtx = context.Background()
	}
	boundedCtx, cancel := context.WithTimeout(writeCtx, 2*time.Second)
	defer cancel()

	_, err := a.db.ExecContext(
		boundedCtx,
		`INSERT INTO sync_event_logs (
			trace_id,
			user_id,
			user_email,
			operation,
			result,
			error_code,
			message,
			http_status,
			request_version,
			accepted_version,
			remote_version,
			idempotency_key
		 ) VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		traceID,
		strings.TrimSpace(record.UserID),
		strings.TrimSpace(record.UserEmail),
		operation,
		result,
		strings.TrimSpace(record.ErrorCode),
		strings.TrimSpace(record.Message),
		record.HTTPStatus,
		record.Versions.RequestVersion,
		record.Versions.AcceptedVersion,
		record.Versions.RemoteVersion,
		strings.TrimSpace(record.IdempotencyKey),
	)
	if err != nil {
		log.Printf("[sync-event] write failed: op=%s trace=%s err=%v", operation, traceID, err)
	}
}

func normalizeIdempotencyKey(raw string) (string, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", nil
	}
	if len(key) < 8 || len(key) > 128 {
		return "", errors.New("invalid key length")
	}
	for i := 0; i < len(key); i++ {
		ch := key[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
			continue
		}
		switch ch {
		case '-', '_', '.', ':':
			continue
		default:
			return "", errors.New("invalid key char")
		}
	}
	return key, nil
}

func buildSyncPushRequestHash(version int64, blob []byte) string {
	hasher := sha256.New()
	hasher.Write([]byte(strconv.FormatInt(version, 10)))
	hasher.Write([]byte{':'})
	hasher.Write(blob)
	return hex.EncodeToString(hasher.Sum(nil))
}

func shouldCleanupSyncIdempotency(now time.Time) bool {
	return now.UTC().Minute()%15 == 0
}

func (a *app) cleanupSyncIdempotency(ctx context.Context) {
	if a == nil || a.db == nil {
		return
	}
	cleanupCtx := ctx
	if cleanupCtx == nil {
		cleanupCtx = context.Background()
	}
	boundedCtx, cancel := context.WithTimeout(cleanupCtx, 2*time.Second)
	defer cancel()
	_, _ = a.db.ExecContext(
		boundedCtx,
		`DELETE FROM sync_push_idempotency WHERE created_at < (NOW() - INTERVAL '7 days')`,
	)
}

func writeSyncConflict(
	c *gin.Context,
	message string,
	traceID string,
	latest syncPullResponse,
) {
	c.JSON(http.StatusConflict, syncConflictResponse{
		Message:   message,
		Code:      syncErrorCodeVersionConflict,
		TraceID:   traceID,
		Retryable: false,
		Latest:    latest,
	})
}
