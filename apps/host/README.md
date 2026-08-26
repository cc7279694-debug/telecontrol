# Codex Remote Host

Host 在当前 Windows 用户会话中运行 Codex App Server，并把远程命令和事件交给已配对设备。

## 锁屏通知出口

`createWebhookNotificationSink` 是可选通知适配器。Windows Host 入口准备好 Supabase 用户访问令牌和 Web 地址后，可以把它传给 `RemoteCommandRunner`：

- 审批请求发送 `approval`；
- 任务完成发送 `completed`；
- 任务失败发送 `failed`；
- 普通流式输出不会发送锁屏通知。

请求体只包含 `hostId`、类型和不透明 `eventId`，不包含提示词、代码、命令或路径。公网地址必须使用 HTTPS；本地开发仅允许 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP。通知失败会被隔离，不会中断远程控制。
