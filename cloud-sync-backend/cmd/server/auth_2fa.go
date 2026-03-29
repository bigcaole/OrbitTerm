package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type user2FAStatusResponse struct {
	Enabled              bool   `json:"enabled"`
	Method               string `json:"method"`
	BackupCodesRemaining int    `json:"backupCodesRemaining"`
}

type user2FABeginResponse struct {
	Method     string `json:"method"`
	Secret     string `json:"secret"`
	Issuer     string `json:"issuer"`
	Account    string `json:"account"`
	OtpauthURI string `json:"otpauthUri"`
}

type user2FAEnableRequest struct {
	Secret  string `json:"secret" binding:"required"`
	OtpCode string `json:"otpCode" binding:"required"`
}

type user2FAEnableResponse struct {
	Message     string   `json:"message"`
	BackupCodes []string `json:"backupCodes"`
}

type user2FADisableRequest struct {
	OtpCode    string `json:"otpCode"`
	BackupCode string `json:"backupCode"`
}

type user2FARecord struct {
	Enabled      bool
	Secret       string
	BackupHashes []string
}

func parseBackupHashesJSON(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
		return []string{}
	}
	next := make([]string, 0, len(values))
	for _, value := range values {
		h := strings.TrimSpace(value)
		if h == "" {
			continue
		}
		next = append(next, h)
	}
	return next
}

func encodeBackupHashesJSON(values []string) string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		h := strings.TrimSpace(value)
		if h == "" {
			continue
		}
		normalized = append(normalized, h)
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func (a *app) loadUser2FA(ctx context.Context, userID string) (user2FARecord, error) {
	if strings.TrimSpace(userID) == "" {
		return user2FARecord{}, nil
	}
	var (
		secret    string
		backupRaw string
	)
	err := a.db.QueryRowContext(
		ctx,
		`SELECT secret, backup_code_hashes
		 FROM user_2fa_totp
		 WHERE user_id = $1`,
		userID,
	).Scan(&secret, &backupRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return user2FARecord{}, nil
		}
		return user2FARecord{}, err
	}
	return user2FARecord{
		Enabled:      strings.TrimSpace(secret) != "",
		Secret:       strings.TrimSpace(secret),
		BackupHashes: parsePostgresTextArray(backupRaw),
	}, nil
}

func (a *app) consumeUser2FABackupCode(
	ctx context.Context,
	userID string,
	record user2FARecord,
	backupCode string,
) (bool, error) {
	matched, nextHashes := verifyAndConsumeBackupCode(record.BackupHashes, backupCode)
	if !matched {
		return false, nil
	}
	_, err := a.db.ExecContext(
		ctx,
		`UPDATE user_2fa_totp
		 SET backup_code_hashes = $2,
		     updated_at = NOW()
		 WHERE user_id = $1`,
		userID,
		toPostgresTextArrayLiteral(nextHashes),
	)
	if err != nil {
		return false, err
	}
	return true, nil
}

func parsePostgresTextArray(raw string) []string {
	decoded := strings.TrimSpace(raw)
	if decoded == "" || decoded == "{}" {
		return []string{}
	}
	if strings.HasPrefix(decoded, "{") && strings.HasSuffix(decoded, "}") {
		decoded = decoded[1 : len(decoded)-1]
	}
	if strings.TrimSpace(decoded) == "" {
		return []string{}
	}
	parts := strings.Split(decoded, ",")
	next := make([]string, 0, len(parts))
	for _, item := range parts {
		value := strings.Trim(strings.TrimSpace(item), `"`)
		if value == "" {
			continue
		}
		next = append(next, value)
	}
	return next
}

func (a *app) handleUser2FAStatus(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}
	record, err := a.loadUser2FA(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "读取 2FA 状态失败，请稍后重试。"})
		return
	}
	c.JSON(http.StatusOK, user2FAStatusResponse{
		Enabled:              record.Enabled,
		Method:               "totp",
		BackupCodesRemaining: len(record.BackupHashes),
	})
}

func (a *app) handleUser2FABegin(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	email := strings.TrimSpace(strings.ToLower(c.GetString("username")))
	if userID == "" || email == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}
	record, err := a.loadUser2FA(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "读取 2FA 状态失败，请稍后重试。"})
		return
	}
	if record.Enabled {
		c.JSON(http.StatusConflict, gin.H{"message": "当前账号已启用 2FA，如需重置请先关闭。"})
		return
	}
	secret, err := generateTOTPSecret()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "生成 TOTP 密钥失败，请稍后重试。"})
		return
	}
	c.JSON(http.StatusOK, user2FABeginResponse{
		Method:     "totp",
		Secret:     secret,
		Issuer:     totpIssuer,
		Account:    email,
		OtpauthURI: buildTOTPURI(email, secret),
	})
}

