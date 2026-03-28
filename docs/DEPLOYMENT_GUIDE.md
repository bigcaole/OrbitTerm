# OrbitTerm 部署教程（小白版）

本教程覆盖：
- 客户端双端安装（Windows + macOS）
- 私有云同步后端在服务器上的 Docker 部署
- 生产环境 HTTPS 反向代理
- 变量参数说明、注意事项与故障排查

> 推荐按顺序执行，不要跳步骤。

---

## 1. 你需要先准备什么

1. 一台 Linux 服务器（推荐 Ubuntu 22.04/24.04，至少 1 核 2G 内存）。
2. 一个域名（示例：`sync.yourdomain.com`），并解析到服务器公网 IP。
3. 可开放端口：`22`、`80`、`443`（生产环境不建议直接暴露 `8080`）。
4. 两台客户端设备（例如 Windows + macOS），用于双端同步验证。

---

## 2. 客户端双端安装

### 2.1 下载

前往 GitHub Releases 下载客户端：

- 项目发布页：<https://github.com/bigcaole/OrbitTerm/releases>
- 示例版本：`v0.1.17`

常见安装包：
- Windows：`.msi` / `.exe`
- macOS：`.dmg`

### 2.2 Windows 安装

1. 下载 `.msi` 或 `.exe`。
2. 双击安装并启动。
3. 首次运行若弹出防火墙提示，选择允许。

### 2.3 macOS 安装

1. 下载 `.dmg`，拖拽 `OrbitTerm.app` 到 `Applications`。
2. 若首次打开被系统拦截，进入“系统设置 -> 隐私与安全性”允许打开。

### 2.4 首次使用

1. 两端都先设置本地主密码（这是本地金库密码，不会上云）。
2. 后端部署完成后，再在客户端配置“云同步服务地址”。

---

## 3. 服务器安装 Docker 与 Compose（Ubuntu）

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

---

## 4. 部署后端（Docker Compose）

### 4.1 拉取代码

```bash
git clone git@github.com:bigcaole/OrbitTerm.git
cd OrbitTerm/cloud-sync-backend
```

### 4.2 修改 `docker-compose.yml`

建议基于项目内 `docker-compose.yml` 修改。关键是改掉默认密码、密钥和域名来源。

如果你不想在服务器本地编译，也可以直接使用预构建镜像：

- `ghcr.io/bigcaole/orbitterm-sync-backend:latest`

下面是生产可用示例（可保存为 `docker-compose.prod.yml`）：

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    container_name: orbitterm-sync-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: orbitterm_sync
      POSTGRES_USER: orbitterm
      POSTGRES_PASSWORD: "请替换为强密码"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./sql/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orbitterm -d orbitterm_sync"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: orbitterm-sync-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PORT: "8080"
      DATABASE_URL: "postgres://orbitterm:请替换为强密码@postgres:5432/orbitterm_sync?sslmode=disable"
      JWT_SECRET: "请替换为32字节以上随机长串"
      JWT_EXPIRE_HOURS: "720"
      ALLOW_INSECURE_HTTP: "false"
      CORS_ALLOW_ORIGINS: "https://app.orbitterm.example,https://orbitterm.example"
      MAX_REQUEST_BODY_BYTES: "4194304"
      AUTH_RATE_LIMIT_PER_MIN: "30"
      SYNC_RATE_LIMIT_PER_MIN: "120"
      ADMIN_WEB_ENABLED: "true"
      ADMIN_USERNAME: "admin"
      ADMIN_PASSWORD: "请替换为管理员强密码"
      ADMIN_2FA_ENABLED: "false"
      ADMIN_2FA_CODE: "123456"
      ADMIN_SESSION_HOURS: "12"
    ports:
      - "127.0.0.1:8080:8080"

volumes:
  postgres_data:
```

如果使用预构建镜像，把 `api` 的 `build` 段替换为：

```yaml
api:
  image: ghcr.io/bigcaole/orbitterm-sync-backend:latest
```

### 4.3 启动服务

```bash
docker compose up -d --build
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f api
```

---

## 5. 变量参数详解（Docker 环境）

- `PORT`：API 监听端口，默认 `8080`。
- `DATABASE_URL`：PostgreSQL 连接串，必填。
- `JWT_SECRET`：JWT 签名密钥，必填，且长度至少 32 字节。
- `JWT_EXPIRE_HOURS`：登录令牌有效期（小时），默认 `720`。
- `ALLOW_INSECURE_HTTP`：是否允许 HTTP，生产必须 `false`。
- `CORS_ALLOW_ORIGINS`：允许跨域来源，多个用逗号分隔。
- `MAX_REQUEST_BODY_BYTES`：请求体最大字节数，默认 `4194304`（4MB）。
- `AUTH_RATE_LIMIT_PER_MIN`：登录/注册限流（每分钟每 IP+路由）。
- `SYNC_RATE_LIMIT_PER_MIN`：同步接口限流（每分钟每 IP+路由）。
- `ADMIN_WEB_ENABLED`：是否启用管理员 Web（`/admin`）。
- `ADMIN_USERNAME`：管理员登录账号。
- `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`：管理员密码（二选一，生产建议用哈希）。
- `ADMIN_2FA_ENABLED`：管理员登录是否强制二次验证码。
- `ADMIN_2FA_CODE`：管理员二次验证码（开启 2FA 时必填）。
- `ADMIN_SESSION_HOURS`：管理员会话有效时长（小时）。

---

## 6. 生产环境 HTTPS 反向代理（必须）

后端默认强制 HTTPS 语义。如果你直接 HTTP 访问，会被拒绝。

推荐使用 Caddy（自动申请证书）：

`/etc/caddy/Caddyfile` 示例：

```caddy
sync.yourdomain.com {
  reverse_proxy 127.0.0.1:8080 {
    header_up X-Forwarded-Proto https
    header_up X-Forwarded-Ssl on
  }
}
```

验证：

```bash
curl -s https://sync.yourdomain.com/healthz
```

应看到 `{"status":"ok",...}`。

---

## 7. 在客户端接入云同步

1. 打开 OrbitTerm 客户端。
2. 输入金库主密码解锁后，会弹出“登录 / 注册 / 跳过”同步窗口。
3. 服务地址填：`https://sync.yourdomain.com`。
4. 注册/登录同一个账号（登录状态会自动持久化，后续无需重复登录）。
5. 多设备必须使用**同一个主密码**解锁本地金库，否则无法解密云端同步包。
6. 新设备首次登录后，先点一次“立即拉取”，确认拉取成功后再开始编辑数据。
7. 在设备 A 修改主机后，设备 B 登录同账号即可同步到最新数据。
8. 客户端不再提供“本地备份导入/导出”入口，设计上以云同步作为客户端备份能力。

