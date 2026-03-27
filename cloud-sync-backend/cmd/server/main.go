package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

type config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	JWTExpireHours      int
	AllowInsecureHTTP   bool
	CORSAllowOrigins    string
	MaxRequestBodyBytes int64
	AuthRateLimitPerMin int
	SyncRateLimitPerMin int
}

type app struct {
	cfg         config
	db          *sql.DB
	authLimiter *rateLimiter
	syncLimiter *rateLimiter
}

type rateLimiter struct {
	limitPerWindow int
	window         time.Duration
	mu             sync.Mutex
	buckets        map[string]*rateLimitBucket
}

type rateLimitBucket struct {
	windowStart time.Time
	count       int
}

type registerRequest struct {
	Email          string `json:"email" binding:"required,email"`
	Password       string `json:"password" binding:"required,min=8,max=128"`
	DeviceName     string `json:"deviceName"`
	DeviceLocation string `json:"deviceLocation"`
}

type loginRequest struct {
	Email          string `json:"email" binding:"required,email"`
	Password       string `json:"password" binding:"required,min=8,max=128"`
	DeviceName     string `json:"deviceName"`
	DeviceLocation string `json:"deviceLocation"`
}

type authResponse struct {
	Token           string       `json:"token"`
	User            authUserInfo `json:"user"`
	CurrentDeviceID string       `json:"currentDeviceId"`
}

type authUserInfo struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type syncPushRequest struct {
	Version             any    `json:"version"`
	EncryptedBlobBase64 string `json:"encryptedBlobBase64"`
}

type syncPushResponse struct {
	AcceptedVersion int64  `json:"acceptedVersion"`
	UpdatedAt       string `json:"updatedAt"`
}

type syncPullResponse struct {
	HasData             bool   `json:"hasData"`
	Version             int64  `json:"version,omitempty"`
	EncryptedBlobBase64 string `json:"encryptedBlobBase64,omitempty"`
	UpdatedAt           string `json:"updatedAt,omitempty"`
}

