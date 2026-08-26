# Windows Host 与安装交付设计说明

## 目标

把现有 `apps/host` 的 TypeScript 核心封装成一个面向普通 Windows 用户的桌面程序，使用户能够在本机完成登录、目录授权、手机配对、启动/停止 Host、故障检查和日志查看，并最终生成 Windows 10/11 x64 安装包。

本模块完成后，用户日常使用流程应是：

1. 安装并打开“Codex Remote Host”；
2. 使用与安卓 PWA 相同的邮箱登录；
3. 选择允许远程 Codex 操作的项目目录；
4. 在手机输入电脑显示的 6 位配对码；
5. Host 缩到系统托盘持续运行；
6. 手机关闭 VPN、使用移动网络时仍可通过 Supabase 加密中转控制 Codex。

## 范围

本模块包含：

- Electron 当前用户桌面程序、单实例、托盘菜单和本地管理窗口；
- Electron 独立 Supabase 登录会话和令牌刷新；
- Windows DPAPI 保护 Host 私钥、访问令牌和刷新令牌；
- Host 注册、一次性配对码和配对状态；
- 本地目录授权、稳定 `workspaceId` 和路径规范化；
- Codex App Server、加密中转、命令执行和通知投递的统一启动/停止；
- Doctor 检查、脱敏日志、恢复与有限重启；
- 当前用户登录启动项；
- NSIS x64 安装包和卸载保留策略；
- 本地自动化验收，以及另行授权后的 Hosted Supabase、Vercel Preview、VAPID 和安卓真机验收。

本模块不包含：

- Windows LocalSystem 服务、管理员常驻服务或入站端口；
- 自动修改睡眠、休眠、防火墙、路由器或 Codex 代理；
- 自动更新、增量更新、代码签名购买或应用商店发布；
- Cloudflare Tunnel；只有 Supabase 经两轮优化仍不满足延迟指标时才另立模块；
- Git、Diff、文件浏览、语音、图片、多账号、多 Host 或多手机管理；
- 接管 Codex Desktop 当前正在执行的任务。

## 已选择的方案

### 方案比较

#### 方案 A：Electron 主进程 + 本地 React/Vite 管理界面（采用）

Electron 主进程拥有文件、凭据、网络和 Codex 进程权限；预加载脚本只暴露经过校验的窄接口；React 管理界面从本地打包资源加载。该方案能继续复用现有 Host 核心，桌面界面可维护，并且不会把远程网页放进高权限窗口。

#### 方案 B：Electron 直接加载 Vercel 网页（不采用）

虽然复用页面最多，但远程内容与本机高权限 IPC 的安全边界过于脆弱；网页发布变化也可能在未升级桌面程序时改变本机能力。

#### 方案 C：纯 Node 后台进程 + 浏览器管理页（不采用）

实现量较小，但登录启动、托盘、DPAPI、目录选择、卸载和普通用户诊断体验都更差，不符合本模块的 Windows 产品目标。

## 进程和信任边界

```text
本地 React 管理界面
        │ 仅允许固定 IPC DTO
        ▼
Electron preload（contextBridge）
        │ 运行时校验 + sender 校验
        ▼
Electron main
  ├─ CredentialStore（DPAPI）
  ├─ ConfigStore / WorkspaceAuthorizer
  ├─ HostRuntimeController
  │    ├─ SupabaseTransport
  │    ├─ RemoteCommandRunner
  │    ├─ CodexProcess / AppServerAdapter
  │    └─ WebhookNotificationSink
  └─ Doctor / RedactedLogger / Tray
```

管理窗口只加载签名安装包内的 `app://host` 资源。启用 `contextIsolation` 和 renderer sandbox，关闭 `nodeIntegration`，不向 renderer 暴露 `ipcRenderer`、访问令牌、刷新令牌、Host 私钥、完整日志对象或任意文件系统 API。所有 IPC 输入使用严格运行时 Schema；主进程同时验证调用窗口来源为本地管理窗口。

管理界面使用 React 19 和 Vite 8，仅作为 Electron 的本地静态前端构建工具。它不增加独立后端，也不替换现有 Next.js 15 安卓 PWA。

## 应用生命周期

- 使用 `app.requestSingleInstanceLock()` 保证同一 Windows 用户只运行一个实例；第二次启动只唤醒管理窗口。
- 普通启动显示管理窗口；登录启动项传入 `--hidden`，启动后只显示托盘图标。
- 关闭管理窗口不退出 Host；“退出 Codex Remote”才停止运行时并退出应用。
- 托盘菜单固定包含：状态、打开管理窗口、启动/停止 Host、运行 Doctor、登录时启动、退出。
- 不使用 `powerSaveBlocker`，不修改系统电源计划。系统恢复后只重新检查网络并恢复 Host 连接。
- Windows 锁屏不停止 Host；用户注销或应用退出时正常关闭 Realtime、Codex 子进程和本地文件句柄。

