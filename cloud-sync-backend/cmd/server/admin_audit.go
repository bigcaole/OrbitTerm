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
    .wrap { width:min(1220px,96vw); margin:20px auto 34px; }
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
    .card { border:1px solid var(--line); background:var(--panel); border-radius:16px; padding:16px; box-shadow:0 8px 24px rgba(48,79,66,.08); }
    h1,h2 { margin:0 0 8px; }
    h1 { font-size:22px; }
    h2 { color:#2f433e; font-size:15px; }
    .muted { color:var(--muted); font-size:12px; line-height:1.6; }
    .notice,.error { border-radius:10px; padding:9px 11px; margin-bottom:10px; font-size:13px; }
    .notice { border:1px solid #b7dbc7; background:var(--notice-soft); color:#26694f; }
    .error { border:1px solid #e8c1be; background:var(--danger-soft); color:#8b3b3b; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
    th,td { text-align:left; border-bottom:1px solid #dce8e2; padding:9px 7px; vertical-align:top; }
    th { color:#45655d; background:#f4f8f6; position:sticky; top:0; }
    tbody tr:hover td { background:#f8fbf9; }
    .ok { color:#2f775f; font-weight:600; }
    .fail { color:#b25b5b; font-weight:600; }
    @media (max-width: 980px) { table { display:block; overflow:auto; white-space:nowrap; } .top { position: static; } }
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
