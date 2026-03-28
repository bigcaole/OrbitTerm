package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type adminBackupPayload struct {
	SchemaVersion int                          `json:"schemaVersion"`
	ExportedAt    string                       `json:"exportedAt"`
	Meta          adminBackupMeta              `json:"meta"`
	AdminSettings map[string]string            `json:"adminSettings"`
	Users         []adminBackupUser            `json:"users"`
	VaultBlobs    []adminBackupVaultBlob       `json:"vaultBlobs"`
	Snippets      []adminBackupSnippet         `json:"snippets"`
	UserDevices   []adminBackupUserDevice      `json:"userDevices"`
	LicenseCodes  []adminBackupLicenseCode     `json:"licenseCodes"`
	Entitlements  []adminBackupUserEntitlement `json:"entitlements"`
	AuditLogs     []adminBackupAuditLog        `json:"auditLogs,omitempty"`
}

type adminBackupMeta struct {
	BackupKind       string         `json:"backupKind"`
	ExportedBy       string         `json:"exportedBy"`
	IncludeAuditLogs bool           `json:"includeAuditLogs"`
	AuditLogLimit    int            `json:"auditLogLimit,omitempty"`
	Coverage         []string       `json:"coverage"`
	RowCounts        map[string]int `json:"rowCounts"`
}

