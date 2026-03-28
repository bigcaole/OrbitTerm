# OrbitTerm 私有云同步后端（Go + Gin + PostgreSQL）

本服务用于给 OrbitTerm 提供账号化的加密金库同步能力。

完整部署教程（面向新手，含客户端双端安装、服务器 Docker 部署、反向代理与变量说明）：
- [../docs/DEPLOYMENT_GUIDE.md](../docs/DEPLOYMENT_GUIDE.md)

## 已实现接口
- `POST /register`：注册账号，返回 JWT
- `POST /login`：登录账号，返回 JWT
- `GET /devices`：获取当前账号的登录设备列表（需要 JWT）
- `POST /logout/device`：按设备退出登录，或一键退出所有设备（需要 JWT）
- `GET /sync/status`：返回云端当前版本号与更新时间（需要 JWT）
- `POST /sync/push`：上传加密 Blob 与客户端看到的版本号（需要 JWT）
- `GET /sync/pull`：拉取该账号最新加密 Blob（需要 JWT）
- `GET /healthz`：健康检查
- `GET /admin`：项目管理员 Web 控制台（可选启用）

### 版本一致性机制
- Push 时服务端忽略客户端时间戳，统一使用服务器 `UTC` 时间写入 `updated_at`。
- Push 更新采用原子版本检查：仅当云端 `version == client_version` 时才允许 `version = version + 1`。
- 发生冲突返回 `409`，并携带 `latest`（最新云端 Blob + 版本），客户端应先拉取并合并。

## 安全策略
- 服务默认强制 HTTPS（会校验 `TLS` / `X-Forwarded-Proto=https` / `X-Forwarded-Ssl=on`）。
- 如需本地调试可临时设置 `ALLOW_INSECURE_HTTP=true`，生产环境请保持 `false`。
- 密码使用 `bcrypt` 哈希存储。
- 登录/注册/同步接口带基础限流，降低暴力请求风险。
- 全局请求体大小有限制，防止异常大包冲击服务。
- 接口只存储加密后的 Blob，不保存明文主机信息。

## 环境变量
- `PORT`：监听端口，默认 `8080`
- `DATABASE_URL`：PostgreSQL 连接串（必填）
- `JWT_SECRET`：JWT 签名密钥（必填，建议 32 字节以上随机串）
- `JWT_EXPIRE_HOURS`：JWT 过期小时数，默认 `720`
- `ALLOW_INSECURE_HTTP`：是否允许 HTTP，默认 `false`
- `CORS_ALLOW_ORIGINS`：允许跨域来源，多个用逗号分隔，默认 `*`
- `MAX_REQUEST_BODY_BYTES`：单请求最大体积（字节），默认 `4194304`（4MB）
- `AUTH_RATE_LIMIT_PER_MIN`：登录/注册每分钟每 IP+路由限流次数，默认 `30`
- `SYNC_RATE_LIMIT_PER_MIN`：同步接口每分钟每 IP+路由限流次数，默认 `120`
- `ADMIN_WEB_ENABLED`：是否启用管理员 Web，默认 `false`
- `ADMIN_USERNAME`：管理员账号（`ADMIN_WEB_ENABLED=true` 时必填）
- `ADMIN_PASSWORD`：管理员明文密码（便捷方式，启动时会转为哈希，仅与 `ADMIN_PASSWORD_HASH` 二选一）
- `ADMIN_PASSWORD_HASH`：管理员密码 bcrypt 哈希（更安全，推荐）
- `ADMIN_2FA_ENABLED`：是否启用管理员 2FA 二次验证，默认 `false`
- `ADMIN_2FA_CODE`：管理员 2FA 验证码（当 `ADMIN_2FA_ENABLED=true` 时必填）
- `ADMIN_SESSION_HOURS`：管理员登录会话时长（小时），默认 `12`

## 一键容器部署（推荐）
项目已提供：
- `Dockerfile`
- `docker-compose.yml`
- `sql/init.sql`

> 从 `v0.1.20` 开始，服务启动时会自动执行建表/建索引检查（幂等），即使你忘记手动初始化 SQL 也能自动补齐核心表结构。

直接在后端目录执行：

