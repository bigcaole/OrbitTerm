# OrbitTerm 私有云同步后端（Go + Gin + PostgreSQL）

本服务用于给 OrbitTerm 提供账号化的加密金库同步能力。

## 已实现接口
- `POST /register`：注册账号，返回 JWT
- `POST /login`：登录账号，返回 JWT
- `POST /sync/push`：上传加密 Blob 与版本号（需要 JWT）
- `GET /sync/pull`：拉取该账号最新加密 Blob（需要 JWT）
- `GET /healthz`：健康检查

## 安全策略
- 服务默认强制 HTTPS（会校验 `TLS` / `X-Forwarded-Proto=https` / `X-Forwarded-Ssl=on`）。
- 如需本地调试可临时设置 `ALLOW_INSECURE_HTTP=true`，生产环境请保持 `false`。
- 密码使用 `bcrypt` 哈希存储。
- 接口只存储加密后的 Blob，不保存明文主机信息。

## 环境变量
- `PORT`：监听端口，默认 `8080`
- `DATABASE_URL`：PostgreSQL 连接串（必填）
- `JWT_SECRET`：JWT 签名密钥（必填，建议 32 字节以上随机串）
- `JWT_EXPIRE_HOURS`：JWT 过期小时数，默认 `720`
- `ALLOW_INSECURE_HTTP`：是否允许 HTTP，默认 `false`
- `CORS_ALLOW_ORIGINS`：允许跨域来源，多个用逗号分隔，默认 `*`

## 一键容器部署（推荐）
项目已提供：
- `Dockerfile`
- `docker-compose.yml`
- `sql/init.sql`

直接在后端目录执行：

```bash
docker compose up -d --build
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

## SQL 初始化
`sql/init.sql` 已包含：
- `users` 表（账号）
- `vault_blobs` 表（每账号最新加密 Blob + 版本）
- 索引与约束

## 常见问题
- 返回“同步服务仅接受 HTTPS 请求”
  - 说明你的反向代理未正确转发 HTTPS 头，请检查 1Panel 反向代理配置。
- 返回“云端已有更高版本，已拒绝覆盖”
  - 说明客户端本地版本落后，请先调用 `/sync/pull` 拉取最新再提交。
