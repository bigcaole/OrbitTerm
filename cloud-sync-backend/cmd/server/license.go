package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type licenseActivateRequest struct {
	Code string `json:"code" binding:"required,min=8,max=128"`
}

type licenseStatusResponse struct {
	Active        bool   `json:"active"`
	PlanKey       string `json:"planKey,omitempty"`
	IsLifetime    bool   `json:"isLifetime"`
	ExpiresAt     string `json:"expiresAt,omitempty"`
	RemainingDays int64  `json:"remainingDays,omitempty"`
}

type licensePlanSpec struct {
	Key         string
	Label       string
	DurationDay int
	IsLifetime  bool
}

type adminLicenseCodeRow struct {
	ID            string
	PlanKey       string
	PlanLabel     string
	ReservedEmail string
	UsedByEmail   string
	Disabled      bool
	CreatedAt     string
	ActivatedAt   string
}

type adminEntitlementRow struct {
	UserID        string
	Email         string
	PlanKey       string
	IsLifetime    bool
	StartedAt     string
	ExpiresAt     string
	RemainingDays string
}

type adminLicensePageData struct {
	Notice       string
	Error        string
	Generated    []string
	Plans        []licensePlanSpec
	Codes        []adminLicenseCodeRow
	Entitlements []adminEntitlementRow
}

var licensePlans = []licensePlanSpec{
	{Key: "week", Label: "1 周", DurationDay: 7},
	{Key: "month", Label: "1 个月", DurationDay: 30},
	{Key: "quarter", Label: "1 个季度", DurationDay: 90},
	{Key: "half_year", Label: "半年", DurationDay: 180},
	{Key: "year", Label: "1 年", DurationDay: 365},
	{Key: "lifetime", Label: "永久", IsLifetime: true},
}

var planMap = func() map[string]licensePlanSpec {
	result := make(map[string]licensePlanSpec, len(licensePlans))
	for _, plan := range licensePlans {
		result[plan.Key] = plan
	}
	return result
}()