---

## 8. 项目管理员 Web（/admin）

启用 `ADMIN_WEB_ENABLED=true` 后，可访问：

`https://sync.yourdomain.com/admin`

管理员 Web 支持：
- 查看全局状态（用户数、在线设备、同步概览）
- 按用户一键撤销全部设备登录
- 单设备会话撤销
- 在线调整关键运行参数（CORS、请求体上限、限流等），并持久化到数据库 `admin_settings`
- 备份与恢复（逻辑 JSON + 数据库 SQL 快照导出）

### 8.1 管理端备份覆盖范围（专业建议）

`/admin/backup` 中现在有两种备份：

1. 逻辑备份（JSON，推荐）
   - 适合跨版本迁移与日常恢复。
   - 默认覆盖以下业务核心表：
     - `admin_settings`（管理端配置）
     - `users`（注册账号与密码哈希）
     - `vault_blobs`（客户端同步密文，包含主机/身份/指令等业务数据）
     - `snippets`
     - `user_devices`
     - `sync_license_codes`
     - `user_sync_entitlements`
   - 可选附带：
     - `admin_audit_logs`（审计日志，可设置条数上限）
   - 导入时采用事务，失败自动回滚。

2. 数据库快照（SQL）
   - 由 `pg_dump` 生成，包含数据库结构与数据，适合灾难恢复。
   - 恢复示例：

```bash
psql "$DATABASE_URL" -f orbitterm-db-snapshot-*.sql
```

注意：
- 逻辑 JSON 更适合“版本演进迁移”。
- SQL 快照更适合“整库灾备”。
- 两者都建议定时保留至少 3 个历史版本（例如：日备份 7 天 + 周备份 4 周 + 月备份 3 月）。

> 注意：  
> 1. 管理端必须走 HTTPS。  
> 2. 建议启用 `ADMIN_2FA_ENABLED=true`。  
> 3. `ALLOW_INSECURE_HTTP=true` 仅用于本地调试，生产不要开启。  

---

## 9. 常见问题与排查

### 9.1 提示“同步服务仅接受 HTTPS 请求”

原因：反向代理没有透传 HTTPS 头。  
处理：确认至少有以下一个头被传递：
- `X-Forwarded-Proto: https`
- `X-Forwarded-Ssl: on`

### 9.2 返回 429（请求过于频繁）

原因：触发了登录/同步限流。  
处理：稍后重试，或在服务端适当调大 `AUTH_RATE_LIMIT_PER_MIN` / `SYNC_RATE_LIMIT_PER_MIN`。

### 9.3 返回 413（请求体过大）

原因：同步包超过 `MAX_REQUEST_BODY_BYTES`。  
处理：增大该值，或减少单次写入体积。

### 9.4 CORS 报错

原因：`CORS_ALLOW_ORIGINS` 未包含当前来源。  
处理：按实际前端来源补齐，多个用逗号分隔。

### 9.5 SQL 初始化没生效

`./sql/init.sql` 只会在 PostgreSQL 数据卷首次初始化时执行。  
如果已有旧卷，需要手动执行 SQL 或重建数据卷。

### 9.6 登录成功但拉取失败（Windows 与 macOS 之间不更新）

常见原因：
- 设备主密码不一致，导致云端加密包无法解密。
- 新设备首次连接时未先拉取，直接编辑触发了自动推送保护。

处理：
- 确认两端用同一主密码解锁。
- 在设置中心执行“立即拉取”完成基线对齐，再继续编辑。

---

## 10. 升级流程

```bash
cd OrbitTerm
git pull
cd cloud-sync-backend
docker compose up -d --build
docker compose ps
```

---

## 11. 安全与运维建议

1. 不要把 `8080` 暴露到公网，走 `127.0.0.1:8080 + HTTPS 反代`。
2. 所有默认密码和 `JWT_SECRET` 必须替换。
3. 定期备份数据库：

```bash
docker exec -t orbitterm-sync-postgres \
  pg_dump -U orbitterm -d orbitterm_sync > backup_$(date +%F).sql
```

4. 升级前先备份，再滚动升级。
