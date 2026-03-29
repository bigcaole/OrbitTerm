# OrbitTerm 小白教程（从 0 到可用）

本教程面向第一次接触 OrbitTerm 的用户，按最稳妥流程带你完成：
- 服务器部署同步后端
- Windows / macOS 客户端安装
- 账号注册、登录与多端同步
- 常见报错排查

你可以把它当作“照着做就能跑通”的操作手册。

---

## 1. 先明确 3 个概念

### 1.1 金库密码是什么
- 金库密码是你本机解锁 OrbitTerm 数据的密码。
- 它不上传到服务器。
- 多设备要同步同一份数据，必须使用同一个金库密码。

示例：
- 正确做法：Windows 和 macOS 都用 `Orbit#2026!Vault` 解锁。
- 错误做法：Windows 用 `A密码`，macOS 用 `B密码`，会导致同步包无法解密。

### 1.2 同步账号是什么
- 同步账号是邮箱 + 密码，用于连接你的私有同步服务。
- 它和“金库密码”不是同一个东西。

### 1.3 同步域名是什么
- 同步域名就是后端服务地址。
- 必须填完整 HTTPS 地址。

示例：
- `https://sync.example.com`（正确）
- `sync.example.com`（不完整）
- `http://sync.example.com`（生产环境不建议）

---

## 2. 部署前准备清单（先对照）

你需要准备：
1. 一台 Linux 服务器（建议 Ubuntu 22.04 或 24.04）。
2. 一个域名（例如 `sync.example.com`），已解析到服务器公网 IP。
3. 可访问 80/443 端口（用于 HTTPS 证书和外部访问）。
4. 一台 Windows 客户端和一台 macOS 客户端（用于双端验证）。

建议最低配置：
- 1 核 CPU
- 2GB 内存
- 20GB 可用磁盘

---

## 3. 服务器部署（Docker 方式）

> 目标：部署 OrbitTerm 同步后端，并让客户端可以通过 HTTPS 访问。

### 3.1 安装 Docker（Ubuntu 示例）

在服务器执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker --now
```

验证：

```bash
docker --version
docker compose version
```

看到版本号即表示安装成功。

### 3.2 准备部署目录

```bash
mkdir -p /opt/orbitterm-sync
cd /opt/orbitterm-sync
```

### 3.3 创建 `docker-compose.yml`

把下面内容保存为 `/opt/orbitterm-sync/docker-compose.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: orbitterm-sync-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: orbitterm_sync
      POSTGRES_USER: orbitterm
      POSTGRES_PASSWORD: "ReplaceWithStrongDbPassword"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orbitterm -d orbitterm_sync"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: ghcr.io/bigcaole/orbitterm-sync-backend:latest
    container_name: orbitterm-sync-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PORT: "8080"
      DATABASE_URL: "postgres://orbitterm:ReplaceWithStrongDbPassword@postgres:5432/orbitterm_sync?sslmode=disable"
      JWT_SECRET: "ReplaceWithLongRandomStringAtLeast32Chars"
      JWT_EXPIRE_HOURS: "720"
      ALLOW_INSECURE_HTTP: "false"
      CORS_ALLOW_ORIGINS: "https://sync.example.com"
      MAX_REQUEST_BODY_BYTES: "4194304"
      AUTH_RATE_LIMIT_PER_MIN: "30"
      SYNC_RATE_LIMIT_PER_MIN: "120"
      ADMIN_WEB_ENABLED: "true"
      ADMIN_USERNAME: "admin"
      ADMIN_PASSWORD: "ReplaceWithStrongAdminPassword"
      ADMIN_2FA_ENABLED: "false"
      ADMIN_2FA_METHOD: "totp"
      ADMIN_SESSION_HOURS: "12"
      BACKUP_AUTO_ENABLED: "false"
      BACKUP_AUTO_INTERVAL_MINUTES: "1440"
      BACKUP_AUTO_RETENTION_COUNT: "14"
      BACKUP_AUTO_OUTPUT_DIR: "/data/exports"
      BACKUP_AUTO_INCLUDE_AUDIT_LOGS: "false"
      BACKUP_AUTO_AUDIT_LIMIT: "2000"
    ports:
      - "127.0.0.1:8080:8080"

volumes:
  postgres_data:
```

### 3.4 启动容器

```bash
docker compose pull
docker compose up -d
docker compose ps
```

成功状态示例：
- `orbitterm-sync-postgres` 为 `healthy`
- `orbitterm-sync-api` 为 `running`

### 3.5 查看后端日志

```bash
docker compose logs -f api
```

看到服务监听信息、且没有持续报错，即可继续下一步。

---

## 4. 配置 HTTPS（必须）

OrbitTerm 同步服务建议只走 HTTPS。以下使用 Caddy 示例。

### 4.1 安装 Caddy（Ubuntu）

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 4.2 配置反向代理

编辑 `/etc/caddy/Caddyfile`：

```caddy
sync.example.com {
  reverse_proxy 127.0.0.1:8080 {
    header_up X-Forwarded-Proto https
    header_up X-Forwarded-Ssl on
  }
}
```

重载配置：

```bash
sudo systemctl reload caddy
```

验证：

```bash
curl -s https://sync.example.com/healthz
```

返回示例：

```json
{"status":"ok"}
```

---

## 5. 管理端首次登录

如果你开启了 `ADMIN_WEB_ENABLED=true`，访问：

- `https://sync.example.com/admin`

登录账号使用 `docker-compose.yml` 里的：
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

建议首次登录后立刻做 3 件事：
1. 修改管理员密码（或改为密码哈希方式）。
2. 开启管理员 2FA。
3. 在“备份”页面先手动做一次备份，确认备份链路可用。

