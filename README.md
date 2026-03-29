# OrbitTerm（轨连终端）

OrbitTerm 是一款面向运维与远程管理场景的桌面终端工具，支持本地加密金库、SSH 多标签会话、可视化 SFTP、账号同步与系统诊断。

## 你可以用它做什么
- 管理多台服务器与网络设备（含身份复用）
- 在一个界面里完成终端操作 + 文件传输
- 通过私有云同步在多设备之间保持同一份加密数据
- 在问题出现时查看连接日志与诊断建议

## 安装与部署入口
- 新手从这里开始：[`USER_GUIDE.md`](./USER_GUIDE.md)
- 服务器 Docker 部署详解：[`docs/DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md)
- 同步后端说明：[`cloud-sync-backend/README.md`](./cloud-sync-backend/README.md)
- 客户端下载：<https://github.com/bigcaole/OrbitTerm/releases>

## 快速上手（5 分钟）
1. 在 Windows 或 macOS 安装 OrbitTerm。
2. 首次打开按引导设置“金库密码”。
3. 在服务器部署同步后端（Docker）。
4. 客户端填写同步域名并注册/登录账号。
5. 在设备 A 添加主机后，到设备 B 点击“立即拉取”完成同步。

## 安全要点
- 金库密码只在本机使用，不会上云。
- 同步的是加密数据包，不是明文主机信息。
- 多设备同步前，必须使用同一金库密码解锁。
- 生产环境请使用 HTTPS，同步服务不要裸露 HTTP。

## 适用人群
- 个人运维用户
- 小型团队管理员
- 需要跨设备同步主机资产的技术支持场景

如果你是第一次部署，请先完整阅读 [`USER_GUIDE.md`](./USER_GUIDE.md)。