type syncStatusResponse struct {
	HasData   bool   `json:"hasData"`
	Version   int64  `json:"version"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type syncConflictResponse struct {
	Message string           `json:"message"`
	Latest  syncPullResponse `json:"latest"`
}

type logoutDeviceRequest struct {
	DeviceID  string `json:"deviceId"`
	RevokeAll bool   `json:"revokeAll"`
}

type logoutDeviceResponse struct {
	RevokedCount int64  `json:"revokedCount"`
	Message      string `json:"message"`
}

type userDeviceItem struct {
	ID             string `json:"id"`
	DeviceName     string `json:"deviceName"`
	DeviceLocation string `json:"deviceLocation"`
	UserAgent      string `json:"userAgent"`
	LastSeenAt     string `json:"lastSeenAt"`
	CreatedAt      string `json:"createdAt"`
	IsCurrent      bool   `json:"isCurrent"`
}

type userDevicesResponse struct {
	Devices []userDeviceItem `json:"devices"`
}

type jwtClaims struct {
	jwt.RegisteredClaims
	Username string `json:"username"`
	DeviceID string `json:"deviceId"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("配置加载失败: %v", err)
	}

	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("数据库连接初始化失败: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	if err := ensureSchema(ctx, db); err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	a := &app{
		cfg:         cfg,
		db:          db,
		authLimiter: newRateLimiter(cfg.AuthRateLimitPerMin, time.Minute),
		syncLimiter: newRateLimiter(cfg.SyncRateLimitPerMin, time.Minute),
	}
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(a.httpsOnlyMiddleware())
	router.Use(a.corsMiddleware())
	router.Use(requestBodyLimitMiddleware(cfg.MaxRequestBodyBytes))

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	router.POST(
		"/register",
		a.rateLimitMiddleware(a.authLimiter, "请求过于频繁，请稍后再试。"),
		a.handleRegister,
	)
	router.POST(
		"/login",
		a.rateLimitMiddleware(a.authLimiter, "请求过于频繁，请稍后再试。"),
		a.handleLogin,
	)

	syncGroup := router.Group("/sync")
	syncGroup.Use(a.jwtAuthMiddleware())
	syncGroup.Use(a.rateLimitMiddleware(a.syncLimiter, "同步请求过于频繁，请稍后重试。"))
	syncGroup.GET("/status", a.handleSyncStatus)
	syncGroup.POST("/push", a.handleSyncPush)
	syncGroup.GET("/pull", a.handleSyncPull)

	accountGroup := router.Group("/")
	accountGroup.Use(a.jwtAuthMiddleware())
	accountGroup.GET("/devices", a.handleDevices)
	accountGroup.POST("/logout/device", a.handleLogoutDevice)

	addr := ":" + cfg.Port
	log.Printf("OrbitTerm 私有云同步服务已启动: %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

func ensureSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
		`CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS vault_blobs (
			user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
			encrypted_blob BYTEA NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS snippets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			command TEXT NOT NULL,
			tags TEXT[] NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS user_devices (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			device_name TEXT NOT NULL,
			device_location TEXT NOT NULL DEFAULT '未知地区',
			user_agent TEXT NOT NULL DEFAULT 'unknown',
			device_fingerprint TEXT NOT NULL,
			current_token_jti TEXT,
			token_expires_at TIMESTAMPTZ,
			last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			revoked_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_vault_blobs_updated_at ON vault_blobs(updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_vault_blobs_version ON vault_blobs(version)`,
		`CREATE INDEX IF NOT EXISTS idx_snippets_user_updated_at ON snippets(user_id, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_snippets_tags_gin ON snippets USING GIN(tags)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_user_fingerprint ON user_devices(user_id, device_fingerprint)`,
		`CREATE INDEX IF NOT EXISTS idx_user_devices_user_last_seen ON user_devices(user_id, last_seen_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_user_devices_token_jti ON user_devices(current_token_jti)`,
	}

	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func loadConfig() (config, error) {
	cfg := config{
		Port:                readEnv("PORT", "8080"),
		DatabaseURL:         strings.TrimSpace(os.Getenv("DATABASE_URL")),
		JWTSecret:           strings.TrimSpace(os.Getenv("JWT_SECRET")),
		CORSAllowOrigins:    readEnv("CORS_ALLOW_ORIGINS", "*"),
		MaxRequestBodyBytes: readEnvInt64("MAX_REQUEST_BODY_BYTES", 4*1024*1024),
		AuthRateLimitPerMin: readEnvInt("AUTH_RATE_LIMIT_PER_MIN", 30),
		SyncRateLimitPerMin: readEnvInt("SYNC_RATE_LIMIT_PER_MIN", 120),
	}

	expireHours := readEnv("JWT_EXPIRE_HOURS", "720")
	parsedExpireHours, err := strconv.Atoi(expireHours)
	if err != nil || parsedExpireHours <= 0 {
		return config{}, errors.New("JWT_EXPIRE_HOURS 必须为正整数")
	}
	cfg.JWTExpireHours = parsedExpireHours

	allowInsecure := strings.EqualFold(readEnv("ALLOW_INSECURE_HTTP", "false"), "true")
	cfg.AllowInsecureHTTP = allowInsecure

	if cfg.DatabaseURL == "" {
		return config{}, errors.New("DATABASE_URL 未设置")
	}
	if cfg.JWTSecret == "" {
		return config{}, errors.New("JWT_SECRET 未设置")
	}
	if len(cfg.JWTSecret) < 32 {
		return config{}, errors.New("JWT_SECRET 长度至少需要 32 字节")
	}
	if cfg.MaxRequestBodyBytes <= 0 {
		return config{}, errors.New("MAX_REQUEST_BODY_BYTES 必须为正整数")
	}
	if cfg.AuthRateLimitPerMin <= 0 || cfg.SyncRateLimitPerMin <= 0 {
		return config{}, errors.New("AUTH_RATE_LIMIT_PER_MIN 与 SYNC_RATE_LIMIT_PER_MIN 必须为正整数")
	}

	return cfg, nil
}

func readEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func readEnvInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func readEnvInt64(key string, fallback int64) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func newRateLimiter(limitPerWindow int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limitPerWindow: limitPerWindow,
		window:         window,
		buckets:        make(map[string]*rateLimitBucket),
	}
}

func (r *rateLimiter) allow(key string) bool {
	if r == nil {
		return true
	}
	now := time.Now().UTC()

	r.mu.Lock()
	defer r.mu.Unlock()

	bucket, ok := r.buckets[key]
	if !ok {
		r.buckets[key] = &rateLimitBucket{
			windowStart: now,
			count:       1,
		}
		return true
	}

	if now.Sub(bucket.windowStart) >= r.window {
		bucket.windowStart = now
		bucket.count = 1
		return true
	}

	if bucket.count >= r.limitPerWindow {
		return false
	}
	bucket.count += 1
	return true
}