type adminBackupSnippet struct {
	ID        string   `json:"id"`
	UserID    string   `json:"userId"`
	Title     string   `json:"title"`
	Command   string   `json:"command"`
	Tags      []string `json:"tags"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type adminBackupAuditLog struct {
	ID            int64  `json:"id"`
	ActorUsername string `json:"actorUsername"`
	ActorRole     string `json:"actorRole"`
	Action        string `json:"action"`
	Target        string `json:"target"`
	Result        string `json:"result"`
	Detail        string `json:"detail"`
	IP            string `json:"ip"`
	UserAgent     string `json:"userAgent"`
	CreatedAt     string `json:"createdAt"`
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
    :root {
      --bg: #edf3ef;
      --bg-alt: #e7eeea;
      --panel: #fbfdfc;
      --line: #d5e0da;
      --text: #22312b;
      --muted: #61726d;
      --accent: #3d6f64;
      --accent-2: #4f7f74;
      --danger: #b25b5b;
      --notice-soft: #edf8f2;
      --danger-soft: #fff2f1;
    }
    body {
      margin:0;
      background:
        radial-gradient(circle at 12% 0%, #dfe8e3 0%, transparent 42%),
        radial-gradient(circle at 92% 8%, #dbe7e1 0%, transparent 40%),
        linear-gradient(180deg, var(--bg-alt) 0%, var(--bg) 52%, #f1f6f3 100%);
      color:var(--text);
      font-family:"IBM Plex Sans","PingFang SC","Microsoft YaHei",sans-serif;
    }
    .wrap { width:min(1120px,96vw); margin:20px auto 34px; }
    .top {
      position: sticky;
      top: 10px;
      z-index: 4;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      margin-bottom:14px;
      background:rgba(251,253,252,.86);
      backdrop-filter:blur(8px);
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px 14px;
      box-shadow:0 6px 18px rgba(49,76,67,.07);
    }
    .top a {
      color:#2f6055;
      text-decoration:none;
      border:1px solid #c5d6cf;
      border-radius:999px;
      background:#f4f9f6;
      padding:5px 11px;
      font-size:12px;
    }
    .top a:hover { background:#eaf4ef; color:#234e45; }
    .card { border:1px solid var(--line); background:var(--panel); border-radius:16px; padding:16px; box-shadow: 0 8px 24px rgba(48,79,66,.08); }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    .stack { display:grid; gap:10px; }
    h1,h2 { margin:0 0 8px; }
    h1 { font-size:22px; }
    h2 { font-size:15px; color:#2f433e; }
    .muted { color:var(--muted); font-size:12px; line-height:1.6; }
    .notice,.error { border-radius:10px; padding:9px 11px; margin-bottom:10px; font-size:13px; }
    .notice { border:1px solid #b7dbc7; background:var(--notice-soft); color:#26694f; }
    .error { border:1px solid #e8c1be; background:var(--danger-soft); color:#8b3b3b; }
    textarea {
      width:100%; min-height:320px; resize:vertical; border:1px solid #bfcec8; border-radius:10px;
      padding:9px 10px; font-size:12px; line-height:1.5; background:#f9fcfa; color:#1f302a; outline:none;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    textarea:focus {
      border-color:#77a79a;
      background:#fff;
      box-shadow:0 0 0 3px rgba(110,153,139,.14);
    }
    button {
      border:1px solid #63897c; border-radius:9px; background:#4f7f74; color:#f5fbf8;
      font-size:13px; font-weight:600; padding:9px 12px; cursor:pointer;
    }
    button:hover { background:#3f6f64; }
    .danger { border-color:#b47070; background:#ca8888; color:#fff7f7; }
    .danger:hover { background:#b97676; }
    .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
    .option {
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      border:1px solid #d5e2dc;
      border-radius:10px;
      background:#f6faf8;
      padding:8px 10px;
      font-size:12px;
      color:#3f5851;
    }
    .option input[type=checkbox] { width:18px; height:18px; }
    .option input[type=number] {
      width:120px;
      border:1px solid #bfcec8;
      border-radius:8px;
      padding:6px 8px;
      background:#f9fcfa;
      color:#1f302a;
      outline:none;
    }
    .mono {
      margin-top:8px;
      border:1px dashed #ccd9d3;
      border-radius:10px;
      background:#f7fbf9;
      padding:8px 10px;
      font-size:11px;
      color:#4a635c;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      line-height:1.6;
      white-space:pre-wrap;
    }
    @media (max-width: 960px) { .grid { grid-template-columns:1fr; } .top { position: static; } }
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
      <div class="card stack">
        <h2>导出逻辑备份（推荐）</h2>
        <p class="muted">跨版本迁移优先使用此 JSON。默认覆盖：admin_settings / users / vault_blobs / snippets / user_devices / sync_license_codes / user_sync_entitlements。</p>
        <form method="get" action="/admin/backup/export" class="stack">
          <label class="option">
            <span>包含审计日志（admin_audit_logs）</span>
            <input type="checkbox" name="include_audit" value="true" />
          </label>
          <label class="option">
            <span>审计日志条数上限（1-200000）</span>
            <input type="number" name="audit_limit" min="1" max="200000" value="5000" />
          </label>
          <div class="actions">
            <button type="submit">下载逻辑 JSON 备份</button>
          </div>
        </form>
      </div>

      <div class="card stack">
        <h2>导出数据库快照（SQL）</h2>
        <p class="muted">用于灾难恢复，包含当前数据库完整结构与数据（由 pg_dump 生成）。跨版本迁移仍建议优先使用逻辑 JSON。</p>
        <div class="actions">
          <a href="/admin/backup/export/sql"><button type="button">下载完整 SQL 快照</button></a>
        </div>
        <div class="mono">恢复示例（容器内）:
psql "$DATABASE_URL" -f orbitterm-db-snapshot-*.sql</div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h2>导入逻辑备份（JSON）</h2>
      <p class="muted">导入会覆盖业务核心数据（users / vault / snippets / devices / licenses / entitlements / admin_settings）。建议先导出当前备份再导入。</p>
      <form method="post" action="/admin/backup/import">
        <textarea name="backup_json" placeholder="粘贴备份 JSON 内容后导入..." required></textarea>
        <div class="actions">
          <button class="danger" type="submit">执行导入（覆盖现有数据）</button>
        </div>
      </form>
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
	includeAudit := strings.TrimSpace(c.Query("include_audit")) == "true"
	auditLimit := 5000
	if includeAudit {
		if raw := strings.TrimSpace(c.Query("audit_limit")); raw != "" {
			parsed, parseErr := strconv.Atoi(raw)
			if parseErr != nil || parsed <= 0 || parsed > 200000 {
				a.writeAdminAuditFromRequest(c, "admin.backup.export", "logical-json", "failed", "invalid audit_limit")
				c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("audit_limit 必须在 1~200000 之间。"))
				return
			}
			auditLimit = parsed
		}
	}

	payload, err := a.buildAdminBackupPayload(c.Request.Context(), strings.TrimSpace(c.GetString("adminUsername")), includeAudit, auditLimit)
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

	filename := "orbitterm-admin-logical-backup-" + time.Now().UTC().Format("20060102-150405") + ".json"
	a.writeAdminAuditFromRequest(c, "admin.backup.export", "all", "ok", "backup json exported")
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "application/json; charset=utf-8", encoded)
}

func (a *app) handleAdminBackupExportSQL(c *gin.Context) {
	if _, err := exec.LookPath("pg_dump"); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.backup.export", "database-sql", "failed", "pg_dump not found")
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("当前服务镜像缺少 pg_dump，无法导出 SQL 快照。"))
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(
		ctx,
		"pg_dump",
		"--dbname="+a.cfg.DatabaseURL,
		"--format=plain",
		"--encoding=UTF8",
		"--no-owner",
		"--no-privileges",
		"--clean",
		"--if-exists",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	output, err := cmd.Output()
	if err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}
		a.writeAdminAuditFromRequest(c, "admin.backup.export", "database-sql", "failed", "pg_dump failed: "+detail)
		c.Redirect(http.StatusFound, "/admin/backup?error="+url.QueryEscape("数据库 SQL 快照导出失败："+detail))
		return
	}

	filename := "orbitterm-db-snapshot-" + time.Now().UTC().Format("20060102-150405") + ".sql"
	a.writeAdminAuditFromRequest(c, "admin.backup.export", "database-sql", "ok", "sql snapshot exported")
	c.Header("Content-Type", "application/sql; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Data(http.StatusOK, "application/sql; charset=utf-8", output)
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

func (a *app) buildAdminBackupPayload(
	ctx context.Context,
	exportedBy string,
	includeAuditLogs bool,
	auditLimit int,
) (adminBackupPayload, error) {
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
	snippets, err := queryBackupSnippets(ctx, a.db)
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
	auditLogs := make([]adminBackupAuditLog, 0)
	if includeAuditLogs {
		auditLogs, err = queryBackupAuditLogs(ctx, a.db, auditLimit)
		if err != nil {
			return adminBackupPayload{}, err
		}
	}

	coverage := []string{
		"admin_settings",
		"users",
		"vault_blobs",
		"snippets",
		"user_devices",
		"sync_license_codes",
		"user_sync_entitlements",
	}
	if includeAuditLogs {
		coverage = append(coverage, "admin_audit_logs")
	}

	rowCounts := map[string]int{
		"admin_settings":         len(settings),
		"users":                  len(users),
		"vault_blobs":            len(vaultBlobs),
		"snippets":               len(snippets),
		"user_devices":           len(devices),
		"sync_license_codes":     len(licenseCodes),
		"user_sync_entitlements": len(entitlements),
	}
	if includeAuditLogs {
		rowCounts["admin_audit_logs"] = len(auditLogs)
	}

	return adminBackupPayload{
		SchemaVersion: 1,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339),
		Meta: adminBackupMeta{
			BackupKind:       "logical-json",
			ExportedBy:       strings.TrimSpace(exportedBy),
			IncludeAuditLogs: includeAuditLogs,
			AuditLogLimit:    auditLimit,
			Coverage:         coverage,
			RowCounts:        rowCounts,
		},
		AdminSettings: settings,
		Users:         users,
		VaultBlobs:    vaultBlobs,
		Snippets:      snippets,
		UserDevices:   devices,
		LicenseCodes:  licenseCodes,
		Entitlements:  entitlements,
		AuditLogs:     auditLogs,
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

func queryBackupSnippets(ctx context.Context, db *sql.DB) ([]adminBackupSnippet, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT id, user_id, title, command, COALESCE(array_to_json(tags)::text, '[]') AS tags_json, created_at, updated_at
		 FROM snippets
		 ORDER BY updated_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupSnippet, 0, 512)
	for rows.Next() {
		var (
			item      adminBackupSnippet
			tagsJSON  string
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.Title,
			&item.Command,
			&tagsJSON,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		if strings.TrimSpace(tagsJSON) != "" {
			if unmarshalErr := json.Unmarshal([]byte(tagsJSON), &item.Tags); unmarshalErr != nil {
				item.Tags = nil
			}
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
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

func queryBackupAuditLogs(ctx context.Context, db *sql.DB, limit int) ([]adminBackupAuditLog, error) {
	if limit <= 0 || limit > 200000 {
		limit = 5000
	}
	rows, err := db.QueryContext(
		ctx,
		`SELECT id, actor_username, actor_role, action, target, result, detail, ip, user_agent, created_at
		 FROM admin_audit_logs
		 ORDER BY id DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminBackupAuditLog, 0, limit)
	for rows.Next() {
		var (
			item      adminBackupAuditLog
			createdAt time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.ActorUsername,
			&item.ActorRole,
			&item.Action,
			&item.Target,
			&item.Result,
			&item.Detail,
			&item.IP,
			&item.UserAgent,
			&createdAt,
		); err != nil {
			return nil, err
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
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

	if err := wipeAdminBackupData(ctx, tx, payload); err != nil {
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

func wipeAdminBackupData(ctx context.Context, tx *sql.Tx, payload adminBackupPayload) error {
	statements := []string{
		`DELETE FROM user_devices`,
		`DELETE FROM vault_blobs`,
		`DELETE FROM user_sync_entitlements`,
		`DELETE FROM sync_license_codes`,
		`DELETE FROM snippets`,
		`DELETE FROM users`,
		`DELETE FROM admin_settings`,
	}
	includeAudit := payload.Meta.IncludeAuditLogs || len(payload.AuditLogs) > 0
	if includeAudit {
		statements = append(statements, `DELETE FROM admin_audit_logs`)
	}
	for _, stmt := range statements {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func insertAdminBackupData(ctx context.Context, tx *sql.Tx, payload adminBackupPayload) error {
	includeAudit := payload.Meta.IncludeAuditLogs || len(payload.AuditLogs) > 0

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

	for _, snippet := range payload.Snippets {
		tags := snippet.Tags
		if tags == nil {
			tags = []string{}
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO snippets (id, user_id, title, command, tags, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5::text[], $6, $7)`,
			snippet.ID,
			snippet.UserID,
			snippet.Title,
			snippet.Command,
			toPostgresTextArrayLiteral(tags),
			snippet.CreatedAt,
			snippet.UpdatedAt,
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

	if includeAudit {
		var maxAuditID int64
		for _, logItem := range payload.AuditLogs {
			if logItem.ID > maxAuditID {
				maxAuditID = logItem.ID
			}
			if _, err := tx.ExecContext(
				ctx,
				`INSERT INTO admin_audit_logs (id, actor_username, actor_role, action, target, result, detail, ip, user_agent, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				logItem.ID,
				logItem.ActorUsername,
				logItem.ActorRole,
				logItem.Action,
				logItem.Target,
				logItem.Result,
				logItem.Detail,
				logItem.IP,
				logItem.UserAgent,
				logItem.CreatedAt,
			); err != nil {
				return err
			}
		}
		if maxAuditID > 0 {
			if _, err := tx.ExecContext(
				ctx,
				`SELECT setval(pg_get_serial_sequence('admin_audit_logs', 'id'), $1, true)`,
				maxAuditID,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func toPostgresTextArrayLiteral(items []string) string {
	if len(items) == 0 {
		return "{}"
	}
	escaped := make([]string, 0, len(items))
	for _, item := range items {
		value := strings.ReplaceAll(item, `\`, `\\`)
		value = strings.ReplaceAll(value, `"`, `\"`)
		escaped = append(escaped, `"`+value+`"`)
	}
	return "{" + strings.Join(escaped, ",") + "}"
}
