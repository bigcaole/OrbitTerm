package main

import (
	"bytes"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type setupPageData struct {
	Error            string
	Notice           string
	NeedInitToken    bool
	DefaultAdminUser string
}

var setupPageTemplate = template.Must(template.New("setup-page").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OrbitTerm 初始化向导</title>
  <style>
    :root {
      --bg: #f2f8ff;
      --card: #ffffff;
      --line: #c5d7ef;
      --text: #1f334d;
      --muted: #5d7390;
      --brand: #2f6df5;
      --danger: #d84d4d;
      --ok: #2b9b63;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 10% 0%, #ddebff 0%, transparent 40%),
        radial-gradient(circle at 90% 0%, #d6f9ef 0%, transparent 35%),
        var(--bg);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .card {
      width: min(680px, 96vw);
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--card);
      box-shadow: 0 14px 40px rgba(31, 71, 122, .13);
      padding: 22px;
    }
    .hero {
      border: 1px solid #d0e2ff;
      border-radius: 14px;
      padding: 14px;
      background: linear-gradient(120deg, #edf5ff 0%, #f7fffc 100%);
      margin-bottom: 14px;
    }
    h1 { margin: 0; font-size: 22px; }
    p { margin: 0; }
    .muted { color: var(--muted); font-size: 13px; margin-top: 6px; line-height: 1.55; }
    .error, .notice {
      border-radius: 10px;
      padding: 10px 12px;
      margin: 10px 0;
      font-size: 13px;
    }
    .error {
      border: 1px solid #efc1c1;
      color: #9f2d2d;
      background: #fff3f3;
    }
    .notice {
      border: 1px solid #bce3cf;
      color: #176741;
      background: #f2fff8;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 12px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #47617f;
      margin-bottom: 8px;
    }
    input[type=text], input[type=password], input[type=number] {
      width: 100%;
      border: 1px solid #b9cee9;
      border-radius: 10px;
      padding: 9px 10px;
      font-size: 14px;
      color: #12243a;
      background: #f9fcff;
      outline: none;
    }
    input:focus {
      border-color: #73a5f2;
      background: #ffffff;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 8px 0;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid #d7e5f7;
      background: #f8fbff;
      font-size: 13px;
    }
    .actions {
      margin-top: 14px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    button {
      border: 1px solid #2d63d9;
      background: var(--brand);
      color: #fff;
      border-radius: 10px;
      padding: 10px 13px;
      font-weight: 600;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #2254c9;
    }
    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <h1>OrbitTerm 首次初始化</h1>
      <p class="muted">此页面用于完成服务端一次性初始化。完成后将自动关闭引导，进入管理员登录页。</p>
      <p class="muted">你只需要部署 DATABASE_URL（和可选 PORT），其余参数可在管理台后续调整。</p>
    </div>
    {{ if .Error }}<div class="error">{{ .Error }}</div>{{ end }}
    {{ if .Notice }}<div class="notice">{{ .Notice }}</div>{{ end }}
    <form method="post" action="/setup">
      {{ if .NeedInitToken }}
      <label>初始化口令（SETUP_INIT_TOKEN）
        <input type="password" name="init_token" autocomplete="off" required />
      </label>
      {{ end }}
      <div class="grid">
        <label>管理员账号
          <input type="text" name="admin_username" maxlength="64" value="{{ .DefaultAdminUser }}" required />
        </label>
        <label>管理员会话时长（小时）
          <input type="number" name="admin_session_hours" min="1" max="168" value="12" required />
        </label>
      </div>
      <div class="grid">
        <label>管理员密码
          <input type="password" name="admin_password" minlength="8" maxlength="128" required />
        </label>
        <label>确认管理员密码
          <input type="password" name="admin_password_confirm" minlength="8" maxlength="128" required />
        </label>
      </div>
      <div class="row">
        <span>启用管理员 2FA 验证</span>
        <input type="checkbox" name="admin_2fa_enabled" value="true" />
      </div>
      <label>2FA 验证码（当开启 2FA 时必填，建议 6~8 位）
        <input type="text" name="admin_2fa_code" maxlength="16" />
      </label>
      <div class="actions">
        <button type="submit">完成初始化并进入管理台</button>
      </div>
    </form>
  </div>
</body>
</html>`))

func (a *app) handleSetupPage(c *gin.Context) {
	if !a.cfg.AdminWebEnabled {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if a.isSetupComplete() {
		c.Redirect(http.StatusFound, "/admin")
		return
	}

	payload := setupPageData{
		Error:            strings.TrimSpace(c.Query("error")),
		Notice:           strings.TrimSpace(c.Query("notice")),
		NeedInitToken:    strings.TrimSpace(a.cfg.SetupInitToken) != "",
		DefaultAdminUser: "admin",
	}
	var html bytes.Buffer
	if err := setupPageTemplate.Execute(&html, payload); err != nil {
		c.String(http.StatusInternalServerError, "初始化页面渲染失败：%v", err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", html.Bytes())
}

func (a *app) handleSetupSubmit(c *gin.Context) {
	if !a.cfg.AdminWebEnabled {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if a.isSetupComplete() {
		c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("系统已初始化，无需重复设置。"))
		return
	}

	if strings.TrimSpace(a.cfg.SetupInitToken) != "" {
		initToken := strings.TrimSpace(c.PostForm("init_token"))
		if initToken == "" || initToken != strings.TrimSpace(a.cfg.SetupInitToken) {
			c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("初始化口令错误。"))
			return
		}
	}

	adminUsername := strings.TrimSpace(c.PostForm("admin_username"))
	adminPassword := c.PostForm("admin_password")
	adminPasswordConfirm := c.PostForm("admin_password_confirm")
	admin2FAEnabled := strings.TrimSpace(c.PostForm("admin_2fa_enabled")) == "true"
	admin2FACode := strings.TrimSpace(c.PostForm("admin_2fa_code"))
	adminSessionHoursRaw := strings.TrimSpace(c.PostForm("admin_session_hours"))

	if adminUsername == "" {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("管理员账号不能为空。"))
		return
	}
	if len(adminUsername) > 64 {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("管理员账号长度不能超过 64。"))
		return
	}
	if len(strings.TrimSpace(adminPassword)) < 8 {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("管理员密码至少 8 位。"))
		return
	}
	if adminPassword != adminPasswordConfirm {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("两次输入的管理员密码不一致。"))
		return
	}
	if admin2FAEnabled && admin2FACode == "" {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("开启 2FA 时必须填写验证码。"))
		return
	}

	adminSessionHours, err := strconv.Atoi(adminSessionHoursRaw)
	if err != nil || adminSessionHours <= 0 || adminSessionHours > 168 {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("管理员会话时长必须在 1~168 小时之间。"))
		return
	}

	hashBytes, hashErr := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if hashErr != nil {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("管理员密码处理失败，请重试。"))
		return
	}

	settings := map[string]string{
		settingAdminWebEnabled:   strconv.FormatBool(true),
		settingAdminUsername:     adminUsername,
		settingAdminPasswordHash: string(hashBytes),
		settingAdminRole:         "superadmin",
		settingAdmin2FAEnabled:   strconv.FormatBool(admin2FAEnabled),
		settingAdminSessionHours: strconv.Itoa(adminSessionHours),
	}
	if admin2FAEnabled {
		settings[settingAdmin2FACode] = admin2FACode
	} else {
		settings[settingAdmin2FACode] = ""
	}

	if err := a.upsertAdminSettings(c.Request.Context(), settings); err != nil {
		c.Redirect(http.StatusFound, "/setup?error="+url.QueryEscape("初始化保存失败，请稍后重试。"))
		return
	}

	a.cfg.AdminWebEnabled = true
	a.cfg.AdminUsername = adminUsername
	a.cfg.AdminPasswordHash = string(hashBytes)
	a.cfg.AdminRole = "superadmin"
	a.cfg.Admin2FAEnabled = admin2FAEnabled
	a.cfg.Admin2FACode = admin2FACode
	a.cfg.AdminSessionHours = adminSessionHours

	c.Redirect(http.StatusFound, "/admin?notice="+url.QueryEscape("初始化完成，请登录管理员账号。"))
}
