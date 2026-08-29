# Codex Remote Host

Host 在当前 Windows 用户会话中运行 Codex App Server，并把远程命令和事件交给已配对设备。

## 开发与打包

在仓库根目录执行：

```powershell
npm.cmd run build --workspace @codex-remote/host
npm.cmd run test:e2e --workspace @codex-remote/host
npm.cmd run package:dir --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host -- --allow-missing-installer
npm.cmd run package:smoke --workspace @codex-remote/host
npm.cmd run package:win --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host
```

`package:dir` 生成 `apps/host/release/win-unpacked`，`package:win` 生成 Windows x64 NSIS 安装包。打包前需要提供公开运行配置：

```powershell
$env:CODEX_REMOTE_SUPABASE_URL='http://127.0.0.1:54321'
$env:CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY='public-key'
$env:CODEX_REMOTE_WEB_ORIGIN='http://127.0.0.1:3000'
$env:CODEX_REMOTE_PROTOCOL_VERSION='1'
```

以上仅用于本地 5C 验收，不要写入 `.env`，也不要把真实生产密钥放进安装包。安装包默认是当前用户安装、`asInvoker`、x64 NSIS；未配置代码签名时会有 SmartScreen 限制。默认卸载保留本机配置，人工安装和卸载必须获得用户明确授权。

当前 5C 安装包使用回环地址，只适合本机自动化和桌面验收，不能直接用于安卓远程控制；接入真实手机前仍需完成单独的 5D 云端配置和真机验收。

## 锁屏通知出口

`createWebhookNotificationSink` 是可选通知适配器。Windows Host 入口准备好 Supabase 用户访问令牌和 Web 地址后，可以把它传给 `RemoteCommandRunner`：

- 审批请求发送 `approval`；
- 任务完成发送 `completed`；
- 任务失败发送 `failed`；
- 普通流式输出不会发送锁屏通知。

请求体只包含 `hostId`、类型和不透明 `eventId`，不包含提示词、代码、命令或路径。公网地址必须使用 HTTPS；本地开发仅允许 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP。请求默认 10 秒超时，通知失败会被隔离，不会中断远程控制。
