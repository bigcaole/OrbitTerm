package main

import (
	"bytes"
	"context"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type adminAuditRow struct {
	ID            int64
	ActorUsername string
	ActorRole     string
	Action        string
	Target        string
	Result        string
	Detail        string
	IP            string
	UserAgent     string
	CreatedAt     string
}

type adminAuditPageData struct {
	Notice string
	Error  string
	Logs   []adminAuditRow
}

var adminAuditPageTemplate = template.Must(template.New("admin-audit-page").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OrbitTerm 审计日志</title>
  <style>
    body { margin:0; background:#f2f8ff; color:#17314c; font-family:"IBM Plex Sans","PingFang SC","Microsoft YaHei",sans-serif; }
    .wrap { width:min(1200px,96vw); margin:22px auto 34px; }
    .top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .top a { color:#2f63d0; text-decoration:none; }
    .card { border:1px solid #c8daf4; background:#fff; border-radius:14px; padding:14px; box-shadow:0 10px 28px rgba(28,62,107,.08); }
    h1,h2 { margin:0 0 8px; }
    h1 { font-size:20px; }
    .muted { color:#5b7593; font-size:12px; line-height:1.6; }
    .notice,.error { border-radius:10px; padding:9px 11px; margin-bottom:10px; font-size:13px; }
    .notice { border:1px solid #bfe3cc; background:#f3fff8; color:#186a44; }
    .error { border:1px solid #efc4c4; background:#fff4f4; color:#9a3232; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
    th,td { text-align:left; border-bottom:1px solid #dbe6f6; padding:8px 6px; vertical-align:top; }
    th { color:#3d5e84; }
    .ok { color:#147a4a; font-weight:600; }
    .fail { color:#a03939; font-weight:600; }
    @media (max-width: 980px) { table { display:block; overflow:auto; white-space:nowrap; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>管理员审计日志</h1>
        <p class="muted">记录管理端关键行为，含操作者、操作对象、结果、来源 IP 与 User-Agent。</p>
      </div>
      <div><a href="/admin">返回控制台</a></div>
    </div>
    {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
    {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}

    <div class="card">
      <h2>最近 200 条</h2>
      <table>
        <thead>
          <tr>
            <th>时间(UTC)</th>
            <th>账号</th>
            <th>角色</th>
            <th>动作</th>
            <th>目标</th>
            <th>结果</th>
            <th>IP</th>
            <th>User-Agent</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          {{ range .Logs }}
          <tr>
            <td>{{ .CreatedAt }}</td>
            <td>{{ .ActorUsername }}</td>
            <td>{{ .ActorRole }}</td>
            <td>{{ .Action }}</td>
            <td>{{ .Target }}</td>
            <td>{{ if eq .Result "ok" }}<span class="ok">成功</span>{{ else }}<span class="fail">{{ .Result }}</span>{{ end }}</td>
            <td>{{ .IP }}</td>
            <td>{{ .UserAgent }}</td>
            <td>{{ .Detail }}</td>
          </tr>
          {{ end }}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`))

func sanitizeAuditField(value string, maxLen int, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	if maxLen > 0 && len(trimmed) > maxLen {
		return trimmed[:maxLen]
	}
	return trimmed
}

func (a *app) writeAdminAudit(
	ctx context.Context,
	actorUsername string,
	actorRole string,
	action string,
	target string,
	result string,
	detail string,
	ip string,
	userAgent string,
) {
	if strings.TrimSpace(action) == "" {
		return
	}
	ctxWithTimeout, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, _ = a.db.ExecContext(
		ctxWithTimeout,
		`INSERT INTO admin_audit_logs (actor_username, actor_role, action, target, result, detail, ip, user_agent)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		sanitizeAuditField(actorUsername, 80, "unknown"),
		sanitizeAuditField(actorRole, 32, "unknown"),
		sanitizeAuditField(action, 120, "unknown"),
		sanitizeAuditField(target, 200, "-"),
		sanitizeAuditField(result, 32, "ok"),
		sanitizeAuditField(detail, 400, "-"),
		sanitizeAuditField(ip, 80, "-"),
		sanitizeAuditField(userAgent, 200, "-"),
	)
}

func (a *app) writeAdminAuditFromRequest(c *gin.Context, action, target, result, detail string) {
	actor := strings.TrimSpace(c.GetString("adminUsername"))
	if actor == "" {
		actor = strings.TrimSpace(c.PostForm("username"))
	}
	role := strings.TrimSpace(c.GetString("adminRole"))
	if role == "" {
		role = "anonymous"
	}
	a.writeAdminAudit(
		c.Request.Context(),
		actor,
		role,
		action,
		target,
		result,
		detail,
		c.ClientIP(),
		c.Request.UserAgent(),
	)
}

func (a *app) handleAdminAuditPage(c *gin.Context) {
	logs, err := a.loadAdminAuditRows(c.Request.Context(), 200)
	if err != nil {
		c.String(http.StatusInternalServerError, "读取审计日志失败：%v", err)
		return
	}
	payload := adminAuditPageData{
		Notice: strings.TrimSpace(c.Query("notice")),
		Error:  strings.TrimSpace(c.Query("error")),
		Logs:   logs,
	}
	var html bytes.Buffer
	if err := adminAuditPageTemplate.Execute(&html, payload); err != nil {
		c.String(http.StatusInternalServerError, "页面渲染失败：%v", err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

func (a *app) loadAdminAuditRows(ctx context.Context, limit int) ([]adminAuditRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := a.db.QueryContext(
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

	result := make([]adminAuditRow, 0, limit)
	for rows.Next() {
		var (
			item      adminAuditRow
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
