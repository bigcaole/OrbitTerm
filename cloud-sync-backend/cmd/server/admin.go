package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	adminSessionCookieName = "orbitterm_admin_session"
	adminSessionIssuer     = "orbitterm-admin"
)

type adminSessionClaims struct {
	jwt.RegisteredClaims
	IsAdmin bool `json:"isAdmin"`
}

type adminDashboardMetrics struct {
	TotalUsers       int64
	ActiveDevices    int64
	RevokedDevices   int64
	UsersWithVault   int64
	LatestSyncAt     string
	LatestSyncAtRaw  time.Time
	CurrentServerUTC string
}

type adminUserRow struct {
	ID            string
	Email         string
	CreatedAt     string
	VaultVersion  int64
	VaultUpdated  string
	ActiveDevices int64
}

type adminDeviceRow struct {
	ID             string
	UserID         string
	UserEmail      string
	DeviceName     string
	DeviceLocation string
	UserAgent      string
	LastSeenAt     string
	CreatedAt      string
	Revoked        bool
}

type adminPageData struct {
	Authenticated            bool
	Notice                   string
	Error                    string
	AdminUsername            string
	Admin2FAEnabled          bool
	Runtime                  runtimeSettings
	Metrics                  adminDashboardMetrics
	Users                    []adminUserRow
	Devices                  []adminDeviceRow
	AllowInsecureHTTP        bool
	CORSAllowOrigins         string
	MaxRequestBodySize       int64
	AuthRateLimit            int
	SyncRateLimit            int
	ClientDefaultSyncDomain  string
	ClientSyncDomainLocked   bool
	ClientHideSyncDomainEdit bool
}

