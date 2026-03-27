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
2. 进入云同步设置。
3. 服务地址填：`https://sync.yourdomain.com`。
4. 注册/登录同一个账号。
5. 在设备 A 修改主机后，设备 B 登录同账号即可同步到最新数据。

---

## 8. 常见问题与排查

### 8.1 提示“同步服务仅接受 HTTPS 请求”

原因：反向代理没有透传 HTTPS 头。  
处理：确认至少有以下一个头被传递：
- `X-Forwarded-Proto: https`
- `X-Forwarded-Ssl: on`

### 8.2 返回 429（请求过于频繁）

原因：触发了登录/同步限流。  
处理：稍后重试，或在服务端适当调大 `AUTH_RATE_LIMIT_PER_MIN` / `SYNC_RATE_LIMIT_PER_MIN`。

### 8.3 返回 413（请求体过大）

原因：同步包超过 `MAX_REQUEST_BODY_BYTES`。  
处理：增大该值，或减少单次写入体积。

### 8.4 CORS 报错

原因：`CORS_ALLOW_ORIGINS` 未包含当前来源。  
处理：按实际前端来源补齐，多个用逗号分隔。

### 8.5 SQL 初始化没生效

`./sql/init.sql` 只会在 PostgreSQL 数据卷首次初始化时执行。  
如果已有旧卷，需要手动执行 SQL 或重建数据卷。

---

## 9. 升级流程

```bash
cd OrbitTerm
git pull
cd cloud-sync-backend
docker compose up -d --build
docker compose ps
```

---

## 10. 安全与运维建议

1. 不要把 `8080` 暴露到公网，走 `127.0.0.1:8080 + HTTPS 反代`。
2. 所有默认密码和 `JWT_SECRET` 必须替换。
3. 定期备份数据库：

```bash
docker exec -t orbitterm-sync-postgres \
  pg_dump -U orbitterm -d orbitterm_sync > backup_$(date +%F).sql
```

4. 升级前先备份，再滚动升级。