func (a *app) rateLimitMiddleware(limiter *rateLimiter, message string) gin.HandlerFunc {
	return func(c *gin.Context) {
		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}
		key := c.ClientIP() + "|" + route
		if limiter.allow(key) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
			"message": message,
		})
	}
}

func requestBodyLimitMiddleware(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > limit {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"message": "请求体过大，请精简后重试。",
			})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	}
}

func isRequestBodyTooLarge(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "request body too large")
}

func (a *app) httpsOnlyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if a.cfg.AllowInsecureHTTP {
			c.Next()
			return
		}

		isTLS := c.Request.TLS != nil
		forwardedProto := strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
		forwardedSSL := strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Ssl")), "on")
		if isTLS || forwardedProto || forwardedSSL {
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{
			"message": "同步服务仅接受 HTTPS 请求，请检查反向代理与证书配置。",
		})
	}
}

func (a *app) corsMiddleware() gin.HandlerFunc {
	allowOrigins := strings.TrimSpace(a.cfg.CORSAllowOrigins)
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" {
			if allowOrigins == "*" {
				c.Header("Access-Control-Allow-Origin", "*")
			} else {
				for _, item := range strings.Split(allowOrigins, ",") {
					if strings.EqualFold(strings.TrimSpace(item), origin) {
						c.Header("Access-Control-Allow-Origin", origin)
						break
					}
				}
			}
			c.Header("Vary", "Origin")
		}

		c.Header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization,Content-Type")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

type deviceMeta struct {
	name        string
	location    string
	userAgent   string
	fingerprint string
}

func normalizeDeviceName(deviceName, userAgent string) string {
	name := strings.TrimSpace(deviceName)
	if name != "" {
		return name
	}
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "未知设备"
	}
	parts := strings.Split(ua, " ")
	if len(parts) == 0 {
		return "未知设备"
	}
	head := strings.TrimSpace(parts[0])
	if head == "" {
		return "未知设备"
	}
	return head
}

func normalizeLocation(raw string) string {
	location := strings.TrimSpace(raw)
	if location == "" {
		return "未知地区"
	}
	return location
}