---

## 6. Docker 变量怎么填（按小白理解）

| 变量名 | 作用 | 建议值 | 填错后常见现象 |
|---|---|---|---|
| `DATABASE_URL` | 连接数据库 | 按示例拼接 | 后端启动失败 |
| `JWT_SECRET` | 登录令牌签名密钥 | 32 位以上随机串 | 登录异常、会话异常 |
| `ALLOW_INSECURE_HTTP` | 是否允许 HTTP | 生产填 `false` | 非 HTTPS 请求被拒绝 |
| `CORS_ALLOW_ORIGINS` | 允许访问的来源域名 | `https://sync.example.com` | 某些前端请求被拦截 |
| `AUTH_RATE_LIMIT_PER_MIN` | 注册/登录限流 | `30` | 频繁操作时提示太频繁 |
| `SYNC_RATE_LIMIT_PER_MIN` | 同步限流 | `120` | 高频同步时返回 429 |
| `ADMIN_WEB_ENABLED` | 是否启用管理端 | `true` | `/admin` 无法打开 |
| `ADMIN_2FA_ENABLED` | 管理端是否启用 2FA | `true`（建议） | 登录时是否需要二次验证码 |
| `BACKUP_AUTO_ENABLED` | 是否自动备份 | `true` 或 `false` | 无自动备份文件 |

说明：
- 如果你当前只有客户端对接后端，不做浏览器跨站调用，`CORS_ALLOW_ORIGINS` 先填你的同步域名即可。
- 该项即使先不细分，也不会影响客户端基本注册与同步。

---

## 7. Windows 客户端安装与初始化

### 7.1 安装
1. 打开发布页下载 Windows 安装包（`.msi` 或 `.exe`）。
2. 双击安装，默认下一步即可。
3. 首次启动若有防火墙提示，选择允许。

### 7.2 首次引导
1. 打开 OrbitTerm。
2. 按引导设置金库密码。
3. 进入仪表盘后，先不要急着加主机，先完成同步登录。

金库密码示例：
- `Orbit#2026!Vault`

---

## 8. macOS 客户端安装与初始化

### 8.1 安装
1. 下载 `.dmg`。
2. 把 `OrbitTerm.app` 拖入 `Applications`。
3. 首次打开若被拦截，到系统“隐私与安全性”里允许打开。

### 8.2 首次引导
1. 打开 OrbitTerm。
2. 使用和 Windows 完全相同的金库密码初始化。
3. 解锁后进入仪表盘。

---

## 9. 注册账号并连接同步

以下步骤在 Windows 和 macOS 都做一次。

1. 解锁金库后，点击“连接账号”。
2. 服务地址填写：`https://sync.example.com`
3. 点击“注册”，填写邮箱和密码。
4. 注册成功后会自动登录（或手动登录）。

示例：
- 邮箱：`ops-team@example.com`
- 密码：`Team#Sync2026!`

如果提示“创建账号失败，请稍后再试”：
1. 先看服务器日志：`docker compose logs -f api`
2. 确认域名可访问：`curl -s https://sync.example.com/healthz`
3. 检查反向代理是否带了 HTTPS 转发头。

---

## 10. 第一次做多端同步（标准流程）

### 10.1 在 Windows 端操作
1. 添加一台测试主机，例如：
   - 名称：`test-ubuntu-01`
   - 地址：`192.168.1.30`
   - 端口：`22`
2. 保存后等待几秒（让自动推送完成）。

### 10.2 在 macOS 端操作
1. 保持登录同一同步账号。
2. 打开设置中的同步区域。
3. 点击“立即拉取”。
4. 返回主机列表，确认出现 `test-ubuntu-01`。

### 10.3 校验成功标准
- 两端主机列表一致。
- 在任一端新增/修改备注，另一端拉取后可见。
- 同步日志不出现“数据格式无效”“版本不兼容”等错误。

---

## 11. 日常使用建议（避免踩坑）

1. 新设备首次登录后，先“立即拉取”，再编辑数据。
2. 多设备都使用同一金库密码。
3. 服务器升级前，先做管理端备份。
4. 管理端开启 2FA，管理员密码与用户密码不要复用。
5. 不要将 `127.0.0.1:8080` 直接暴露公网，统一走 HTTPS 反代。

---

## 12. 常见问题速查

### Q1：客户端能登录，但同步失败
可能原因：
- 两端金库密码不一致
- 同步域名填错（如漏写 `https://`）
- 代理未正确转发 HTTPS 头

建议排查顺序：
1. 先确认两端金库密码一致。
2. 重新手动拉取一次。
3. 查看后端日志定位错误。

### Q2：提示 429
含义：请求太频繁，触发限流。  
处理：稍等 30~60 秒再试，或在后端调大限流值。

### Q3：提示 413
含义：单次同步数据包超过后端限制。  
处理：增大 `MAX_REQUEST_BODY_BYTES`。

### Q4：`/admin` 打不开
检查：
1. `ADMIN_WEB_ENABLED=true`
2. 域名与 HTTPS 正常
3. Caddy/Nginx 是否正确反代到 `127.0.0.1:8080`

---

## 13. 部署完成后的自检清单

全部满足即表示部署成功：
1. `https://sync.example.com/healthz` 返回 `{"status":"ok"}`。
2. Windows 可注册/登录同步账号。
3. macOS 可登录同账号并拉取到 Windows 的数据。
4. `/admin` 可登录。
5. 至少完成一次手动备份。

如果你按本文一步步执行，基本可以完成从 0 到可用的全流程部署。