var adminLicensePageTemplate = template.Must(template.New("admin-license-page").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OrbitTerm 激活码管理</title>
  <style>
    body { margin:0; font-family:"IBM Plex Sans","PingFang SC","Microsoft YaHei",sans-serif; background:#f1f7ff; color:#153048; }
    .wrap { width:min(1160px,96vw); margin:22px auto 36px; }
    .card { background:#fff; border:1px solid #c6d9f5; border-radius:14px; padding:14px; box-shadow: 0 10px 30px rgba(31,71,122,.08); }
    .top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .top a { color:#2f66d3; text-decoration:none; }
    h1,h2 { margin:0 0 8px; }
    h1 { font-size:20px; }
    h2 { font-size:15px; }
    .muted { color:#5f7793; font-size:12px; }
    .grid { display:grid; gap:12px; grid-template-columns:1fr 1fr; margin-top:12px; }
    .notice,.error { border-radius:10px; padding:9px 11px; margin-bottom:10px; font-size:13px; }
    .notice { border:1px solid #bde5cd; background:#f2fff8; color:#176a43; }
    .error { border:1px solid #efc0c0; background:#fff4f4; color:#9b3232; }
    .generated { white-space:pre-wrap; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.65; }
    .fields { display:grid; gap:10px; }
    label { display:block; color:#486481; font-size:12px; }
    input,select {
      width:100%; border:1px solid #b6cbea; border-radius:8px; background:#f8fbff; color:#12283f;
      padding:8px 9px; font-size:13px; outline:none;
    }
    input:focus,select:focus { border-color:#6fa3ef; background:#fff; }
    button { border:1px solid #325faa; background:#2f66d3; color:#fff; border-radius:8px; padding:8px 11px; cursor:pointer; font-size:13px; font-weight:600; }
    button:hover { background:#2654b3; }
    button.danger { border-color:#a44b4b; background:#ba5757; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
    th,td { text-align:left; border-bottom:1px solid #dbe6f6; padding:8px 6px; vertical-align:top; }
    th { color:#3d5e84; }
    .pill { display:inline-block; border-radius:999px; border:1px solid #b9cfee; background:#f5f9ff; padding:2px 8px; font-size:11px; color:#406188; }
    @media (max-width:980px) { .grid { grid-template-columns:1fr; } table { display:block; overflow:auto; white-space:nowrap; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>激活码与同步授权管理</h1>
        <p class="muted">未激活账号仅允许本地功能，激活后才可调用 /sync 接口。</p>
      </div>
      <div><a href="/admin">返回控制台</a></div>
    </div>

    {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
    {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}
    {{ if .Generated }}
    <div class="card" style="margin-bottom:12px;">
      <h2>本次生成的激活码（仅展示一次）</h2>
      <div class="generated">{{ range .Generated }}{{ . }}
{{ end }}</div>
    </div>
    {{ end }}

    <div class="grid">
      <div class="card">
        <h2>生成激活码</h2>
        <form class="fields" method="post" action="/admin/licenses/generate">
          <label>套餐周期
            <select name="plan_key" required>
              {{ range .Plans }}
              <option value="{{ .Key }}">{{ .Label }}{{ if .IsLifetime }}（永久）{{ end }}</option>
              {{ end }}
            </select>
          </label>
          <label>生成数量（1-20）
            <input type="number" name="count" min="1" max="20" value="1" required />
          </label>
          <label>预绑定邮箱（可选）
            <input type="text" name="reserved_email" placeholder="user@example.com" />
          </label>
          <label>备注（可选）
            <input type="text" name="note" maxlength="160" />
          </label>
          <button type="submit">生成激活码</button>
        </form>
      </div>

      <div class="card">
        <h2>当前授权用户</h2>
        <table>
          <thead><tr><th>邮箱</th><th>套餐</th><th>到期</th><th>剩余</th></tr></thead>
          <tbody>
            {{ range .Entitlements }}
            <tr>
              <td>{{ .Email }}</td>
              <td>{{ if .IsLifetime }}<span class="pill">永久</span>{{ else }}{{ .PlanKey }}{{ end }}</td>
              <td>{{ .ExpiresAt }}</td>
              <td>{{ .RemainingDays }}</td>
            </tr>
            {{ end }}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h2>最近激活码</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>套餐</th><th>预绑定邮箱</th><th>使用邮箱</th><th>创建时间</th><th>激活时间</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {{ range .Codes }}
          <tr>
            <td>{{ .ID }}</td>
            <td>{{ .PlanLabel }}</td>
            <td>{{ .ReservedEmail }}</td>
            <td>{{ .UsedByEmail }}</td>
            <td>{{ .CreatedAt }}</td>
            <td>{{ .ActivatedAt }}</td>
            <td>{{ if .Disabled }}已禁用{{ else }}可用{{ end }}</td>
            <td>
              {{ if not .Disabled }}
              <form method="post" action="/admin/licenses/disable">
                <input type="hidden" name="code_id" value="{{ .ID }}" />
                <button class="danger" type="submit">禁用</button>
              </form>
              {{ end }}
            </td>
          </tr>
          {{ end }}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`))

func normalizeActivationCode(raw string) string {
	trimmed := strings.TrimSpace(strings.ToUpper(raw))
	if trimmed == "" {
		return ""
	}
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "")
	return replacer.Replace(trimmed)
}

func hashActivationCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func generateActivationCode(planKey string) (string, error) {
	var buf [10]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	token := strings.ToUpper(hex.EncodeToString(buf[:]))
	return fmt.Sprintf("OT-%s-%s-%s", strings.ToUpper(planKey), token[:8], token[8:]), nil
}

func (a *app) resolveLicenseStatus(ctx context.Context, userID string) (licenseStatusResponse, error) {
	var (
		planKey    string
		isLifetime bool
		expiresAt  sql.NullTime
	)
	err := a.db.QueryRowContext(
		ctx,
		`SELECT plan_key, is_lifetime, expires_at
		 FROM user_sync_entitlements
		 WHERE user_id = $1`,
		userID,
	).Scan(&planKey, &isLifetime, &expiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return licenseStatusResponse{Active: false}, nil
		}
		return licenseStatusResponse{}, err
	}

	if isLifetime {
		return licenseStatusResponse{
			Active:     true,
			PlanKey:    planKey,
			IsLifetime: true,
		}, nil
	}

	if !expiresAt.Valid {
		return licenseStatusResponse{
			Active:     false,
			PlanKey:    planKey,
			IsLifetime: false,
		}, nil
	}

	now := time.Now().UTC()
	if !expiresAt.Time.After(now) {
		return licenseStatusResponse{
			Active:     false,
			PlanKey:    planKey,
			IsLifetime: false,
			ExpiresAt:  expiresAt.Time.UTC().Format(time.RFC3339),
		}, nil
	}

	remaining := expiresAt.Time.Sub(now).Hours() / 24
	return licenseStatusResponse{
		Active:        true,
		PlanKey:       planKey,
		IsLifetime:    false,
		ExpiresAt:     expiresAt.Time.UTC().Format(time.RFC3339),
		RemainingDays: int64(math.Ceil(remaining)),
	}, nil
}

func (a *app) requireActiveSyncLicenseMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := strings.TrimSpace(c.GetString("userID"))
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"message": "登录状态已失效，请重新登录。",
			})
			return
		}

		status, err := a.resolveLicenseStatus(c.Request.Context(), userID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"message": "授权状态校验失败，请稍后重试。",
			})
			return
		}
		if !status.Active {
			c.AbortWithStatusJSON(http.StatusPaymentRequired, gin.H{
				"message": "当前账号未激活同步服务，请在客户端输入激活码后再使用云同步。",
			})
			return
		}

		c.Next()
	}
}

func (a *app) handleLicenseStatus(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}
	status, err := a.resolveLicenseStatus(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "读取授权状态失败，请稍后重试。"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (a *app) handleActivateLicense(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("userID"))
	email := strings.ToLower(strings.TrimSpace(c.GetString("username")))
	if userID == "" || email == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "登录状态已失效，请重新登录。"})
		return
	}

	var req licenseActivateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "激活参数无效，请检查激活码格式。"})
		return
	}
	code := normalizeActivationCode(req.Code)
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "激活码不能为空。"})
		return
	}
	codeHash := hashActivationCode(code)

	tx, err := a.db.BeginTx(c.Request.Context(), &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活失败，请稍后重试。"})
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var (
		codeID         string
		planKey        string
		durationDays   sql.NullInt64
		isLifetime     bool
		reservedEmail  sql.NullString
		usedByUserID   sql.NullString
		disabled       bool
		existingActive sql.NullTime
	)
	err = tx.QueryRowContext(
		c.Request.Context(),
		`SELECT id, plan_key, duration_days, is_lifetime, reserved_email, used_by_user_id, disabled, activated_at
		 FROM sync_license_codes
		 WHERE code_hash = $1
		 FOR UPDATE`,
		codeHash,
	).Scan(
		&codeID,
		&planKey,
		&durationDays,
		&isLifetime,
		&reservedEmail,
		&usedByUserID,
		&disabled,
		&existingActive,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"message": "激活码不存在，请检查后重试。"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活失败，请稍后重试。"})
		return
	}

	if disabled {
		c.JSON(http.StatusForbidden, gin.H{"message": "该激活码已被禁用，请联系管理员。"})
		return
	}
	if usedByUserID.Valid && strings.TrimSpace(usedByUserID.String) != "" {
		c.JSON(http.StatusConflict, gin.H{"message": "该激活码已被使用。"})
		return
	}
	if reservedEmail.Valid && strings.TrimSpace(reservedEmail.String) != "" {
		if strings.ToLower(strings.TrimSpace(reservedEmail.String)) != email {
			c.JSON(http.StatusForbidden, gin.H{"message": "该激活码已绑定其他账号邮箱。"})
			return
		}
	}

	now := time.Now().UTC()
	var (
		currentIsLifetime bool
		currentExpiresAt  sql.NullTime
	)
	_ = tx.QueryRowContext(
		c.Request.Context(),
		`SELECT is_lifetime, expires_at
		 FROM user_sync_entitlements
		 WHERE user_id = $1
		 FOR UPDATE`,
		userID,
	).Scan(&currentIsLifetime, &currentExpiresAt)

	nextIsLifetime := currentIsLifetime || isLifetime
	var nextExpiresAt sql.NullTime
	if nextIsLifetime {
		nextExpiresAt = sql.NullTime{Valid: false}
	} else {
		base := now
		if currentExpiresAt.Valid && currentExpiresAt.Time.After(now) {
			base = currentExpiresAt.Time
		}
		days := 0
		if durationDays.Valid && durationDays.Int64 > 0 {
			days = int(durationDays.Int64)
		}
		if days <= 0 {
			days = 7
		}
		nextExpiresAt = sql.NullTime{
			Valid: true,
			Time:  base.Add(time.Duration(days) * 24 * time.Hour).UTC(),
		}
	}

	if _, err := tx.ExecContext(
		c.Request.Context(),
		`INSERT INTO user_sync_entitlements (user_id, plan_key, is_lifetime, started_at, expires_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())
		 ON CONFLICT (user_id) DO UPDATE
		 SET plan_key = EXCLUDED.plan_key,
		     is_lifetime = EXCLUDED.is_lifetime,
		     expires_at = EXCLUDED.expires_at,
		     updated_at = NOW()`,
		userID,
		planKey,
		nextIsLifetime,
		now,
		nextExpiresAt,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活失败，请稍后重试。"})
		return
	}

	if _, err := tx.ExecContext(
		c.Request.Context(),
		`UPDATE sync_license_codes
		 SET used_by_user_id = $1,
		     used_by_email = $2,
		     activated_at = NOW()
		 WHERE id = $3`,
		userID,
		email,
		codeID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活失败，请稍后重试。"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活失败，请稍后重试。"})
		return
	}

	status, err := a.resolveLicenseStatus(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "激活成功，但状态读取失败，请刷新后重试。"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "激活成功，同步服务已开通。",
		"status":  status,
	})
}

func (a *app) handleAdminLicensePage(c *gin.Context) {
	notice := strings.TrimSpace(c.Query("notice"))
	errorMessage := strings.TrimSpace(c.Query("error"))
	generatedRaw := strings.TrimSpace(c.Query("generated"))
	generated := make([]string, 0, 8)
	if generatedRaw != "" {
		for _, item := range strings.Split(generatedRaw, ",") {
			code := strings.TrimSpace(item)
			if code != "" {
				generated = append(generated, code)
			}
		}
	}

	codes, codesErr := a.loadAdminLicenseCodes(c.Request.Context())
	if codesErr != nil {
		errorMessage = "读取激活码列表失败，请稍后刷新。"
	}
	entitlements, entErr := a.loadAdminEntitlements(c.Request.Context())
	if entErr != nil {
		errorMessage = "读取授权列表失败，请稍后刷新。"
	}

	payload := adminLicensePageData{
		Notice:       notice,
		Error:        errorMessage,
		Generated:    generated,
		Plans:        licensePlans,
		Codes:        codes,
		Entitlements: entitlements,
	}
	var html bytes.Buffer
	if err := adminLicensePageTemplate.Execute(&html, payload); err != nil {
		c.String(http.StatusInternalServerError, "页面渲染失败：%v", err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

func (a *app) handleAdminGenerateLicenseCodes(c *gin.Context) {
	planKey := strings.TrimSpace(c.PostForm("plan_key"))
	plan, ok := planMap[planKey]
	if !ok {
		a.writeAdminAuditFromRequest(c, "admin.license.generate", "-", "failed", "unknown plan key")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("未知的套餐类型。"))
		return
	}

	countRaw := strings.TrimSpace(c.PostForm("count"))
	count, err := strconv.Atoi(countRaw)
	if err != nil || count <= 0 || count > 20 {
		a.writeAdminAuditFromRequest(c, "admin.license.generate", planKey, "failed", "invalid count")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("生成数量必须在 1 到 20 之间。"))
		return
	}

	reservedEmail := strings.ToLower(strings.TrimSpace(c.PostForm("reserved_email")))
	note := strings.TrimSpace(c.PostForm("note"))
	if len(note) > 160 {
		note = note[:160]
	}

	tx, err := a.db.BeginTx(c.Request.Context(), &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		a.writeAdminAuditFromRequest(c, "admin.license.generate", planKey, "failed", "begin tx failed")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("生成激活码失败，请稍后重试。"))
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	generatedCodes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		code, genErr := generateActivationCode(plan.Key)
		if genErr != nil {
			a.writeAdminAuditFromRequest(c, "admin.license.generate", planKey, "failed", "generate activation code failed")
			c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("生成激活码失败，请稍后重试。"))
			return
		}
		durationDays := sql.NullInt64{}
		if !plan.IsLifetime {
			durationDays = sql.NullInt64{Valid: true, Int64: int64(plan.DurationDay)}
		}
		if _, execErr := tx.ExecContext(
			c.Request.Context(),
			`INSERT INTO sync_license_codes (code_hash, plan_key, duration_days, is_lifetime, reserved_email, note)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			hashActivationCode(code),
			plan.Key,
			durationDays,
			plan.IsLifetime,
			nullIfEmpty(reservedEmail),
			note,
		); execErr != nil {
			a.writeAdminAuditFromRequest(c, "admin.license.generate", planKey, "failed", "insert code failed")
			c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("生成激活码失败，请稍后重试。"))
			return
		}
		generatedCodes = append(generatedCodes, code)
	}

	if err := tx.Commit(); err != nil {
		a.writeAdminAuditFromRequest(c, "admin.license.generate", planKey, "failed", "commit failed")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("生成激活码失败，请稍后重试。"))
		return
	}
	a.writeAdminAuditFromRequest(
		c,
		"admin.license.generate",
		planKey,
		"ok",
		fmt.Sprintf("generated=%d,reserved=%s", len(generatedCodes), reservedEmail),
	)

	message := fmt.Sprintf("已生成 %d 个激活码。", len(generatedCodes))
	c.Redirect(
		http.StatusFound,
		"/admin/licenses?notice="+url.QueryEscape(message)+"&generated="+url.QueryEscape(strings.Join(generatedCodes, ",")),
	)
}

func (a *app) handleAdminDisableLicenseCode(c *gin.Context) {
	codeID := strings.TrimSpace(c.PostForm("code_id"))
	if codeID == "" {
		a.writeAdminAuditFromRequest(c, "admin.license.disable", "-", "failed", "missing code_id")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("缺少 code_id。"))
		return
	}
	result, err := a.db.ExecContext(
		c.Request.Context(),
		`UPDATE sync_license_codes
		 SET disabled = TRUE
		 WHERE id = $1 AND disabled = FALSE`,
		codeID,
	)
	if err != nil {
		a.writeAdminAuditFromRequest(c, "admin.license.disable", codeID, "failed", "db update failed")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("禁用激活码失败，请稍后重试。"))
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		a.writeAdminAuditFromRequest(c, "admin.license.disable", codeID, "failed", "not found or already disabled")
		c.Redirect(http.StatusFound, "/admin/licenses?error="+url.QueryEscape("激活码不存在或已禁用。"))
		return
	}
	a.writeAdminAuditFromRequest(c, "admin.license.disable", codeID, "ok", "license code disabled")
	c.Redirect(http.StatusFound, "/admin/licenses?notice="+url.QueryEscape("激活码已禁用。"))
}

func nullIfEmpty(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{Valid: true, String: trimmed}
}

func (a *app) loadAdminLicenseCodes(ctx context.Context) ([]adminLicenseCodeRow, error) {
	rows, err := a.db.QueryContext(
		ctx,
		`SELECT id, plan_key, reserved_email, used_by_email, disabled, created_at, activated_at
		 FROM sync_license_codes
		 ORDER BY created_at DESC
		 LIMIT 120`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]adminLicenseCodeRow, 0, 120)
	for rows.Next() {
		var (
			item          adminLicenseCodeRow
			reservedEmail sql.NullString
			usedByEmail   sql.NullString
			createdAt     time.Time
			activatedAt   sql.NullTime
		)
		if err := rows.Scan(
			&item.ID,
			&item.PlanKey,
			&reservedEmail,
			&usedByEmail,
			&item.Disabled,
			&createdAt,
			&activatedAt,
		); err != nil {
			return nil, err
		}
		plan := planMap[item.PlanKey]
		item.PlanLabel = plan.Label
		item.ReservedEmail = "-"
		if reservedEmail.Valid && strings.TrimSpace(reservedEmail.String) != "" {
			item.ReservedEmail = reservedEmail.String
		}
		item.UsedByEmail = "-"
		if usedByEmail.Valid && strings.TrimSpace(usedByEmail.String) != "" {
			item.UsedByEmail = usedByEmail.String
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		item.ActivatedAt = "-"
		if activatedAt.Valid {
			item.ActivatedAt = activatedAt.Time.UTC().Format(time.RFC3339)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *app) loadAdminEntitlements(ctx context.Context) ([]adminEntitlementRow, error) {
	rows, err := a.db.QueryContext(
		ctx,
		`SELECT e.user_id, u.email, e.plan_key, e.is_lifetime, e.started_at, e.expires_at
		 FROM user_sync_entitlements AS e
		 INNER JOIN users AS u ON u.id = e.user_id
		 ORDER BY e.updated_at DESC
		 LIMIT 120`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	now := time.Now().UTC()
	result := make([]adminEntitlementRow, 0, 120)
	for rows.Next() {
		var (
			item      adminEntitlementRow
			startedAt time.Time
			expiresAt sql.NullTime
		)
		if err := rows.Scan(
			&item.UserID,
			&item.Email,
			&item.PlanKey,
			&item.IsLifetime,
			&startedAt,
			&expiresAt,
		); err != nil {
			return nil, err
		}
		item.StartedAt = startedAt.UTC().Format(time.RFC3339)
		if item.IsLifetime {
			item.ExpiresAt = "永久"
			item.RemainingDays = "永久"
		} else if expiresAt.Valid {
			item.ExpiresAt = expiresAt.Time.UTC().Format(time.RFC3339)
			if expiresAt.Time.After(now) {
				remaining := int64(math.Ceil(expiresAt.Time.Sub(now).Hours() / 24))
				item.RemainingDays = fmt.Sprintf("%d 天", remaining)
			} else {
				item.RemainingDays = "已过期"
			}
		} else {
			item.ExpiresAt = "-"
			item.RemainingDays = "-"
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