func buildDeviceFingerprint(deviceName, userAgent string) string {
	raw := strings.ToLower(strings.TrimSpace(deviceName) + "|" + strings.TrimSpace(userAgent))
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomTokenID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

func extractDeviceMeta(c *gin.Context, reqDeviceName, reqDeviceLocation string) deviceMeta {
	headerDeviceName := strings.TrimSpace(c.GetHeader("X-Device-Name"))
	headerDeviceLocation := strings.TrimSpace(c.GetHeader("X-Device-Location"))
	userAgent := strings.TrimSpace(c.GetHeader("User-Agent"))
	if userAgent == "" {
		userAgent = "unknown"
	}

	finalDeviceName := normalizeDeviceName(firstNonEmpty(reqDeviceName, headerDeviceName), userAgent)
	finalLocation := normalizeLocation(firstNonEmpty(reqDeviceLocation, headerDeviceLocation))

	return deviceMeta{
		name:        finalDeviceName,
		location:    finalLocation,
		userAgent:   userAgent,
		fingerprint: buildDeviceFingerprint(finalDeviceName, userAgent),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (a *app) issueTokenForDevice(
	ctx context.Context,
	userID string,
	email string,
	meta deviceMeta,
) (token string, deviceID string, err error) {
	tokenID, err := randomTokenID()
	if err != nil {
		return "", "", err
	}

	expireAt := time.Now().UTC().Add(time.Duration(a.cfg.JWTExpireHours) * time.Hour)
	queryErr := a.db.QueryRowContext(
		ctx,
		`INSERT INTO user_devices (
		   user_id,
		   device_name,
		   device_location,
		   user_agent,
		   device_fingerprint,
		   current_token_jti,
		   token_expires_at,
		   last_seen_at,
		   revoked_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
		 ON CONFLICT (user_id, device_fingerprint) DO UPDATE
		 SET device_name = EXCLUDED.device_name,
		     device_location = EXCLUDED.device_location,
		     user_agent = EXCLUDED.user_agent,
		     current_token_jti = EXCLUDED.current_token_jti,
		     token_expires_at = EXCLUDED.token_expires_at,
		     last_seen_at = NOW(),
		     revoked_at = NULL
		 RETURNING id`,
		userID,
		meta.name,
		meta.location,
		meta.userAgent,
		meta.fingerprint,
		tokenID,
		expireAt,
	).Scan(&deviceID)
	if queryErr != nil {
		return "", "", queryErr
	}

	token, err = a.signJWT(userID, email, deviceID, tokenID, expireAt)
	if err != nil {
		return "", "", err
	}

	return token, deviceID, nil
}

func (a *app) handleRegister(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		if isRequestBodyTooLarge(err) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "请求体过大，请精简后重试。"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": "注册参数无效，请检查邮箱与密码。"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "密码处理失败，请稍后重试。"})
		return
	}

	var userID string
	err = a.db.QueryRowContext(
		c.Request.Context(),
		`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
		email,
		string(hashBytes),
	).Scan(&userID)
	if err != nil {
		log.Printf("[register] insert user failed: email=%s ip=%s err=%v", email, c.ClientIP(), err)
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") || strings.Contains(err.Error(), "23505") {
			c.JSON(http.StatusConflict, gin.H{"message": "该邮箱已注册，请直接登录。"})
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), `relation "users" does not exist`) {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "数据库表不存在，请检查初始化步骤。"})
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "gen_random_uuid") {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "数据库缺少 pgcrypto 扩展，请联系管理员。"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "创建账号失败，请稍后重试。"})
		return
	}

	meta := extractDeviceMeta(c, req.DeviceName, req.DeviceLocation)
	token, deviceID, err := a.issueTokenForDevice(c.Request.Context(), userID, email, meta)
	if err != nil {
		log.Printf("[register] issue token failed: user=%s email=%s err=%v", userID, email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"message": "登录令牌生成失败。"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		Token: token,
		User: authUserInfo{
			ID:    userID,
			Email: email,
		},
		CurrentDeviceID: deviceID,
	})
}

func (a *app) handleLogin(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		if isRequestBodyTooLarge(err) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "请求体过大，请精简后重试。"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": "登录参数无效，请检查邮箱与密码。"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	var userID, passwordHash string
	err := a.db.QueryRowContext(
		c.Request.Context(),
		`SELECT id, password_hash FROM users WHERE email = $1`,
		email,
	).Scan(&userID, &passwordHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "账号或密码错误。"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "登录失败，请稍后重试。"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "账号或密码错误。"})
		return
	}

	meta := extractDeviceMeta(c, req.DeviceName, req.DeviceLocation)
	token, deviceID, err := a.issueTokenForDevice(c.Request.Context(), userID, email, meta)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "登录令牌生成失败。"})
		return
	}

	c.JSON(http.StatusOK, authResponse{
		Token: token,
		User: authUserInfo{
			ID:    userID,
			Email: email,
		},
		CurrentDeviceID: deviceID,
	})
}

type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func loadLatestSyncFromQuerier(
	ctx context.Context,
	querier rowQuerier,
	userID string,
) (syncPullResponse, error) {
	var version int64
	var encodedBlob string
	var updatedAt time.Time
	err := querier.QueryRowContext(
		ctx,
		`SELECT version, encode(encrypted_blob, 'base64'), updated_at
		 FROM vault_blobs WHERE user_id = $1`,
		userID,
	).Scan(&version, &encodedBlob, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return syncPullResponse{
				HasData: false,
				Version: 0,
			}, nil
		}
		return syncPullResponse{}, err
	}

	return syncPullResponse{
		HasData:             true,
		Version:             version,
		EncryptedBlobBase64: encodedBlob,
		UpdatedAt:           updatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func (a *app) handleSyncStatus(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	latest, err := loadLatestSyncFromQuerier(c.Request.Context(), a.db, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "查询同步状态失败，请稍后重试。"})
		return
	}

	c.JSON(http.StatusOK, syncStatusResponse{
		HasData:   latest.HasData,
		Version:   latest.Version,
		UpdatedAt: latest.UpdatedAt,
	})
}

func parseSyncPushVersion(raw any) (int64, error) {
	switch v := raw.(type) {
	case nil:
		return 0, nil
	case int:
		return int64(v), nil
	case int32:
		return int64(v), nil
	case int64:
		return v, nil
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Trunc(v) != v {
			return 0, errors.New("invalid version")
		}
		return int64(v), nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, nil
		}
		parsed, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, errors.New("invalid version type")
	}
}

func (a *app) handleSyncPush(c *gin.Context) {
	userID := c.GetString("userID")
	username := c.GetString("username")
	if userID == "" || username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	var req syncPushRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		if isRequestBodyTooLarge(err) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "请求体过大，请精简后重试。"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": "同步参数无效，请检查版本号和数据。"})
		return
	}
	reqVersion, versionErr := parseSyncPushVersion(req.Version)
	if versionErr != nil || reqVersion < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "同步参数无效，请检查版本号和数据。"})
		return
	}
	reqBlob := strings.TrimSpace(req.EncryptedBlobBase64)
	if reqBlob == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "同步参数无效，请检查版本号和数据。"})
		return
	}

	rawBlob, err := base64.StdEncoding.DecodeString(reqBlob)
	if err != nil || len(rawBlob) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "加密数据格式错误。"})
		return
	}

	// 服务器端权威时间：忽略客户端时间，统一使用 UTC 当前时间。
	serverUpdatedAt := time.Now().UTC()
	tx, err := a.db.BeginTx(c.Request.Context(), &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var acceptedVersion int64
	var acceptedUpdatedAt time.Time
	updateErr := tx.QueryRowContext(
		c.Request.Context(),
		`UPDATE vault_blobs AS vb
		 SET encrypted_blob = $1,
		     version = vb.version + 1,
		     updated_at = $2
		 FROM users AS u
		 WHERE vb.user_id = u.id
		   AND u.id = $3
		   AND u.email = $4
		   AND vb.version = $5
		 RETURNING vb.version, vb.updated_at`,
		rawBlob,
		serverUpdatedAt,
		userID,
		username,
		reqVersion,
	).Scan(&acceptedVersion, &acceptedUpdatedAt)
	if updateErr == nil {
		if commitErr := tx.Commit(); commitErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
			return
		}
		c.JSON(http.StatusOK, syncPushResponse{
			AcceptedVersion: acceptedVersion,
			UpdatedAt:       acceptedUpdatedAt.UTC().Format(time.RFC3339),
		})
		return
	}
	if !errors.Is(updateErr, sql.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
		return
	}

	latest, latestErr := loadLatestSyncFromQuerier(c.Request.Context(), tx, userID)
	if latestErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
		return
	}

	if !latest.HasData {
		if reqVersion != 0 {
			c.JSON(http.StatusConflict, syncConflictResponse{
				Message: "云端版本已变化，请先拉取最新数据后再重试。",
				Latest:  latest,
			})
			return
		}

		var insertedVersion int64
		var insertedUpdatedAt time.Time
		insertErr := tx.QueryRowContext(
			c.Request.Context(),
			`INSERT INTO vault_blobs (user_id, encrypted_blob, version, updated_at)
			 VALUES ($1, $2, 1, $3)
			 RETURNING version, updated_at`,
			userID,
			rawBlob,
			serverUpdatedAt,
		).Scan(&insertedVersion, &insertedUpdatedAt)
		if insertErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
			return
		}
		if commitErr := tx.Commit(); commitErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "上传云端失败，请稍后重试。"})
			return
		}
		c.JSON(http.StatusOK, syncPushResponse{
			AcceptedVersion: insertedVersion,
			UpdatedAt:       insertedUpdatedAt.UTC().Format(time.RFC3339),
		})
		return
	}

	c.JSON(http.StatusConflict, syncConflictResponse{
		Message: "检测到版本冲突，云端已有更新，请先拉取并合并后再提交。",
		Latest:  latest,
	})
}

func (a *app) handleSyncPull(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	latest, err := loadLatestSyncFromQuerier(c.Request.Context(), a.db, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "拉取云端数据失败，请稍后重试。"})
		return
	}

	c.JSON(http.StatusOK, latest)
}

func (a *app) handleDevices(c *gin.Context) {
	userID := c.GetString("userID")
	tokenJTI := c.GetString("tokenJTI")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	rows, err := a.db.QueryContext(
		c.Request.Context(),
		`SELECT id, device_name, device_location, user_agent, last_seen_at, created_at, current_token_jti
		 FROM user_devices
		 WHERE user_id = $1 AND revoked_at IS NULL
		 ORDER BY last_seen_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "获取设备列表失败，请稍后重试。"})
		return
	}
	defer rows.Close()

	devices := make([]userDeviceItem, 0, 8)
	for rows.Next() {
		var (
			deviceID       string
			deviceName     string
			deviceLocation string
			userAgent      string
			lastSeenAt     time.Time
			createdAt      time.Time
			currentToken   sql.NullString
		)
		if scanErr := rows.Scan(
			&deviceID,
			&deviceName,
			&deviceLocation,
			&userAgent,
			&lastSeenAt,
			&createdAt,
			&currentToken,
		); scanErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "获取设备列表失败，请稍后重试。"})
			return
		}

		isCurrent := currentToken.Valid && strings.TrimSpace(currentToken.String) != "" && currentToken.String == tokenJTI
		devices = append(devices, userDeviceItem{
			ID:             deviceID,
			DeviceName:     deviceName,
			DeviceLocation: deviceLocation,
			UserAgent:      userAgent,
			LastSeenAt:     lastSeenAt.UTC().Format(time.RFC3339),
			CreatedAt:      createdAt.UTC().Format(time.RFC3339),
			IsCurrent:      isCurrent,
		})
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "获取设备列表失败，请稍后重试。"})
		return
	}

	c.JSON(http.StatusOK, userDevicesResponse{Devices: devices})
}

