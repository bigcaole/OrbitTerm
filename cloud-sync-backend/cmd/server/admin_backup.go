package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type adminBackupPayload struct {
	SchemaVersion int                          `json:"schemaVersion"`
	ExportedAt    string                       `json:"exportedAt"`
	AdminSettings map[string]string            `json:"adminSettings"`
	Users         []adminBackupUser            `json:"users"`
	VaultBlobs    []adminBackupVaultBlob       `json:"vaultBlobs"`
	UserDevices   []adminBackupUserDevice      `json:"userDevices"`
	LicenseCodes  []adminBackupLicenseCode     `json:"licenseCodes"`
	Entitlements  []adminBackupUserEntitlement `json:"entitlements"`
}

type adminBackupUser struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"passwordHash"`
	CreatedAt    string `json:"createdAt"`
}

type adminBackupVaultBlob struct {
	UserID              string `json:"userId"`
	Version             int64  `json:"version"`
	EncryptedBlobBase64 string `json:"encryptedBlobBase64"`
	UpdatedAt           string `json:"updatedAt"`
}

type adminBackupUserDevice struct {
	ID                string `json:"id"`
	UserID            string `json:"userId"`
	DeviceName        string `json:"deviceName"`
	DeviceLocation    string `json:"deviceLocation"`
	UserAgent         string `json:"userAgent"`
	DeviceFingerprint string `json:"deviceFingerprint"`
	CurrentTokenJti   string `json:"currentTokenJti"`
	TokenExpiresAt    string `json:"tokenExpiresAt"`
	LastSeenAt        string `json:"lastSeenAt"`
	CreatedAt         string `json:"createdAt"`
	RevokedAt         string `json:"revokedAt"`
}

type adminBackupLicenseCode struct {
	ID            string `json:"id"`
	CodeHash      string `json:"codeHash"`
	PlanKey       string `json:"planKey"`
	DurationDays  int64  `json:"durationDays"`
	IsLifetime    bool   `json:"isLifetime"`
	ReservedEmail string `json:"reservedEmail"`
	UsedByUserID  string `json:"usedByUserId"`
	UsedByEmail   string `json:"usedByEmail"`
	Disabled      bool   `json:"disabled"`
	Note          string `json:"note"`
	CreatedAt     string `json:"createdAt"`
	ActivatedAt   string `json:"activatedAt"`
}

type adminBackupUserEntitlement struct {
	UserID     string `json:"userId"`
	PlanKey    string `json:"planKey"`
	IsLifetime bool   `json:"isLifetime"`
	StartedAt  string `json:"startedAt"`
	ExpiresAt  string `json:"expiresAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type adminBackupPageData struct {
	Notice string
	Error  string
}

