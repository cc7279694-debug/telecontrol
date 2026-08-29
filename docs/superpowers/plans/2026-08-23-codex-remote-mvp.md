# Codex Remote 个人版 MVP

## 目标

实现一个单用户、单 Windows 主机、单 Android 设备的远程控制 MVP：

```text
Android PWA ⇄ Supabase 加密中转 ⇄ Windows Host ⇄ Codex App Server
```

手机不连接 VPN、不配置路由器，通过云端中转控制 Windows 上由 Host 启动的 Codex。
Windows 保持当前用户会话和现有代理设置，不修改睡眠、休眠或入站防火墙配置。

## 边界

- 只支持简体中文、文本输入和单账号场景。
- 支持历史读取、恢复/新建会话、发送/追加指令、流式输出、审批和停止。
- 不接管 Codex Desktop 当前正在执行的会话。
- 首版不包含 Git、Diff、文件管理、语音、图片、多用户和原生 Android App。
- 手机只提交授权工作区 ID，Windows Host 负责解析本地路径并限制可写根目录。
- 首版使用 Supabase Realtime 和可靠命令队列；若实测延迟不达标，再单独评估 Cloudflare Tunnel。

## 技术结构

- `apps/host`：Windows Host、Codex App Server stdio 适配器、本地配置和日志。
- `apps/web`：Next.js 15 Android PWA、Supabase Auth、Realtime 和 Web Push。
- `packages/protocol`：共享命令、事件、加密信封和校验。
- `supabase`：迁移、RLS、Realtime 私有频道和数据库测试。

## 模块交付顺序

1. Windows 本地 Codex 适配器
2. 加密中转与数据库
3. Android PWA
4. 通知与可靠性
5. Windows 安装与端到端验收

每个模块单独验证、提交并暂停验收，不自动进入下一个模块，也不推送或合并 `main`。

## 当前执行状态：模块五 Checkpoint 5C 自动化交付完成，人工安装待授权

已完成：

- Node.js 24、npm workspaces、TypeScript 严格模式基础结构。
- 版本化远程信封和 Zod 运行时校验。
- JSON-RPC stdio 客户端：请求关联、初始化、通知、服务端审批请求和错误处理。
- Codex App Server 适配器：线程列表/读取/启动/恢复、Turn 启动/追加/停止、审批响应。
- 工作区 ID 到本地授权路径的映射，以及 `onRequest + workspaceWrite` 策略。
- Windows 独立 `@openai/codex@0.149.0` CLI 的 `codex app-server` 初始化握手。
- Supabase 加密命令队列、设备/Host 配对表、RLS 和私有 Realtime 策略。
- P-256 ECDH、HKDF-SHA-256、AES-256-GCM 加密协议。
- Host SupabaseTransport、命令租约、幂等、配对码和状态机保护。
- 本地 Docker/Supabase 迁移、14 项 pgTAP 数据库测试、数据库 Lint 和 35 项代码测试。

模块一至模块四及 Windows Host 运行时已完成对应功能实现和自动化验收。Checkpoint 5C 的自动化构建、x64 NSIS 安装包审计和交接文档已完成；当前用户安装、卸载和重装仍需用户明确授权。Checkpoint 5D 的云端 Preview、VAPID 和安卓真机验收仍需单独授权。