func (a *app) handleLogoutDevice(c *gin.Context) {
	userID := c.GetString("userID")
	currentDeviceID := c.GetString("deviceID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	var req logoutDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		if isRequestBodyTooLarge(err) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"message": "请求体过大，请精简后重试。"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"message": "请求参数无效，请检查后重试。"})
		return
	}

	if req.RevokeAll {
		result, err := a.db.ExecContext(
			c.Request.Context(),
			`UPDATE user_devices
			 SET revoked_at = NOW(),
			     current_token_jti = NULL,
			     token_expires_at = NULL
			 WHERE user_id = $1 AND revoked_at IS NULL`,
			userID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "退出所有设备失败，请稍后重试。"})
			return
		}
		count, _ := result.RowsAffected()
		c.JSON(http.StatusOK, logoutDeviceResponse{
			RevokedCount: count,
			Message:      "已退出所有设备登录。",
		})
		return
	}

	targetDeviceID := strings.TrimSpace(req.DeviceID)
	if targetDeviceID == "" {
		targetDeviceID = strings.TrimSpace(currentDeviceID)
	}
	if targetDeviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "缺少设备标识，无法执行退出。"})
		return
	}

	result, err := a.db.ExecContext(
		c.Request.Context(),
		`UPDATE user_devices
		 SET revoked_at = NOW(),
		     current_token_jti = NULL,
		     token_expires_at = NULL
		 WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL`,
		userID,
		targetDeviceID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "退出设备失败，请稍后重试。"})
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": "未找到要退出的设备，可能已失效。"})
		return
	}

	c.JSON(http.StatusOK, logoutDeviceResponse{
		RevokedCount: count,
		Message:      "设备已退出登录。",
	})
}