## 桌面页面

本地窗口保持单层导航，包含以下视图：

1. **登录**：邮箱 OTP 申请、验证码确认、退出登录；
2. **总览**：Host 运行状态、账号、Codex 状态、手机配对状态和最近错误；
3. **项目**：调用原生目录选择器添加授权目录，显示本机路径、项目名和稳定 ID；
4. **配对**：生成 5 分钟有效的 6 位配对码，显示到期时间和重新生成按钮；
5. **Doctor**：逐项显示通过、警告或失败，并提供复制脱敏诊断摘要；
6. **设置**：登录时启动、打开日志目录、退出登录和“彻底删除本机数据”。

“彻底删除本机数据”使用第二确认：先点击危险操作，再输入界面随机显示的确认短语。它只删除已解析并验证位于 `app.getPath("userData")` 下的配置、凭据、幂等状态和本地日志；不删除项目目录、Codex 历史或用户代码。

## 本地数据与凭据

### 非敏感配置

`config.v1.json` 保存：

- `schemaVersion`；
- Host ID、显示名、协议版本和公钥；
- 授权工作区的 `workspaceId`、显示名和规范路径；
- 登录时启动偏好；
- 安装版本和最近一次 Doctor 的非敏感摘要。

配置通过“写临时文件 → 同目录替换”原子更新。路径只存在 Windows 本机配置和本地管理界面，不进入手机命令、Supabase 审计或通知。

### 敏感凭据

`credentials.v1.bin` 的明文结构只有：

- Supabase access token；
- Supabase refresh token；
- Host P-256 私钥 JWK；
- 凭据版本和更新时间。

整个结构序列化后使用 Electron `safeStorage.encryptStringAsync()` 加密，并通过 Windows DPAPI 绑定当前用户。解密后只保留在主进程内存。检测到加密密钥轮换时重新加密；`safeStorage` 不可用时 Host 失败关闭，不把凭据降级为明文。

## 认证、注册和配对

- Electron 使用独立于 PWA 的 Supabase Session；不从浏览器复制 Cookie 或 Local Storage。
- Supabase 客户端关闭默认磁盘持久化，由 `CredentialStore` 保存 Session；令牌刷新后立即覆盖加密凭据。
- 首次登录生成 P-256 Host 密钥，注册或恢复当前账号下的唯一 Host；Host ID 不因普通重启变化。
- 生成配对码时调用现有受保护 RPC；界面只显示一次性 6 位码和 5 分钟到期时间。
- 配对撤销或设备重装后，旧共享密钥不能继续使用，必须重新配对。
- 退出登录停止 Host 并删除 Supabase Session；Host 私钥和目录配置默认保留，重新登录同一账号可恢复。切换到不同账号时必须明确重置旧 Host 身份。

## 目录授权

- 目录只能通过 Electron 原生文件夹选择器添加，不能由手机提交路径。
- 主进程使用 `realpath` 和 Windows 规范化获得真实路径，拒绝不存在路径、文件、驱动器根目录和重复目录。
- 每个目录获得随机稳定 UUID 作为 `workspaceId`；远程协议只使用这个 ID。
- 启动 Turn 前仍由现有 `CodexAppServerAdapter` 将 ID 解析为授权路径，并设置 `workspaceWrite` 与唯一 `writableRoots`。
- 删除授权目录前停止该目录上的远程新命令；若存在 Host 持有的运行中 Turn，界面要求先停止 Turn。
- 不自动创建目录，不扩大到父目录，不跟随配置时已不存在的目录继续执行。

## Host 运行控制器

`HostRuntimeController` 是桌面壳与现有 Host 核心之间唯一的生命周期入口，状态为：

```text
stopped → starting → running
                    ↘ degraded
                    ↘ error
running/degraded/error → stopping → stopped
```

启动前必须满足：已登录、Host 身份有效、至少一个授权目录、凭据可解密、Codex CLI Doctor 通过。启动顺序固定为：

1. 创建并初始化 Codex App Server；
2. 创建带当前 access token 的 SupabaseTransport；
3. 创建通知投递器和 RemoteCommandRunner；
4. 连接中转并请求/广播权威 Host 快照；
5. 开始消费可靠命令队列。

停止顺序反向执行。令牌刷新时由控制器安全更新 Supabase 会话和通知投递器，不把旧 token 固化在长生命周期闭包中。