var adminPageTemplate = template.Must(template.New("admin-page").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OrbitTerm 管理台</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050910;
      --panel: #0d1420;
      --panel-soft: #141f31;
      --line: #2c3c55;
      --text: #e6edf8;
      --muted: #9db1cf;
      --ok: #5fd4a0;
      --danger: #ff8f8f;
      --accent: #7fb1ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: radial-gradient(circle at 20% 0%, #152742 0%, var(--bg) 55%);
      color: var(--text);
    }
    .wrap { width: min(1180px, 96vw); margin: 24px auto 40px; }
    .card {
      background: linear-gradient(180deg, var(--panel) 0%, #0a111c 100%);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,.28);
    }
    .grid { display: grid; gap: 12px; }
    .grid.metrics { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .grid.two { grid-template-columns: 1fr 1fr; }
    h1, h2, h3 { margin: 0 0 8px; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; color: #dce9ff; }
    p { margin: 0; }
    .muted { color: var(--muted); font-size: 12px; }
    .spacer { height: 12px; }
    .topbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid #3e5b82;
      background: #12223a;
      color: #cde0ff;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      margin-right: 6px;
    }
    .metric-number { font-size: 24px; font-weight: 700; color: #f2f7ff; margin-top: 4px; }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
    .notice, .error {
      margin-bottom: 12px;
      border-radius: 10px;
      padding: 9px 11px;
      border: 1px solid;
      font-size: 13px;
    }
    .notice { border-color: #2a7f59; background: rgba(42,127,89,.2); color: #c6f3dc; }
    .error { border-color: #a04b4b; background: rgba(160,75,75,.22); color: #ffd2d2; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid #22344f;
      padding: 8px 6px;
      vertical-align: top;
      word-break: break-word;
    }
    th { color: #abc3e6; font-weight: 600; }
    form.inline { display: inline; }
    input[type=text], input[type=password], input[type=number] {
      width: 100%;
      border: 1px solid #385175;
      background: #0b1627;
      color: #e6efff;
      border-radius: 8px;
      padding: 8px 9px;
      font-size: 13px;
      outline: none;
    }
    input:focus { border-color: #70a0df; }
    label { display: block; margin-bottom: 8px; font-size: 12px; color: #c8daf6; }
    .fields { display: grid; gap: 10px; }
    .btn {
      border: 1px solid #496d98;
      background: #1a365c;
      color: #f1f6ff;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      cursor: pointer;
    }
    .btn:hover { background: #214578; }
    .btn-danger {
      border-color: #935151;
      background: #522525;
      color: #ffd7d7;
    }
    .btn-danger:hover { background: #663030; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .login-wrap {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 18px;
    }
    .login-card { width: min(460px, 96vw); }
    .pill {
      display: inline-block;
      border: 1px solid #395476;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      color: #bed3f0;
    }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
    @media (max-width: 920px) {
      .grid.two { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
  </style>
</head>
<body>
{{ if not .Authenticated }}
  <div class="login-wrap">
    <div class="card login-card">
      <h1>OrbitTerm 管理台登录</h1>
      <p class="muted">管理员入口默认关闭，启用后请通过 HTTPS 使用。</p>
      <div class="spacer"></div>
      {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}
      {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
      <form method="post" action="/admin/login" class="fields">
        <label>管理员账号
          <input type="text" name="username" autocomplete="username" required />
        </label>
        <label>管理员密码
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        {{ if .Admin2FAEnabled }}
        <label>2FA 验证码
          <input type="text" name="otp" autocomplete="one-time-code" minlength="6" maxlength="8" required />
        </label>
        {{ end }}
        <button class="btn" type="submit">登录管理台</button>
      </form>
    </div>
  </div>
{{ else }}
  <div class="wrap">
    <div class="topbar">
      <div>
        <h1>OrbitTerm 项目管理员控制台</h1>
        <p class="muted">登录账号：{{ .AdminUsername }} ｜ 服务时间(UTC)：{{ .Metrics.CurrentServerUTC }}</p>
        <p class="muted" style="margin-top:4px;">
          <a href="/admin/licenses" style="color:#b8d3ff;">激活码管理</a> ｜ 
          <a href="/admin/backup" style="color:#b8d3ff;">备份与恢复</a>
        </p>
      </div>
      <form method="post" action="/admin/logout">
        <button class="btn btn-danger" type="submit">退出登录</button>
      </form>
    </div>

    {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
    {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}

    <div class="grid metrics">
      <div class="card"><h3>用户总数</h3><div class="metric-number">{{ .Metrics.TotalUsers }}</div></div>
      <div class="card"><h3>在线设备</h3><div class="metric-number ok">{{ .Metrics.ActiveDevices }}</div></div>
      <div class="card"><h3>已撤销设备</h3><div class="metric-number">{{ .Metrics.RevokedDevices }}</div></div>
      <div class="card"><h3>已有云端金库</h3><div class="metric-number">{{ .Metrics.UsersWithVault }}</div></div>
      <div class="card"><h3>最近同步时间</h3><div class="metric-number" style="font-size:16px">{{ .Metrics.LatestSyncAt }}</div></div>
    </div>

    <div class="spacer"></div>

    <div class="grid two">
      <div class="card">
        <h2>运行参数（可在线生效）</h2>
        <p class="muted">保存后立即应用，并写入数据库表 admin_settings（容器重启后保留）。</p>
        <div class="spacer"></div>
        <form method="post" action="/admin/settings" class="fields">
          <label>CORS_ALLOW_ORIGINS
            <input type="text" name="cors_allow_origins" value="{{ .CORSAllowOrigins }}" />
          </label>
          <label>MAX_REQUEST_BODY_BYTES
            <input type="number" min="1024" max="67108864" name="max_request_body_bytes" value="{{ .MaxRequestBodySize }}" />
          </label>
          <label>AUTH_RATE_LIMIT_PER_MIN
            <input type="number" min="1" max="3000" name="auth_rate_limit_per_min" value="{{ .AuthRateLimit }}" />
          </label>
          <label>SYNC_RATE_LIMIT_PER_MIN
            <input type="number" min="1" max="5000" name="sync_rate_limit_per_min" value="{{ .SyncRateLimit }}" />
          </label>
          <label class="row">
            <span>ALLOW_INSECURE_HTTP（仅本地测试建议开启）</span>
            <input type="checkbox" name="allow_insecure_http" value="true" {{ if .AllowInsecureHTTP }}checked{{ end }} />
          </label>
          <label>客户端默认同步域名
            <input type="text" name="client_default_sync_domain" value="{{ .ClientDefaultSyncDomain }}" placeholder="https://sync.example.com" />
          </label>
          <label class="row">
            <span>锁定客户端同步域名（客户端不可改）</span>
            <input type="checkbox" name="client_sync_domain_locked" value="true" {{ if .ClientSyncDomainLocked }}checked{{ end }} />
          </label>
          <label class="row">
            <span>隐藏客户端同步域名输入框</span>
            <input type="checkbox" name="client_hide_sync_domain_edit" value="true" {{ if .ClientHideSyncDomainEdit }}checked{{ end }} />
          </label>
          <button class="btn" type="submit">保存并应用</button>
        </form>
      </div>

      <div class="card">
        <h2>管理员安全状态</h2>
        <div class="spacer"></div>
        <p><span class="pill">管理员账号</span> {{ .AdminUsername }}</p>
        <p class="spacer"></p>
        <p><span class="pill">2FA</span> {{ if .Admin2FAEnabled }}已开启{{ else }}未开启{{ end }}</p>
        <p class="muted">2FA 开关由环境变量 ADMIN_2FA_ENABLED 控制，验证码由 ADMIN_2FA_CODE 提供。</p>
        <div class="spacer"></div>
        <p><span class="pill">会话策略</span> Cookie + JWT（HttpOnly / SameSite=Lax）</p>
        <p class="muted">会话时长由 ADMIN_SESSION_HOURS 决定。</p>
      </div>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <h2>最近用户</h2>
      <table>
        <thead>
          <tr>
            <th>邮箱</th>
            <th>用户ID</th>
            <th>创建时间(UTC)</th>
            <th>云端版本</th>
            <th>云端更新时间</th>
            <th>在线设备</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {{ range .Users }}
          <tr>
            <td>{{ .Email }}</td>
            <td>{{ .ID }}</td>
            <td>{{ .CreatedAt }}</td>
            <td>{{ .VaultVersion }}</td>
            <td>{{ .VaultUpdated }}</td>
            <td>{{ .ActiveDevices }}</td>
            <td>
              <form class="inline" method="post" action="/admin/user/revoke-all">
                <input type="hidden" name="user_id" value="{{ .ID }}" />
                <button class="btn btn-danger" type="submit">退出该用户全部设备</button>
              </form>
            </td>
          </tr>
          {{ end }}
        </tbody>
      </table>
    </div>

    <div class="spacer"></div>

    <div class="card">
      <h2>最近设备</h2>
      <table>
        <thead>
          <tr>
            <th>设备ID</th>
            <th>账号邮箱</th>
            <th>设备名</th>
            <th>位置</th>
            <th>User-Agent</th>
            <th>最近活跃(UTC)</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {{ range .Devices }}
          <tr>
            <td>{{ .ID }}</td>
            <td>{{ .UserEmail }}</td>
            <td>{{ .DeviceName }}</td>
            <td>{{ .DeviceLocation }}</td>
            <td>{{ .UserAgent }}</td>
            <td>{{ .LastSeenAt }}</td>
            <td>{{ if .Revoked }}<span class="danger">已撤销</span>{{ else }}<span class="ok">活跃</span>{{ end }}</td>
            <td>
              {{ if not .Revoked }}
              <form class="inline" method="post" action="/admin/device/revoke">
                <input type="hidden" name="device_id" value="{{ .ID }}" />
                <button class="btn btn-danger" type="submit">撤销该设备</button>
              </form>
              {{ end }}
            </td>
          </tr>
          {{ end }}
        </tbody>
      </table>
    </div>
  </div>
{{ end }}
</body>
</html>`))

func (a *app) registerAdminRoutes(router *gin.Engine) {
	if !a.cfg.AdminWebEnabled {
		return
	}
	router.GET("/setup", a.handleSetupPage)
	router.POST("/setup", a.handleSetupSubmit)

	router.GET("/admin", a.handleAdminPage)
	router.POST(
		"/admin/login",
		a.rateLimitMiddleware(a.adminLimiter, "管理员登录过于频繁，请稍后再试。"),
		a.handleAdminLogin,
	)

	adminGroup := router.Group("/admin")
	adminGroup.Use(a.adminAuthMiddleware())
	adminGroup.POST("/logout", a.handleAdminLogout)
	adminGroup.POST("/settings", a.handleAdminUpdateSettings)
	adminGroup.POST("/device/revoke", a.handleAdminRevokeDevice)
	adminGroup.POST("/user/revoke-all", a.handleAdminRevokeAllUserDevices)
	adminGroup.GET("/licenses", a.handleAdminLicensePage)
	adminGroup.POST("/licenses/generate", a.handleAdminGenerateLicenseCodes)
	adminGroup.POST("/licenses/disable", a.handleAdminDisableLicenseCode)
	adminGroup.GET("/backup", a.handleAdminBackupPage)
	adminGroup.GET("/backup/export", a.handleAdminBackupExport)
	adminGroup.POST("/backup/import", a.handleAdminBackupImport)
}

func (a *app) buildAdminSessionToken() (string, error) {
	expireAt := time.Now().UTC().Add(time.Duration(a.cfg.AdminSessionHours) * time.Hour)
	claims := adminSessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    adminSessionIssuer,
			Subject:   a.cfg.AdminUsername,
			ExpiresAt: jwt.NewNumericDate(expireAt),
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
		},
		IsAdmin: true,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(a.cfg.JWTSecret))
}

func (a *app) parseAdminSessionToken(tokenString string) (*adminSessionClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &adminSessionClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("签名算法无效")
		}
		return []byte(a.cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*adminSessionClaims)
	if !ok || !token.Valid || !claims.IsAdmin {
		return nil, errors.New("管理员会话无效")
	}
	if strings.TrimSpace(claims.Issuer) != adminSessionIssuer || strings.TrimSpace(claims.Subject) != a.cfg.AdminUsername {
		return nil, errors.New("管理员会话无效")
	}
	return claims, nil
}

func (a *app) setAdminSessionCookie(c *gin.Context, token string) {
	maxAge := a.cfg.AdminSessionHours * 3600
	secure := !a.getRuntimeSettings().AllowInsecureHTTP
	c.SetCookie(adminSessionCookieName, token, maxAge, "/admin", "", secure, true)
}

func (a *app) clearAdminSessionCookie(c *gin.Context) {
	secure := !a.getRuntimeSettings().AllowInsecureHTTP
	c.SetCookie(adminSessionCookieName, "", -1, "/admin", "", secure, true)
}

func (a *app) adminAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.isSetupComplete() {
			c.Redirect(http.StatusFound, "/setup")
			c.Abort()
			return
		}
		rawCookie, err := c.Cookie(adminSessionCookieName)
		if err != nil || strings.TrimSpace(rawCookie) == "" {
			c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("请先登录管理员账号。"))
			c.Abort()
			return
		}

		claims, parseErr := a.parseAdminSessionToken(strings.TrimSpace(rawCookie))
		if parseErr != nil {
			a.clearAdminSessionCookie(c)
			c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("管理员会话已失效，请重新登录。"))
			c.Abort()
			return
		}

		c.Set("adminUsername", claims.Subject)
		c.Next()
	}
}

func (a *app) handleAdminPage(c *gin.Context) {
	if !a.isSetupComplete() {
		c.Redirect(http.StatusFound, "/setup")
		return
	}
	notice := strings.TrimSpace(c.Query("notice"))
	errorMessage := strings.TrimSpace(c.Query("error"))
	cookieToken, cookieErr := c.Cookie(adminSessionCookieName)
	if cookieErr != nil || strings.TrimSpace(cookieToken) == "" {
		a.renderAdminPage(c, adminPageData{
			Authenticated:   false,
			Notice:          notice,
			Error:           errorMessage,
			Admin2FAEnabled: a.cfg.Admin2FAEnabled,
		})
		return
	}

	if _, parseErr := a.parseAdminSessionToken(strings.TrimSpace(cookieToken)); parseErr != nil {
		a.clearAdminSessionCookie(c)
		a.renderAdminPage(c, adminPageData{
			Authenticated:   false,
			Notice:          notice,
			Error:           "管理员会话已失效，请重新登录。",
			Admin2FAEnabled: a.cfg.Admin2FAEnabled,
		})
		return
	}

	metrics, metricsErr := a.loadAdminMetrics(c.Request.Context())
	if metricsErr != nil {
		a.renderAdminPage(c, adminPageData{
			Authenticated:   true,
			AdminUsername:   a.cfg.AdminUsername,
			Admin2FAEnabled: a.cfg.Admin2FAEnabled,
			Notice:          notice,
			Error:           "读取统计信息失败，请稍后刷新。",
		})
		return
	}
	users, userErr := a.loadAdminUsers(c.Request.Context())
	if userErr != nil {
		errorMessage = "读取用户信息失败，请稍后刷新。"
	}
	devices, deviceErr := a.loadAdminDevices(c.Request.Context())
	if deviceErr != nil {
		errorMessage = "读取设备信息失败，请稍后刷新。"
	}
	if strings.TrimSpace(c.Query("error")) != "" {
		errorMessage = strings.TrimSpace(c.Query("error"))
	}

	currentRuntime := a.getRuntimeSettings()
	adminSettings, settingsErr := a.readAdminSettings(c.Request.Context())
	if settingsErr != nil {
		errorMessage = "读取系统配置失败，请稍后刷新。"
	}
	clientDefaultSyncDomain := strings.TrimSpace(adminSettings[settingClientDefaultSyncDomain])
	clientSyncDomainLocked := parseBoolString(adminSettings[settingClientSyncDomainLocked], false)
	clientHideSyncDomainEdit := parseBoolString(adminSettings[settingClientHideSyncDomainEdit], false)
	a.renderAdminPage(c, adminPageData{
		Authenticated:            true,
		Notice:                   notice,
		Error:                    strings.TrimSpace(errorMessage),
		AdminUsername:            a.cfg.AdminUsername,
		Admin2FAEnabled:          a.cfg.Admin2FAEnabled,
		Runtime:                  currentRuntime,
		Metrics:                  metrics,
		Users:                    users,
		Devices:                  devices,
		AllowInsecureHTTP:        currentRuntime.AllowInsecureHTTP,
		CORSAllowOrigins:         currentRuntime.CORSAllowOrigins,
		MaxRequestBodySize:       currentRuntime.MaxRequestBodyBytes,
		AuthRateLimit:            currentRuntime.AuthRateLimitPerMin,
		SyncRateLimit:            currentRuntime.SyncRateLimitPerMin,
		ClientDefaultSyncDomain:  clientDefaultSyncDomain,
		ClientSyncDomainLocked:   clientSyncDomainLocked,
		ClientHideSyncDomainEdit: clientHideSyncDomainEdit,
	})
}

func (a *app) renderAdminPage(c *gin.Context, payload adminPageData) {
	var html bytes.Buffer
	if err := adminPageTemplate.Execute(&html, payload); err != nil {
		c.String(http.StatusInternalServerError, "管理员页面渲染失败：%v", err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

func (a *app) handleAdminLogin(c *gin.Context) {
	if !a.cfg.AdminWebEnabled {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if !a.isSetupComplete() {
		c.Redirect(http.StatusFound, "/setup")
		return
	}

	username := strings.TrimSpace(c.PostForm("username"))
	password := c.PostForm("password")
	otp := strings.TrimSpace(c.PostForm("otp"))

	if username != a.cfg.AdminUsername {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("管理员账号或密码错误。"))
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(a.cfg.AdminPasswordHash), []byte(password)) != nil {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("管理员账号或密码错误。"))
		return
	}
	if a.cfg.Admin2FAEnabled {
		if otp == "" || otp != a.cfg.Admin2FACode {
			c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("2FA 验证失败，请检查验证码。"))
			return
		}
	}

	token, err := a.buildAdminSessionToken()
	if err != nil {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("创建管理员会话失败，请重试。"))
		return
	}
	a.setAdminSessionCookie(c, token)
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("管理员登录成功。"))
}

func (a *app) handleAdminLogout(c *gin.Context) {
	a.clearAdminSessionCookie(c)
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("已退出管理员登录。"))
}

func (a *app) handleAdminUpdateSettings(c *gin.Context) {
	current := a.getRuntimeSettings()

	nextCORS := strings.TrimSpace(c.PostForm("cors_allow_origins"))
	if nextCORS == "" {
		nextCORS = "*"
	}
	nextAllowInsecure := strings.TrimSpace(c.PostForm("allow_insecure_http")) == "true"

	maxBodyRaw := strings.TrimSpace(c.PostForm("max_request_body_bytes"))
	nextMaxBody, maxBodyErr := strconv.ParseInt(maxBodyRaw, 10, 64)
	if maxBodyErr != nil || nextMaxBody < 1024 || nextMaxBody > 64*1024*1024 {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("MAX_REQUEST_BODY_BYTES 必须在 1024 到 67108864 之间。"))
		return
	}

	authLimitRaw := strings.TrimSpace(c.PostForm("auth_rate_limit_per_min"))
	nextAuthLimit, authErr := strconv.Atoi(authLimitRaw)
	if authErr != nil || nextAuthLimit <= 0 || nextAuthLimit > 3000 {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("AUTH_RATE_LIMIT_PER_MIN 必须在 1 到 3000 之间。"))
		return
	}

	syncLimitRaw := strings.TrimSpace(c.PostForm("sync_rate_limit_per_min"))
	nextSyncLimit, syncErr := strconv.Atoi(syncLimitRaw)
	if syncErr != nil || nextSyncLimit <= 0 || nextSyncLimit > 5000 {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("SYNC_RATE_LIMIT_PER_MIN 必须在 1 到 5000 之间。"))
		return
	}

	clientDefaultSyncDomain := strings.TrimSpace(c.PostForm("client_default_sync_domain"))
	clientSyncDomainLocked := strings.TrimSpace(c.PostForm("client_sync_domain_locked")) == "true"
	clientHideSyncDomainEdit := strings.TrimSpace(c.PostForm("client_hide_sync_domain_edit")) == "true"

	next := runtimeSettings{
		AllowInsecureHTTP:   nextAllowInsecure,
		CORSAllowOrigins:    nextCORS,
		MaxRequestBodyBytes: nextMaxBody,
		AuthRateLimitPerMin: nextAuthLimit,
		SyncRateLimitPerMin: nextSyncLimit,
	}

	tx, err := a.db.BeginTx(c.Request.Context(), &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("保存设置失败，请稍后重试。"))
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	upsertSettings := []struct {
		key   string
		value string
	}{
		{key: "allow_insecure_http", value: strconv.FormatBool(next.AllowInsecureHTTP)},
		{key: "cors_allow_origins", value: next.CORSAllowOrigins},
		{key: "max_request_body_bytes", value: strconv.FormatInt(next.MaxRequestBodyBytes, 10)},
		{key: "auth_rate_limit_per_min", value: strconv.Itoa(next.AuthRateLimitPerMin)},
		{key: "sync_rate_limit_per_min", value: strconv.Itoa(next.SyncRateLimitPerMin)},
		{key: settingClientDefaultSyncDomain, value: clientDefaultSyncDomain},
		{key: settingClientSyncDomainLocked, value: strconv.FormatBool(clientSyncDomainLocked)},
		{key: settingClientHideSyncDomainEdit, value: strconv.FormatBool(clientHideSyncDomainEdit)},
	}
	for _, item := range upsertSettings {
		if _, execErr := tx.ExecContext(
			c.Request.Context(),
			`INSERT INTO admin_settings (key, value, updated_at)
			 VALUES ($1, $2, NOW())
			 ON CONFLICT (key) DO UPDATE
			 SET value = EXCLUDED.value,
			     updated_at = NOW()`,
			item.key,
			item.value,
		); execErr != nil {
			c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("保存设置失败，请稍后重试。"))
			return
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("保存设置失败，请稍后重试。"))
		return
	}

	a.applyRuntimeSettings(next)
	if current.AllowInsecureHTTP != next.AllowInsecureHTTP {
		c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("参数已更新。ALLOW_INSECURE_HTTP 已生效，建议确认反向代理策略。"))
		return
	}
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("参数已更新并生效。"))
}

func (a *app) handleAdminRevokeDevice(c *gin.Context) {
	deviceID := strings.TrimSpace(c.PostForm("device_id"))
	if deviceID == "" {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("缺少 device_id。"))
		return
	}

	result, err := a.db.ExecContext(
		c.Request.Context(),
		`UPDATE user_devices
		 SET revoked_at = NOW(),
		     current_token_jti = NULL,
		     token_expires_at = NULL
		 WHERE id = $1 AND revoked_at IS NULL`,
		deviceID,
	)
	if err != nil {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("撤销设备失败，请稍后重试。"))
		return
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("未找到可撤销设备，可能已失效。"))
		return
	}
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("设备会话已撤销。"))
}

func (a *app) handleAdminRevokeAllUserDevices(c *gin.Context) {
	userID := strings.TrimSpace(c.PostForm("user_id"))
	if userID == "" {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("缺少 user_id。"))
		return
	}

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
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("批量退出设备失败，请稍后重试。"))
		return
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.Redirect(http.StatusFound, "/admin?error="+url.QueryEscape("该用户没有可撤销的在线设备。"))
		return
	}
	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("该用户所有设备会话已撤销。"))
}

func (a *app) loadAdminMetrics(ctx context.Context) (adminDashboardMetrics, error) {
	var metrics adminDashboardMetrics
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&metrics.TotalUsers); err != nil {
		return adminDashboardMetrics{}, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_devices WHERE revoked_at IS NULL`).Scan(&metrics.ActiveDevices); err != nil {
		return adminDashboardMetrics{}, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_devices WHERE revoked_at IS NOT NULL`).Scan(&metrics.RevokedDevices); err != nil {
		return adminDashboardMetrics{}, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM vault_blobs`).Scan(&metrics.UsersWithVault); err != nil {
		return adminDashboardMetrics{}, err
	}

	var latestSync sql.NullTime
	if err := a.db.QueryRowContext(ctx, `SELECT MAX(updated_at) FROM vault_blobs`).Scan(&latestSync); err != nil {
		return adminDashboardMetrics{}, err
	}
	if latestSync.Valid {
		metrics.LatestSyncAtRaw = latestSync.Time.UTC()
		metrics.LatestSyncAt = latestSync.Time.UTC().Format(time.RFC3339)
	} else {
		metrics.LatestSyncAt = "暂无同步记录"
	}
	metrics.CurrentServerUTC = time.Now().UTC().Format(time.RFC3339)
	return metrics, nil
}

func (a *app) loadAdminUsers(ctx context.Context) ([]adminUserRow, error) {
	rows, err := a.db.QueryContext(
		ctx,
		`SELECT
			u.id,
			u.email,
			u.created_at,
			COALESCE(v.version, 0) AS vault_version,
			v.updated_at,
			COALESCE(d.active_device_count, 0) AS active_devices
		FROM users AS u
		LEFT JOIN vault_blobs AS v
		  ON v.user_id = u.id
		LEFT JOIN (
		  SELECT user_id, COUNT(*) AS active_device_count
		  FROM user_devices
		  WHERE revoked_at IS NULL
		  GROUP BY user_id
		) AS d
		  ON d.user_id = u.id
		ORDER BY u.created_at DESC
		LIMIT 80`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]adminUserRow, 0, 80)
	for rows.Next() {
		var (
			item       adminUserRow
			createdAt  time.Time
			vaultAtRaw sql.NullTime
		)
		if scanErr := rows.Scan(
			&item.ID,
			&item.Email,
			&createdAt,
			&item.VaultVersion,
			&vaultAtRaw,
			&item.ActiveDevices,
		); scanErr != nil {
			return nil, scanErr
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if vaultAtRaw.Valid {
			item.VaultUpdated = vaultAtRaw.Time.UTC().Format(time.RFC3339)
		} else {
			item.VaultUpdated = "-"
		}
		users = append(users, item)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, rowsErr
	}
	return users, nil
}

func (a *app) loadAdminDevices(ctx context.Context) ([]adminDeviceRow, error) {
	rows, err := a.db.QueryContext(
		ctx,
		`SELECT
			d.id,
			d.user_id,
			u.email,
			d.device_name,
			d.device_location,
			d.user_agent,
			d.last_seen_at,
			d.created_at,
			(d.revoked_at IS NOT NULL) AS revoked
		FROM user_devices AS d
		INNER JOIN users AS u
		  ON u.id = d.user_id
		ORDER BY d.last_seen_at DESC
		LIMIT 120`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := make([]adminDeviceRow, 0, 120)
	for rows.Next() {
		var (
			item      adminDeviceRow
			lastSeen  time.Time
			createdAt time.Time
		)
		if scanErr := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.UserEmail,
			&item.DeviceName,
			&item.DeviceLocation,
			&item.UserAgent,
			&lastSeen,
			&createdAt,
			&item.Revoked,
		); scanErr != nil {
			return nil, scanErr
		}
		item.LastSeenAt = lastSeen.UTC().Format(time.RFC3339)
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		devices = append(devices, item)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, rowsErr
	}
	return devices, nil
}