const adminBackupPageTemplate = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OrbitTerm 备份与恢复</title>
  <style>
    body { margin:0; background:#f2f8ff; color:#17314c; font-family:"IBM Plex Sans","PingFang SC","Microsoft YaHei",sans-serif; }
    .wrap { width:min(1100px,96vw); margin:22px auto 34px; }
    .top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .top a { color:#2f63d0; text-decoration:none; }
    .card { border:1px solid #c8daf4; background:#fff; border-radius:14px; padding:14px; box-shadow: 0 10px 28px rgba(28,62,107,.08); }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    h1,h2 { margin:0 0 8px; }
    h1 { font-size:20px; }
    h2 { font-size:15px; }
    .muted { color:#5b7593; font-size:12px; line-height:1.6; }
    .notice,.error { border-radius:10px; padding:9px 11px; margin-bottom:10px; font-size:13px; }
    .notice { border:1px solid #bfe3cc; background:#f3fff8; color:#186a44; }
    .error { border:1px solid #efc4c4; background:#fff4f4; color:#9a3232; }
    textarea {
      width:100%; min-height:320px; resize:vertical; border:1px solid #b9cdea; border-radius:10px;
      padding:9px 10px; font-size:12px; line-height:1.5; background:#f8fbff; color:#16324f; outline:none;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    textarea:focus { border-color:#6fa2ee; background:#fff; }
    button {
      border:1px solid #2f63cf; border-radius:9px; background:#2f63cf; color:#fff;
      font-size:13px; font-weight:600; padding:9px 12px; cursor:pointer;
    }
    button:hover { background:#2554b2; }
    .danger { border-color:#a94d4d; background:#bd5959; }
    .danger:hover { background:#a84a4a; }
    .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
    @media (max-width: 960px) { .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>管理端备份与恢复</h1>
        <p class="muted">支持跨版本导入。导入采用事务写入，失败自动回滚。</p>
      </div>
      <div><a href="/admin">返回控制台</a></div>
    </div>
    {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
    {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}

    <div class="grid">
      <div class="card">
        <h2>导出备份</h2>
        <p class="muted">导出内容包含管理员设置、用户、设备、同步密文、激活码与授权状态。</p>
        <div class="actions">
          <a href="/admin/backup/export"><button type="button">下载 JSON 备份</button></a>
        </div>
      </div>

      <div class="card">
        <h2>导入备份</h2>
        <p class="muted">导入会覆盖当前业务数据（users / vault / devices / licenses / entitlements / admin_settings）。</p>
        <form method="post" action="/admin/backup/import">
          <textarea name="backup_json" placeholder="粘贴备份 JSON 内容后导入..." required></textarea>
          <div class="actions">
            <button class="danger" type="submit">执行导入（覆盖现有数据）</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</body>
</html>`

func (a *app) handleAdminBackupPage(c *gin.Context) {
	payload := adminBackupPageData{
		Notice: strings.TrimSpace(c.Query("notice")),
		Error:  strings.TrimSpace(c.Query("error")),
	}
	var html bytes.Buffer
	tpl, err := template.New("admin-backup-page").Parse(adminBackupPageTemplate)
	if err != nil {
		c.String(http.StatusInternalServerError, "页面模板加载失败：%v", err)
		return
	}
	if err := tpl.Execute(&html, payload); err != nil {
		c.String(http.StatusInternalServerError, "页面渲染失败：%v", err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

func (a *app) handleAdminBackupExport(c *gin.Context) {
	payload, err := a.buildAdminBackupPayload(c.Request.Context())
	if err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.export", "all", "failed", "build payload failed")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("备份导出失败，请稍后重试。"))
		return
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.export", "all", "failed", "marshal payload failed")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("备份导出失败，请稍后重试。"))
		return
	}

	filename := "orbitterm-admin-backup-" + time.Now().UTC().Format("20060102-150405") + ".json"
	a.writeAdminAuditFromRequest(c, "admin.backup.export", "all", "ok", "backup json exported")
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "application/json; charset=utf-8", encoded)
}

func (a *app) handleAdminBackupImport(c *gin.Context) {
	raw := strings.TrimSpace(c.PostForm("backup_json"))
	if raw == "" {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "empty payload")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("请粘贴备份 JSON 内容。"))
		return
	}

	var payload adminBackupPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "invalid json")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("备份 JSON 格式无效。"))
		return
	}
	if payload.SchemaVersion <= 0 {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "invalid schema version")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("备份版本无效。"))
		return
	}

	if err := a.importAdminBackupPayload(c.Request.Context(), payload); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "import transaction failed")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("备份导入失败："+err.Error()))
		return
	}
	if err := a.loadRuntimeSettings(c.Request.Context()); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "reload runtime settings failed")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("导入成功，但运行参数刷新失败："+err.Error()))
		return
	}
	if err := a.loadBootstrapConfig(c.Request.Context()); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "failed", "reload bootstrap failed")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("导入成功，但引导配置刷新失败："+err.Error()))
		return
	}

	a.writeAdminAuditFromRequest(c, "admin.backup.import", "all", "ok", "backup imported and reloaded")
	a.clearAdminSessionCookie(c)
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("备份导入成功，请重新登录管理员账号。"))
}

func (a *app) buildAdminBackupPayload(ctx context.Context) (adminBackupPayload, error) {
	settings, err := a.readAdminSettings(ctx)
	if err != nil {
		return adminBackupPayload{}, err
	}

	users, err := queryBackupUsers(ctx, a.db)
	if err != nil {
		return adminBackupPayload{}, err
	}
	vaultBlobs, err := queryBackupVaultBlobs(ctx, a.db)
	if err != nil {
		return adminBackupPayload{}, err
	}
	devices, err := queryBackupUserDevices(ctx, a.db)
	if err != nil {
		return adminBackupPayload{}, err
	}
	licenseCodes, err := queryBackupLicenseCodes(ctx, a.db)
	if err != nil {
		return adminBackupPayload{}, err
	}
	entitlements, err := queryBackupEntitlements(ctx, a.db)
	if err != nil {
		return adminBackupPayload{}, err
	}

	return adminBackupPayload{
		SchemaVersion: 1,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		AdminSettings: settings,
		Users:         users,
		VaultBlobs:    vaultBlobs,
		UserDevices:   devices,
		LicenseCodes:  licenseCodes,
		Entitlements:  entitlements,
	}, nil
}

func queryBackupUsers(ctx context.Context, db *sql.DB) ([]adminBackupUser, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, email, password_hash, created_at FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupUser, 0, 256)
	for rows.Next() {
		var (
			item      adminBackupUser
			createdAt time.Time
		)
		if err := rows.Scan(&item.ID, &item.Email, &item.PasswordHash, &createdAt); err != nil {
			return nil, err
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryBackupVaultBlobs(ctx context.Context, db *sql.DB) ([]adminBackupVaultBlob, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT user_id, version, encode(encrypted_blob, 'base64'), updated_at FROM vault_blobs ORDER BY updated_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupVaultBlob, 0, 256)
	for rows.Next() {
		var (
			item      adminBackupVaultBlob
			updatedAt time.Time
		)
		if err := rows.Scan(&item.UserID, &item.Version, &item.EncryptedBlobBase64, &updatedAt); err != nil {
			return nil, err
		}
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryBackupUserDevices(ctx context.Context, db *sql.DB) ([]adminBackupUserDevice, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT id, user_id, device_name, device_location, user_agent, device_fingerprint, current_token_jti, token_expires_at, last_seen_at, created_at, revoked_at
		 FROM user_devices ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupUserDevice, 0, 512)
	for rows.Next() {
		var (
			item           adminBackupUserDevice
			tokenExpiresAt sql.NullTime
			lastSeenAt     time.Time
			createdAt      time.Time
			revokedAt      sql.NullTime
			currentToken   sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.DeviceName,
			&item.DeviceLocation,
			&item.UserAgent,
			&item.DeviceFingerprint,
			&currentToken,
			&tokenExpiresAt,
			&lastSeenAt,
			&createdAt,
			&revokedAt,
		); err != nil {
			return nil, err
		}
		item.CurrentTokenJti = ""
		if currentToken.Valid {
			item.CurrentTokenJti = currentToken.String
		}
		item.TokenExpiresAt = ""
		if tokenExpiresAt.Valid {
			item.TokenExpiresAt = tokenExpiresAt.Time.UTC().Format(time.RFC3339)
		}
		item.LastSeenAt = lastSeenAt.UTC().Format(time.RFC3339)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.RevokedAt = ""
		if revokedAt.Valid {
			item.RevokedAt = revokedAt.Time.UTC().Format(time.RFC3339)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryBackupLicenseCodes(ctx context.Context, db *sql.DB) ([]adminBackupLicenseCode, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT id, code_hash, plan_key, duration_days, is_lifetime, reserved_email, used_by_user_id, used_by_email, disabled, note, created_at, activated_at
		 FROM sync_license_codes ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupLicenseCode, 0, 256)
	for rows.Next() {
		var (
			item         adminBackupLicenseCode
			durationDays sql.NullInt64
			reserved     sql.NullString
			usedByUserID sql.NullString
			usedByEmail  sql.NullString
			createdAt    time.Time
			activatedAt  sql.NullTime
		)
		if err := rows.Scan(
			&item.ID,
			&item.CodeHash,
			&item.PlanKey,
			&durationDays,
			&item.IsLifetime,
			&reserved,
			&usedByUserID,
			&usedByEmail,
			&item.Disabled,
			&item.Note,
			&createdAt,
			&activatedAt,
		); err != nil {
			return nil, err
		}
		if durationDays.Valid {
			item.DurationDays = durationDays.Int64
		}
		if reserved.Valid {
			item.ReservedEmail = reserved.String
		}
		if usedByUserID.Valid {
			item.UsedByUserID = usedByUserID.String
		}
		if usedByEmail.Valid {
			item.UsedByEmail = usedByEmail.String
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if activatedAt.Valid {
			item.ActivatedAt = activatedAt.Time.UTC().Format(time.RFC3339)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryBackupEntitlements(ctx context.Context, db *sql.DB) ([]adminBackupUserEntitlement, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT user_id, plan_key, is_lifetime, started_at, expires_at, updated_at
		 FROM user_sync_entitlements ORDER BY updated_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupUserEntitlement, 0, 256)
	for rows.Next() {
		var (
			item      adminBackupUserEntitlement
			startedAt time.Time
			expiresAt sql.NullTime
			updatedAt time.Time
		)
		if err := rows.Scan(
			&item.UserID,
			&item.PlanKey,
			&item.IsLifetime,
			&startedAt,
			&expiresAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		item.StartedAt = startedAt.UTC().Format(time.RFC3339)
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		if expiresAt.Valid {
			item.ExpiresAt = expiresAt.Time.UTC().Format(time.RFC3339)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (a *app) importAdminBackupPayload(ctx context.Context, payload adminBackupPayload) error {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := wipeAdminBackupData(ctx, tx); err != nil {
		return err
	}
	if err := insertAdminBackupData(ctx, tx, payload); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func wipeAdminBackupData(ctx context.Context, tx *sql.Tx) error {
	statements := []string{
		`DELETE FROM user_devices`,
		`DELETE FROM vault_blobs`,
		`DELETE FROM user_sync_entitlements`,
		`DELETE FROM sync_license_codes`,
		`DELETE FROM snippets`,
		`DELETE FROM users`,
		`DELETE FROM admin_settings`,
	}
	for _, stmt := range statements {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func insertAdminBackupData(ctx context.Context, tx *sql.Tx, payload adminBackupPayload) error {
	if len(payload.AdminSettings) > 0 {
		if err := upsertAdminSettingsTx(ctx, tx, payload.AdminSettings); err != nil {
			return err
		}
	}

	for _, user := range payload.Users {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO users (id, email, password_hash, created_at)
			 VALUES ($1, $2, $3, $4)`,
			user.ID,
			user.Email,
			user.PasswordHash,
			user.CreatedAt,
		); err != nil {
			return err
		}
	}

	for _, blob := range payload.VaultBlobs {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO vault_blobs (user_id, version, encrypted_blob, updated_at)
			 VALUES ($1, $2, decode($3, 'base64'), $4)`,
			blob.UserID,
			blob.Version,
			blob.EncryptedBlobBase64,
			blob.UpdatedAt,
		); err != nil {
			return err
		}
	}

	for _, device := range payload.UserDevices {
		var (
			currentToken sql.NullString
			tokenExpires sql.NullTime
			revokedAt    sql.NullTime
		)
		if strings.TrimSpace(device.CurrentTokenJti) != "" {
			currentToken = sql.NullString{Valid: true, String: strings.TrimSpace(device.CurrentTokenJti)}
		}
		if strings.TrimSpace(device.TokenExpiresAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(device.TokenExpiresAt)); err == nil {
				tokenExpires = sql.NullTime{Valid: true, Time: parsed}
			}
		}
		if strings.TrimSpace(device.RevokedAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(device.RevokedAt)); err == nil {
				revokedAt = sql.NullTime{Valid: true, Time: parsed}
			}
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO user_devices (id, user_id, device_name, device_location, user_agent, device_fingerprint, current_token_jti, token_expires_at, last_seen_at, created_at, revoked_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			device.ID,
			device.UserID,
			device.DeviceName,
			device.DeviceLocation,
			device.UserAgent,
			device.DeviceFingerprint,
			currentToken,
			tokenExpires,
			device.LastSeenAt,
			device.CreatedAt,
			revokedAt,
		); err != nil {
			return err
		}
	}

	for _, code := range payload.LicenseCodes {
		var (
			durationDays sql.NullInt64
			reserved     sql.NullString
			usedByUserID sql.NullString
			usedByEmail  sql.NullString
			activatedAt  sql.NullTime
		)
		if code.DurationDays > 0 {
			durationDays = sql.NullInt64{Valid: true, Int64: code.DurationDays}
		}
		if strings.TrimSpace(code.ReservedEmail) != "" {
			reserved = sql.NullString{Valid: true, String: strings.TrimSpace(code.ReservedEmail)}
		}
		if strings.TrimSpace(code.UsedByUserID) != "" {
			usedByUserID = sql.NullString{Valid: true, String: strings.TrimSpace(code.UsedByUserID)}
		}
		if strings.TrimSpace(code.UsedByEmail) != "" {
			usedByEmail = sql.NullString{Valid: true, String: strings.TrimSpace(code.UsedByEmail)}
		}
		if strings.TrimSpace(code.ActivatedAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(code.ActivatedAt)); err == nil {
				activatedAt = sql.NullTime{Valid: true, Time: parsed}
			}
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO sync_license_codes (id, code_hash, plan_key, duration_days, is_lifetime, reserved_email, used_by_user_id, used_by_email, disabled, note, created_at, activated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			code.ID,
			code.CodeHash,
			code.PlanKey,
			durationDays,
			code.IsLifetime,
			reserved,
			usedByUserID,
			usedByEmail,
			code.Disabled,
			code.Note,
			code.CreatedAt,
			activatedAt,
		); err != nil {
			return err
		}
	}

	for _, entitlement := range payload.Entitlements {
		var expiresAt sql.NullTime
		if strings.TrimSpace(entitlement.ExpiresAt) != "" {
			if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(entitlement.ExpiresAt)); err == nil {
				expiresAt = sql.NullTime{Valid: true, Time: parsed}
			}
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO user_sync_entitlements (user_id, plan_key, is_lifetime, started_at, expires_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			entitlement.UserID,
			entitlement.PlanKey,
			entitlement.IsLifetime,
			entitlement.StartedAt,
			expiresAt,
			entitlement.UpdatedAt,
		); err != nil {
			return err
		}
	}
	return nil
}
