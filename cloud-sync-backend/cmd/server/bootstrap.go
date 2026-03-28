package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

const (
	settingJWTSecret                = "jwt_secret"
	settingAdminWebEnabled          = "admin_web_enabled"
	settingAdminUsername            = "admin_username"
	settingAdminPasswordHash        = "admin_password_hash"
	settingAdminRole                = "admin_role"
	settingAdmin2FAEnabled          = "admin_2fa_enabled"
	settingAdmin2FACode             = "admin_2fa_code"
	settingAdminSessionHours        = "admin_session_hours"
	settingClientDefaultSyncDomain  = "client_default_sync_domain"
	settingClientSyncDomainLocked   = "client_sync_domain_locked"
	settingClientHideSyncDomainEdit = "client_hide_sync_domain_edit"
)

func (a *app) readAdminSettings(ctx context.Context) (map[string]string, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT key, value FROM admin_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string, 16)
	for rows.Next() {
		var key string
		var value string
		if scanErr := rows.Scan(&key, &value); scanErr != nil {
			return nil, scanErr
		}
		result[strings.TrimSpace(key)] = value
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, rowsErr
	}
	return result, nil
}

func (a *app) readAdminSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := a.db.QueryRowContext(ctx, `SELECT value FROM admin_settings WHERE key = $1`, key).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func (a *app) upsertAdminSettings(ctx context.Context, settings map[string]string) error {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := upsertAdminSettingsTx(ctx, tx, settings); err != nil {
		return err
	}
	return tx.Commit()
}

func upsertAdminSettingsTx(ctx context.Context, tx *sql.Tx, settings map[string]string) error {
	for key, value := range settings {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO admin_settings (key, value, updated_at)
			 VALUES ($1, $2, NOW())
			 ON CONFLICT (key) DO UPDATE
			 SET value = EXCLUDED.value,
			     updated_at = NOW()`,
			strings.TrimSpace(key),
			value,
		); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) isSetupComplete() bool {
	return strings.TrimSpace(a.cfg.AdminUsername) != "" && strings.TrimSpace(a.cfg.AdminPasswordHash) != ""
}

func randomHexSecret(bytesLength int) (string, error) {
	if bytesLength <= 0 {
		bytesLength = 48
	}
	buf := make([]byte, bytesLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func (a *app) loadBootstrapConfig(ctx context.Context) error {
	settings, err := a.readAdminSettings(ctx)
	if err != nil {
		return err
	}

	nextJWTSecret := strings.TrimSpace(a.cfg.JWTSecret)
	if nextJWTSecret == "" {
		nextJWTSecret = strings.TrimSpace(settings[settingJWTSecret])
		if len(nextJWTSecret) < 32 {
			generated, genErr := randomHexSecret(48)
			if genErr != nil {
				return genErr
			}
			nextJWTSecret = generated
		}
	}
	if len(nextJWTSecret) < 32 {
		return fmt.Errorf("JWT secret 长度不足，至少 32 字节")
	}
	a.cfg.JWTSecret = nextJWTSecret

	if strings.TrimSpace(a.cfg.AdminUsername) == "" {
		a.cfg.AdminUsername = strings.TrimSpace(settings[settingAdminUsername])
	}
	if strings.TrimSpace(a.cfg.AdminPasswordHash) == "" {
		a.cfg.AdminPasswordHash = strings.TrimSpace(settings[settingAdminPasswordHash])
	}
	if rawRole, ok := settings[settingAdminRole]; ok && strings.TrimSpace(rawRole) != "" {
		a.cfg.AdminRole = normalizeAdminRole(rawRole)
	} else {
		a.cfg.AdminRole = normalizeAdminRole(a.cfg.AdminRole)
	}
	if raw, ok := settings[settingAdmin2FAEnabled]; ok && strings.TrimSpace(raw) != "" {
		a.cfg.Admin2FAEnabled = parseBoolString(raw, a.cfg.Admin2FAEnabled)
	}
	if strings.TrimSpace(a.cfg.Admin2FACode) == "" {
		a.cfg.Admin2FACode = strings.TrimSpace(settings[settingAdmin2FACode])
	}
	if rawHours, ok := settings[settingAdminSessionHours]; ok {
		if parsed, parseErr := strconv.Atoi(strings.TrimSpace(rawHours)); parseErr == nil && parsed > 0 && parsed <= 168 {
			a.cfg.AdminSessionHours = parsed
		}
	}
	if rawEnabled, ok := settings[settingAdminWebEnabled]; ok && strings.TrimSpace(rawEnabled) != "" {
		a.cfg.AdminWebEnabled = parseBoolString(rawEnabled, a.cfg.AdminWebEnabled)
	}

	bootstrapSettings := map[string]string{
		settingJWTSecret:         a.cfg.JWTSecret,
		settingAdminWebEnabled:   strconv.FormatBool(a.cfg.AdminWebEnabled),
		settingAdminRole:         normalizeAdminRole(a.cfg.AdminRole),
		settingAdmin2FAEnabled:   strconv.FormatBool(a.cfg.Admin2FAEnabled),
		settingAdminSessionHours: strconv.Itoa(a.cfg.AdminSessionHours),
	}
	if strings.TrimSpace(a.cfg.AdminUsername) != "" {
		bootstrapSettings[settingAdminUsername] = strings.TrimSpace(a.cfg.AdminUsername)
	}
	if strings.TrimSpace(a.cfg.AdminPasswordHash) != "" {
		bootstrapSettings[settingAdminPasswordHash] = strings.TrimSpace(a.cfg.AdminPasswordHash)
	}
	if strings.TrimSpace(a.cfg.Admin2FACode) != "" {
		bootstrapSettings[settingAdmin2FACode] = strings.TrimSpace(a.cfg.Admin2FACode)
	}

	if err := a.upsertAdminSettings(ctx, bootstrapSettings); err != nil {
		return err
	}

	return nil
}