```bash
docker compose up -d --build
```

## 预构建 Docker 镜像（GHCR）
仓库已提供自动构建并推送后端镜像到 GHCR：

- 镜像地址：`ghcr.io/bigcaole/orbitterm-sync-backend`
- 常用标签：`latest`、`main`、`vX.Y.Z`、`sha-<commit>`

拉取示例：

```bash
docker pull ghcr.io/bigcaole/orbitterm-sync-backend:latest
```

若你不希望在服务器本地构建，可将 `docker-compose.yml` 的 `api` 服务改为：

```yaml
api:
  image: ghcr.io/bigcaole/orbitterm-sync-backend:latest
  container_name: orbitterm-sync-api
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    PORT: "8080"
    DATABASE_URL: "postgres://orbitterm:change_me_now@postgres:5432/orbitterm_sync?sslmode=disable"
    JWT_SECRET: "replace_with_a_long_random_secret"
    JWT_EXPIRE_HOURS: "720"
    ALLOW_INSECURE_HTTP: "false"
    CORS_ALLOW_ORIGINS: "https://app.orbitterm.example"
    MAX_REQUEST_BODY_BYTES: "4194304"
    AUTH_RATE_LIMIT_PER_MIN: "30"
    SYNC_RATE_LIMIT_PER_MIN: "120"
    ADMIN_WEB_ENABLED: "true"
    ADMIN_USERNAME: "admin"
    ADMIN_PASSWORD: "replace_with_a_strong_password"
    ADMIN_2FA_ENABLED: "false"
    ADMIN_2FA_CODE: "123456"
    ADMIN_SESSION_HOURS: "12"
  ports:
    - "8080:8080"
```

## 1Panel 小白部署指引
1. 准备域名并在 1Panel 上完成证书申请（Let's Encrypt）。
2. 在 1Panel 新建 PostgreSQL 应用，创建数据库与账号（或直接使用本仓库 `docker-compose.yml` 一键拉起）。
3. 执行 `sql/init.sql` 初始化表结构。
4. 在 1Panel 新建“容器/编排”：
   - 方式 A：导入 `docker-compose.yml`
   - 方式 B：手动创建容器并填写环境变量
5. 配置反向代理到后端容器 `8080`，并开启 HTTPS。
6. 反向代理需透传以下请求头（至少其一）：
   - `X-Forwarded-Proto: https`
   - `X-Forwarded-Ssl: on`
7. 访问 `https://你的域名/healthz`，返回 `status=ok` 即部署成功。
8. 在 OrbitTerm 客户端填入该 HTTPS 地址，进行注册/登录后即可自动同步。
9. 如启用管理员 Web，可通过 `https://你的域名/admin` 登录查看全局状态、在线设备并在线调整关键参数（会写入 `admin_settings` 表）。

## SQL 初始化
`sql/init.sql` 已包含：
- `users` 表（账号）
- `vault_blobs` 表（每账号最新加密 Blob + 版本）
- `user_devices` 表（设备名、地区、User-Agent、Token JTI、在线时间）
- 索引与约束

## 常见问题
- 返回“同步服务仅接受 HTTPS 请求”
  - 说明你的反向代理未正确转发 HTTPS 头，请检查 1Panel 反向代理配置。
- 返回“检测到版本冲突，云端已有更新”
  - 说明其他设备先提交了新版本，请先调用 `/sync/pull` 获取 `latest` 后再重新提交。
- 注册时报“创建账号失败，请稍后重试”
  - 常见原因是数据库未初始化或表结构不完整。升级到 `v0.1.20+` 后，服务启动会自动补齐表结构。
  - 可先执行 `docker compose logs -f api` 查看后端日志中的真实 SQL 错误。
- 推送时报“同步参数无效，请检查版本号和数据”
  - 旧版服务端会把首次推送的 `version=0` 误判为非法参数。
  - 升级到 `v0.1.22+` 可修复该问题，并兼容旧客户端可能传来的字符串版本号。
- 不同时区/系统时钟快慢不一致时出现同步异常
  - 升级到 `v0.1.23+`，客户端会使用“版本优先 + 单调递增更新时间”策略，避免因本地时钟快慢导致的跨端同步异常。