App Server 异常退出后按 1 秒、2 秒、4 秒最多重启三次；每次重启先关闭旧实例并恢复权威快照。第三次失败进入 `error`，不再循环，等待用户手动运行 Doctor 或重启 Host。网络恢复和系统 resume 只恢复 Supabase 连接，不计入 App Server 重启次数。

## Doctor 和日志

Doctor 只做读取和临时握手，不修复系统设置。检查项：

- Windows 10/11 x64 和应用版本；
- `safeStorage` 可用性；
- Supabase Session、账号和 Realtime/可靠队列连接；
- Host 密钥与注册记录一致；
- 授权目录存在、可读，必要时可写；
- 独立 Codex CLI 路径、版本和 `app-server` 初始化；
- 登录启动项是否与界面设置一致；
- 通知服务配置是否完整；
- 最近一次脱敏错误码。

本地日志使用 JSONL，仅允许时间、严重级别、事件类型、结果、错误码、协议版本、应用版本、Host ID 后缀、workspaceId 和 messageId。禁止正文、代码、命令、原始错误响应、路径、邮箱、令牌、密钥、密文和配对码。

日志单文件达到 2 MiB 时轮换，保留 5 个文件并删除 7 天前文件。复制 Doctor 摘要时再次经过字段白名单，不直接复制日志文件内容。

## Windows 安装与卸载

- 固定 `electron@44.0.0`、`electron-builder@26.15.3`、`vite@8.2.2`、`@vitejs/plugin-react@6.1.0`；继续使用仓库现有 React、TypeScript、Zod、Vitest 和 Supabase 版本。
- 产品名 `Codex Remote Host`，`appId` 为 `com.codexremote.host`，只生成 Windows x64 NSIS 安装包。
- 安装级别为当前用户，`requestedExecutionLevel: asInvoker`，不请求管理员权限，不安装 Windows 服务。
- 使用非 one-click 安装界面，允许用户选择安装目录，创建开始菜单项；桌面快捷方式由安装界面选择。
- 默认卸载只删除程序文件，保留 `userData`，以便重装恢复。安装器不自动删除凭据。
- 若用户希望完全清除，必须先在应用内执行二次确认的数据清理，再卸载。
- MVP 不实现自动更新。未配置受信任代码签名证书时，Windows 可能显示 SmartScreen 警告，作为真机验收前必须明确记录的发布限制。

## 验收分层

### 本地自动化验收

- 凭据加解密、不可用时失败关闭、原子配置和路径约束；
- IPC sender/Schema 拒绝、renderer 无 Node 权限；
- 托盘/窗口/单实例/启动项状态；
- Host 启停、令牌刷新、断线恢复和 App Server 三次重启上限；
- Doctor 白名单输出和日志脱敏/轮换；
- Electron 管理窗口的关键用户路径和响应式显示；
- unpacked Electron 启动、打包产物结构和 x64 NSIS 构建。

### 真实外部环境验收

以下操作会修改外部状态，必须分别报告目标与影响并获得明确授权：

1. 创建或连接非生产 Supabase 项目并应用已审查迁移/配置；
2. 配置 VAPID 和 Vercel Preview 环境变量；
3. 部署 Preview；
4. 使用真实 Windows 安装包和安卓设备执行端到端验收。

真机闭环包括登录、目录授权、配对、手机流量且 VPN 关闭、新建/恢复任务、流式输出、追加、审批、停止、锁屏通知、Wi-Fi/移动网络切换、Host 重启、App Server 被终止后的恢复，以及 20 轮不含模型推理时间的控制消息延迟统计。

## 阶段门

模块五按四个子阶段交付，每个阶段测试、提交、推送后暂停，不自动进入下一阶段：

- **5A：桌面安全壳**——Electron、托盘、本地窗口、IPC、DPAPI 配置与凭据；
- **5B：Host 产品运行时**——登录、Host 注册、目录、配对、统一启停、Doctor 和日志；
- **5C：Windows 安装包**——NSIS、启动项、桌面自动化和打包验收；
- **5D：真实环境验收**——在逐项授权后配置非生产云环境并进行安卓真机验收。

每个子阶段只推送 `feat/windows-host`，不推送或合并 `main`，不自动创建 PR。

## 官方实现依据

- Electron 安全清单：<https://www.electronjs.org/docs/latest/tutorial/security>
- Electron `safeStorage`：<https://www.electronjs.org/docs/latest/api/safe-storage>
- Electron 应用与登录启动项：<https://www.electronjs.org/docs/latest/api/app>
- Electron 托盘：<https://www.electronjs.org/docs/latest/api/tray>
- Electron 原生目录选择：<https://www.electronjs.org/docs/latest/api/dialog>
- electron-builder Windows/NSIS：<https://www.electron.build/docs/win/>