func (a *app) jwtAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawAuth := strings.TrimSpace(c.GetHeader("Authorization"))
		if rawAuth == "" || !strings.HasPrefix(strings.ToLower(rawAuth), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"message": "缺少有效的登录令牌，请先登录。",
			})
			return
		}

		tokenString := strings.TrimSpace(rawAuth[7:])
		token, err := jwt.ParseWithClaims(tokenString, &jwtClaims{}, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("签名算法无效")
			}
			return []byte(a.cfg.JWTSecret), nil
		})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"message": "登录令牌无效或已过期，请重新登录。",
			})
			return
		}

		claims, ok := token.Claims.(*jwtClaims)
		if !ok || !token.Valid || strings.TrimSpace(claims.Subject) == "" || strings.TrimSpace(claims.Username) == "" || strings.TrimSpace(claims.ID) == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"message": "登录令牌无效或已过期，请重新登录。",
			})
			return
		}

		var active bool
		var currentDeviceID string
		err = a.db.QueryRowContext(
			c.Request.Context(),
			`SELECT id
			 FROM user_devices
			 WHERE user_id = $1
			   AND current_token_jti = $2
			   AND revoked_at IS NULL
			   AND (token_expires_at IS NULL OR token_expires_at > NOW())
			 LIMIT 1`,
			claims.Subject,
			claims.ID,
		).Scan(&currentDeviceID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				active = false
			} else {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"message": "登录状态校验失败，请稍后重试。",
				})
				return
			}
		} else {
			active = true
		}

		if !active {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"message": "该设备登录已失效，请重新登录。",
			})
			return
		}

		c.Set("userID", claims.Subject)
		c.Set("username", strings.TrimSpace(claims.Username))
		c.Set("deviceID", currentDeviceID)
		c.Set("tokenJTI", claims.ID)
		c.Next()
	}
}

func (a *app) signJWT(userID, username, deviceID, tokenID string, expireAt time.Time) (string, error) {
	claims := jwtClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(expireAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        tokenID,
		},
		Username: username,
		DeviceID: deviceID,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(a.cfg.JWTSecret))
}
