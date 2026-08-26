# Codex Remote Web

## 本地运行

```powershell
npm.cmd run dev --workspace @codex-remote/web
```

浏览器打开 `http://localhost:3000`。登录、配对和远程控制需要本地 Supabase；页面本身不会把服务端密钥放进浏览器配置。

## 锁屏通知

复制 `.env.example` 为 `.env.local` 后，只有在服务端配置 `SUPABASE_SERVICE_ROLE_KEY` 和三项 `WEB_PUSH_VAPID_*` 时，用户才能保存 Push 订阅。服务端通知内容固定为审批、完成或失败三类通用文本，不包含路径、命令、代码或提示词。当前阶段只完成订阅管理和发送封装，实际事件触发需要后续把 Host 的终态事件接入可信的服务端调用链。

## 浏览器验收

```powershell
npm.cmd run test:e2e --workspace @codex-remote/web
```

这套测试默认执行登录页、响应式基础检查、Manifest、图标、Service Worker 和离线缓存边界。Docker Desktop 未启动时，本地 OTP 与完整加密 Host 闭环会安全跳过；启动本地 Supabase 后可按测试标题开启对应门禁。

本地验收辅助代码只接受 loopback Supabase、Studio/数据库和 Mailpit 地址，并且只在测试进程内读取服务端值，绝不会进入 Web 构建产物。