func (a *app) handleUser2FAEnable(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	email := strings.TrimSpace(strings.ToLower(c.GetString("username")))
	if userID == "" || email == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}
	var req user2FAEnableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "2FA 参数无效。"})
		return
	}
	secret := strings.ToUpper(strings.TrimSpace(req.Secret))
	if secret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "TOTP 密钥不能为空。"})
		return
	}
	record, err := a.loadUser2FA(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "读取 2FA 状态失败，请稍后重试。"})
		return
	}
	if record.Enabled {
		c.JSON(http.StatusConflict, gin.H{"message": "当前账号已启用 2FA。"})
		return
	}
	verified, verifyErr := validateTOTP(secret, req.OtpCode, time.Now().UTC())
	if verifyErr != nil || !verified.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "TOTP 验证码错误，请重试。"})
		return
	}
	backupPlain, backupHashes, backupErr := generateBackupCodes()
	if backupErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "生成恢复码失败，请稍后重试。"})
		return
	}
	_, upsertErr := a.db.ExecContext(
		c.Request.Context(),
		`INSERT INTO user_2fa_totp (user_id, secret, backup_code_hashes, enabled_at, updated_at)
		 VALUES ($1, $2, $3, NOW(), NOW())
		 ON CONFLICT (user_id) DO UPDATE
		 SET secret = EXCLUDED.secret,
		     backup_code_hashes = EXCLUDED.backup_code_hashes,
		     enabled_at = NOW(),
		     updated_at = NOW()`,
		userID,
		secret,
		toPostgresTextArrayLiteral(backupHashes),
	)
	if upsertErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "启用 2FA 失败，请稍后重试。"})
		return
	}
	logAppInfo := "user.2fa.enable"
	a.writeAdminAuditFromRequest(c, logAppInfo, email, "ok", "user totp enabled")
	c.JSON(http.StatusOK, user2FAEnableResponse{
		Message:     "2FA 已启用，请妥善保存恢复码。",
		BackupCodes: backupPlain,
	})
}

func (a *app) handleUser2FADisable(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}
	var req user2FADisableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "2FA 参数无效。"})
		return
	}
	record, err := a.loadUser2FA(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "读取 2FA 状态失败，请稍后重试。"})
		return
	}
	if !record.Enabled {
		c.JSON(http.StatusOK, gin.H{"message": "当前账号未启用 2FA。"})
		return
	}
	otpValid := false
	if strings.TrimSpace(req.OtpCode) != "" {
		result, verifyErr := validateTOTP(record.Secret, req.OtpCode, time.Now().UTC())
		otpValid = verifyErr == nil && result.Valid
	}
	backupValid := false
	if !otpValid && strings.TrimSpace(req.BackupCode) != "" {
		matched, _ := verifyAndConsumeBackupCode(record.BackupHashes, req.BackupCode)
		backupValid = matched
	}
	if !otpValid && !backupValid {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "2FA 验证失败，请提供有效验证码或恢复码。"})
		return
	}
	if _, err := a.db.ExecContext(c.Request.Context(), `DELETE FROM user_2fa_totp WHERE user_id = $1`, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "关闭 2FA 失败，请稍后重试。"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "2FA 已关闭。"})
}

func validateAdmin2FA(appConfig config, otpOrBackup string, now time.Time) (bool, string) {
	if !appConfig.Admin2FAEnabled {
		return true, ""
	}
	code := strings.TrimSpace(otpOrBackup)
	if code == "" {
		return false, "missing"
	}
	method := strings.TrimSpace(strings.ToLower(appConfig.Admin2FAMethod))
	if method == "" {
		if strings.TrimSpace(appConfig.Admin2FASecret) != "" {
			method = "totp"
		} else {
			method = "static"
		}
	}
	if method == "totp" && strings.TrimSpace(appConfig.Admin2FASecret) != "" {
		verified, err := validateTOTP(appConfig.Admin2FASecret, code, now)
		if err == nil && verified.Valid {
			return true, "otp"
		}
		hashes := parseBackupHashesJSON(appConfig.Admin2FABackupJSON)
		matched, _ := verifyAndConsumeBackupCode(hashes, code)
		if matched {
			return true, "backup"
		}
		return false, "invalid"
	}
	if strings.TrimSpace(appConfig.Admin2FACode) != "" && code == strings.TrimSpace(appConfig.Admin2FACode) {
		return true, "static"
	}
	return false, "invalid"
}

func (a *app) consumeAdminBackupCodeIfMatched(rawCode string) (bool, error) {
	hashes := parseBackupHashesJSON(a.cfg.Admin2FABackupJSON)
	matched, nextHashes := verifyAndConsumeBackupCode(hashes, rawCode)
	if !matched {
		return false, nil
	}
	encoded := encodeBackupHashesJSON(nextHashes)
	if err := a.upsertAdminSettings(context.Background(), map[string]string{settingAdmin2FABackupHashesJSON: encoded}); err != nil {
		return false, err
	}
	a.cfg.Admin2FABackupJSON = encoded
	return true, nil
}
