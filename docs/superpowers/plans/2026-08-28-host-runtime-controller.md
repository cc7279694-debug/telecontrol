# Windows Host 运行时、Doctor 与脱敏日志实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before any completion claim.

**Goal:** 把现有 Electron 安全壳、Codex App Server 适配器和 Supabase 加密中转组合成一个真实可启停、可恢复、可诊断的 Windows Host，并关闭 Task 5 验收留下的“假运行状态”和“活动目录未跟踪”问题。

**Architecture:** Electron 主进程只通过 `HostRuntimeController` 管理 Codex 子进程、Supabase 私有频道、可靠命令队列、通知投递和恢复。首次尚未配对时，控制器进入 `degraded / awaiting-pairing`：本地 Codex 已初始化，但远程频道和命令消费尚未启动；手机完成配对后，控制器解析唯一有效设备，再连接频道、发布加密权威快照并启动命令消费。`RemoteThreadStore` 成为远程 Turn 活动状态的唯一事实来源，桌面删除目录、停止确认和托盘状态都读取同一状态。

**Tech Stack:** Node.js 24、TypeScript strict、Electron 44、React 19、Vitest、Supabase JS 2.112.3、`@openai/codex` 0.149.0、Codex App Server 默认 `stdio`。

**Parent spec:** `docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md`

**Parent task:** `docs/superpowers/plans/2026-08-26-windows-host-packaging.md` 的 Task 6 / Checkpoint 5B。

---

## 1. 已确认的约束和决策

### 1.1 不改变的边界

- 不开放 Windows 入站端口，不启用 App Server 远程 WebSocket。
- App Server 只使用默认 `stdio`，每次连接严格执行 `initialize` → `initialized`。
- 不改变用户现有 Codex 登录、OpenAI 代理和环境变量；子进程继承当前用户环境。
- 不修改 Supabase 表结构、RLS 或 Realtime 策略；本任务只复用现有 `host_device_links`、可靠队列和私有频道。
- 不创建 Supabase/Vercel 项目，不应用迁移，不部署 Preview。
- 不实现安装包；Checkpoint 5C 在本任务验收后另行开始。
- 不接管 Codex Desktop 正在运行的 Thread；Host 只写自己创建或恢复并登记为 Host-owned 的 Thread。

### 1.2 首次配对的状态闭环

现有私有频道策略要求 Host 与 Device 已建立有效链接，因此未配对 Host 不能假装 Realtime 已连接。采用以下流程：

```text
stopped
  → starting / preflight
  → starting / codex-initializing
  → degraded / awaiting-pairing       （没有有效手机链接）
      → 手机输入配对码
      → Host 只读查询到唯一有效链接
      → starting / transport-connecting
      → running

已有有效链接：
stopped → starting → Codex 初始化 → Realtime 连接 → 快照 → 命令消费 → running
```

- `running` 只表示 Codex 初始化完成、私有频道已订阅、权威状态已发布且命令消费已启动。
- `degraded / awaiting-pairing` 表示本地 Codex 可用、配对 RPC 可用，但手机尚不能发送远程命令。
- `degraded / transport-offline` 表示 Codex 仍在运行，但 Supabase 频道暂时不可用；恢复网络后只重连中转，不重启 Codex。
- 配对按钮只能在控制器确认本地 Codex 已初始化且运行时拥有当前 SupabaseTransport 时启用。
- 配对码生成后，控制器每 2 秒只读检查一次有效链接，最多检查到配对码过期；发现唯一设备后立即停止轮询并连接。
- 查询到多个有效设备时失败关闭为 `multiple_active_devices`，不任意选择设备；MVP 仍保持单手机约束。

### 1.3 活动目录的事实来源

- 删除 `main.ts` 中孤立的 `activeTurnWorkspaceIds`。
- 扩展 `RemoteThreadStore`，提供 `hasActiveTurn(workspaceId)`、`activeTurnCount()`、`listRecoverable()` 和 `markRunningUnknown()`。
- `turn.start` 成功后写入 `running + activeTurnId`。
- `turn.completed` 的 completed / failed / interrupted 结果全部写回 `idle`。
- `turn.interrupt` 成功后写回 `idle`。
- App Server 意外退出时，原本运行中的 Host-owned Thread 标为 `unknown`；在新 App Server 初始化后读取权威 Thread 快照进行恢复。无法确认时继续阻止删除目录和写入该 Thread。
- 删除目录、停止 Host 的二次确认和界面活动任务数量都读取 `RemoteThreadStore`，不维护第二份集合。

### 1.4 恢复策略

- App Server 异常退出：1 秒、2 秒、4 秒重启，第三次失败后进入永久 `error`。
- 用户手动运行 Doctor 且关键检查全部通过后，再手动点击启动，才重置 App Server 重启计数。
- Supabase `CHANNEL_ERROR`、`TIMED_OUT`、`CLOSED`、Windows resume 和网络恢复只重连 Transport，不消耗 App Server 重试次数。
- access token 更新时调用 Realtime `setAuth`，重建只持有当前 token 的 Webhook sink；不重启 Codex。
- 所有 `start`、`stop`、`reconnect`、`dispose` 都必须幂等；重复点击不能创建第二个 Codex 进程或第二个命令循环。

---

## 2. 核心接口

实现时先用测试固定以下契约，名称可在不改变语义的前提下做小幅调整：

```ts
export type HostRuntimePhase =
  "stopped" | "starting" | "running" | "degraded" | "stopping" | "error";

export type HostRuntimeReason =
  | "awaiting-pairing"
  | "transport-offline"
  | "codex-restarting"
  | "doctor-required"
  | null;

export interface HostRuntimeSnapshot {
  phase: HostRuntimePhase;
  reason: HostRuntimeReason;
  activeRemoteTurns: number;
  lastObservedAt: string | null;
  errorCode: RuntimeErrorCode | null;
  appServerRestartAttempt: number;
}

export interface HostRuntimeController {
  start(): Promise<ActionResult>;
  stop(input: { force: boolean }): Promise<ActionResult>;
  createPairingRequest(): Promise<PairingRequest>;
  handleSessionChanged(session: RuntimeSession): Promise<void>;
  handleNetworkOnline(): Promise<void>;
  handleSystemResume(): Promise<void>;
  getSnapshot(): HostRuntimeSnapshot;
  subscribe(handler: (snapshot: HostRuntimeSnapshot) => void): () => void;
  dispose(): Promise<void>;
}
```

`HostRuntimeController` 依赖窄接口而不是 Electron/Supabase 具体对象，单元测试只使用 fake ports：

```ts
interface RuntimePorts {
  loadPrerequisites(): Promise<RuntimePrerequisites>;
  resolveCodexCli(): Promise<CodexCliResolution>;
  createCodexRuntime(input: CodexRuntimeInput): Promise<CodexRuntime>;
  createTransport(session: RuntimeSession): RuntimeTransport;
  createRunner(input: RunnerInput): RuntimeRunner;
  createNotificationSink(
    session: RuntimeSession,
  ): HostNotificationSink | undefined;
  schedule(delayMs: number, task: () => void): CancelSchedule;
  logger: RedactedLogger;
}
```

运行时错误只使用稳定代码，不把原始错误传到日志或 renderer：

```ts
type RuntimeErrorCode =
  | "not_signed_in"
  | "host_not_registered"
  | "no_authorized_workspace"
  | "credentials_unavailable"
  | "codex_cli_missing"
  | "codex_version_mismatch"
  | "codex_initialize_failed"
  | "transport_connect_failed"
  | "multiple_active_devices"
  | "command_runner_failed"
  | "app_server_exited"
  | "unknown_runtime_error";
```

---

## 3. 详细实施任务

### Task 1：固定运行时状态、活动目录与桌面契约

**Files:**

- Modify: `apps/host/src/remote-thread-store.ts`
- Modify: `apps/host/src/remote-thread-store.test.ts`
- Modify: `apps/host/src/remote-command-runner.ts`
- Modify: `apps/host/src/remote-command-runner.test.ts`
- Modify: `apps/host/src/desktop/contract.ts`
- Modify: `apps/host/src/desktop/contract.test.ts`
- Modify: `apps/host/src/desktop/ipc-controller.test.ts`

**Step 1: 为 `RemoteThreadStore` 写失败测试**

覆盖：

- 同一 workspace 有一个 `running` Host Thread 时 `hasActiveTurn()` 为 true；
- `external` Thread 不计入远程活动 Turn；
- `unknown` Host Thread 视为“仍占用”，避免错误删除目录；
- `activeTurnCount()` 不重复计算；
- `markRunningUnknown()` 只改变 Host-owned running 条目；
- `listRecoverable()` 返回副本，外部修改不能污染 Store；
- 进程重启后持久化状态仍能恢复。

Run:

```powershell
npm.cmd test -- --run apps/host/src/remote-thread-store.test.ts
```

Expected: FAIL because the activity and recovery methods do not exist.

**Step 2: 最小实现 Store 活动查询与恢复方法**

- 继续使用现有版本 1 文件格式，不迁移数据库。
- 不在 Store 保存路径、prompt、output 或 token。
- 写入仍保持当前用户目录下的本地文件权限策略。

Run the same test and expect PASS.

**Step 3: 为 Runner 的生命周期写失败测试**

覆盖：

- `turn.start` 成功后记录 workspace/thread/turn 为 running；
- completed、failed、interrupted 通知把对应 Host Thread 置为 idle；
- 失败的 `turn.start` 不留下活动状态；
- App Server 通知缺少 threadId/turnId 时不误清理其他 Thread；
- `stop()` 清理 timer 和 handler 后不再更新 Store；
- `publishAuthoritativeSnapshot(linkedDevice)` 在命令循环启动前发送一次加密 `host.snapshot.result`；
- snapshot 发送失败时 runner 不开始 claim 命令。

**Step 4: 实现 Runner 生命周期闭环**

- 复用 `CodexEventMapper`，不在桌面层解析 App Server 事件。
- 对终态通知先更新 Store，再发远程事件。
- `publishAuthoritativeSnapshot` 使用新的随机 UUID 作为 `requestMessageId`，不复用配对码或设备 ID。

**Step 5: 扩展桌面 DTO**

`DesktopStateSchema` 增加：

```ts
hostStatus: z.enum([
  "stopped",
  "starting",
  "running",
  "degraded",
  "stopping",
  "error",
]);
runtimeReason: z.enum([
  "awaiting-pairing",
  "transport-offline",
  "codex-restarting",
  "doctor-required",
]).nullable();
activeRemoteTurns: z.number().int().nonnegative();
lastObservedAt: z.string().datetime({ offset: true }).nullable();
lastErrorCode: z.string().max(100).nullable();
```

把 `stopHost` 改为接收 `{ force: boolean }`。未 force 且有活动 Turn 时返回中文确认提示；renderer 确认后才发送 `force: true`。

**Step 6: 验证 Task 1**

```powershell
npm.cmd test -- --run apps/host/src/remote-thread-store.test.ts apps/host/src/remote-command-runner.test.ts apps/host/src/desktop/contract.test.ts apps/host/src/desktop/ipc-controller.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 2：实现固定版本 Codex CLI 解析和可观察进程生命周期

**Files:**

- Create: `apps/host/src/desktop/codex-cli-resolver.ts`
- Create: `apps/host/src/desktop/codex-cli-resolver.test.ts`
- Modify: `apps/host/src/codex-process.ts`
- Modify: `apps/host/src/codex-process.test.ts`

**Step 1: 写 CLI resolver 失败测试**

固定解析目标：

```text
@openai/codex-win32-x64/
  vendor/x86_64-pc-windows-msvc/bin/codex.exe
```

测试：

- 开发态从 `require.resolve("@openai/codex-win32-x64/package.json")` 所在目录解析；
- 打包态从 `process.resourcesPath/codex/.../codex.exe` 解析；
- 校验入口包版本严格等于 `0.149.0`，平台包版本严格等于 `0.149.0-win32-x64`；
- 文件不存在、非 win32/x64、版本不符都返回稳定错误码；
- 路径位于 `WindowsApps` 或解析后逃出允许资源根时拒绝；
- 不回退到 PATH 中的 `codex`、`codex.cmd` 或未知全局安装。

Run:

```powershell
npm.cmd test -- --run apps/host/src/desktop/codex-cli-resolver.test.ts
```

Expected: FAIL because resolver does not exist.

**Step 2: 实现 resolver**

返回：

```ts
interface CodexCliResolution {
  executablePath: string;
  version: "0.149.0";
  source: "workspace-package" | "packaged-resource";
}
```

只做本地读取，不自动下载、安装或修改环境变量。

**Step 3: 写 Codex 进程失败测试**

覆盖：

- 仅接收 resolver 给出的绝对 `codex.exe`；
- spawn 参数固定为 `["app-server"]`，`stdio` 为 pipe/pipe/pipe；
- `windowsHide: true`；
- 显式传入 `{ ...process.env }`，保留当前用户代理和 Codex 认证环境；
- stderr 只映射为安全错误码，不直接写日志；
- 暴露 `onExit` / `onError` 订阅；
- `close()` 先关闭 JSON-RPC，再终止子进程，重复调用无副作用；
- 主动 stop 不触发异常重启，非预期 exit 才通知控制器。

**Step 4: 修改 `codex-process.ts`**

- 移除生产路径对 `CODEX_CLI_PATH`、`codex.cmd` 和 PATH fallback 的依赖。
- 测试可通过依赖注入传入 fake spawn；不得通过真实环境变量绕过 resolver。
- 创建 Adapter 后由控制器调用 `initialize()`，进程工厂本身不偷偷开始远程工作。

**Step 5: 验证 Task 2**

```powershell
npm.cmd test -- --run apps/host/src/desktop/codex-cli-resolver.test.ts apps/host/src/codex-process.test.ts apps/host/src/json-rpc-client.test.ts apps/host/src/codex-app-server-adapter.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 3：补齐设备解析、令牌刷新和通知热更新

**Files:**

- Modify: `apps/host/src/supabase-transport.ts`
- Modify: `apps/host/src/supabase-transport.test.ts`
- Modify: `apps/host/src/desktop/supabase-auth-controller.ts`
- Modify: `apps/host/src/desktop/supabase-auth-controller.test.ts`
- Modify: `apps/host/src/webhook-notification-sink.ts`
- Modify: `apps/host/src/webhook-notification-sink.test.ts`

**Step 1: 写 Transport 失败测试**

新增窄方法：

```ts
findActiveLinkedDevice(hostId: string): Promise<LinkedDevice | null>;
refreshAccessToken(accessToken: string): Promise<void>;
onConnectionState(handler: (state: TransportConnectionState) => void): () => void;
```

覆盖：

- 未连接时也能在当前登录 Session 下只读查询 Host 的有效 link；
- 没有 link 返回 null；
- 唯一 link 返回未撤销 Device 公钥；
- 多个有效 link 以 `multiple_active_devices` 失败；
- 撤销 link 或撤销 Device 不返回；
- Realtime 私有频道状态映射为 subscribed/offline/closed；
- token 更新调用 Supabase Realtime `setAuth`；
- disconnect 后旧频道事件不再传播。

实现查询时只增加当前 Supabase query port 所需的 `is`、`limit` 和可数组读取能力；不新增 RPC，不改迁移。

**Step 2: 写 Auth Session 订阅失败测试**

`createSupabaseAuthController` 增加只供 main 使用的：

```ts
getRuntimeSession(): Promise<RuntimeSession | null>;
onRuntimeSessionChanged(
  handler: (session: RuntimeSession | null) => void,
): () => void;
```

`RuntimeSession` 只在 Electron main 内存中存在，包含 access token、ownerId 和 authSessionId；不能加入 Desktop DTO、日志或 IPC。

覆盖 SIGNED_IN、TOKEN_REFRESHED、SIGNED_OUT，并确保刷新后的 `authSessionId` 不是临时 null 快照。

**Step 3: 写可替换通知 Sink 失败测试**

新增一个稳定代理对象：

```ts
interface RotatingNotificationSink extends HostNotificationSink {
  replace(accessToken: string): void;
  clear(): void;
}
```

- `replace` 用新 token 重建底层 webhook sink；
- 在途请求可以结束，后续请求只使用新 token；
- `clear` 后静默跳过通知；
- 任何测试断言都不能打印完整 Authorization header。

**Step 4: 最小实现并验证**

```powershell
npm.cmd test -- --run apps/host/src/supabase-transport.test.ts apps/host/src/desktop/supabase-auth-controller.test.ts apps/host/src/webhook-notification-sink.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 4：实现 `HostRuntimeController`

**Files:**

- Create: `apps/host/src/desktop/host-runtime-controller.ts`
- Create: `apps/host/src/desktop/host-runtime-controller.test.ts`
- Modify: `apps/host/src/dev/local-remote-host-harness.ts`
- Modify: `apps/host/src/dev/local-remote-host-harness.test.ts`

**Step 1: 先写状态机失败测试**

使用 fake clock、fake Codex、fake Transport、fake Runner，禁止真实网络和真实子进程。至少覆盖：

1. 未登录；
2. Host 未注册；
3. 没有授权目录；
4. 凭据无法解密；
5. CLI 缺失或版本不符；
6. App Server initialize 失败；
7. 已配对时的完整启动顺序；
8. 未配对时进入 `degraded / awaiting-pairing`；
9. 配对码过期前发现设备并完成连接；
10. 多设备失败关闭；
11. 重复 start 只返回当前状态，不创建第二实例；
12. stop 顺序为 runner → transport → App Server → timer/listener；
13. stop 重复调用幂等；
14. 活动 Turn 且 `force:false` 时拒绝停止；
15. `force:true` 时正常停止；
16. token refresh 更新 Realtime auth 和通知 sink，不重启 Codex；
17. CHANNEL_ERROR 进入 transport-offline，恢复后重连并恢复快照；
18. Windows resume 只触发 Transport 重连；
19. Runner loop 抛错进入 degraded/error，并记录安全代码；
20. App Server exit 按 1s、2s、4s 重启；
21. 第三次失败进入 error，不再安排 timer；
22. Doctor 通过后的手动 start 重置重试计数；
23. dispose 取消全部 timer/listener，晚到事件不能复活运行时。

Run:

```powershell
npm.cmd test -- --run apps/host/src/desktop/host-runtime-controller.test.ts
```

Expected: FAIL because controller does not exist.

**Step 2: 实现启动编排**

严格顺序：

```text
loadPrerequisites
→ resolveCodexCli
→ spawn Codex App Server
→ initialize / initialized
→ create SupabaseTransport + setPairingHostId
→ findActiveLinkedDevice
→ [none] degraded(awaiting-pairing)
→ [device] connect(private channel)
→ heartbeat
→ create/update notification sink
→ create RemoteCommandRunner
→ reconcile recoverable Host threads
→ publish authoritative encrypted snapshot
→ runner.start
→ running
```

任一步失败都只清理已成功创建的后置资源，清理顺序反向，且原始 Error 不穿过控制器边界。

**Step 3: 实现配对观察与连接**

- `createPairingRequest()` 必须检查当前状态是 `awaiting-pairing`，且使用控制器持有的同一 `SupabaseTransport`。
- Pairing RPC 成功后启动 2 秒轮询；再次生成配对码先取消旧轮询。
- 过期后保留 `awaiting-pairing`，界面提示重新生成，不进入 error。
- 发现有效 Device 后导入 Host 私钥、连接 Transport、创建 Runner、发布快照并切换到 running。

**Step 4: 实现恢复和停止**

- App Server 非预期 exit 先 `markRunningUnknown()`，停止 runner/transport，再按退避重建。
- Transport 恢复后必须重新 heartbeat、发布快照，再恢复命令消费。
- stop 时若已 claim 但结果未知，不自动重试危险命令；依赖现有租约/幂等规则结束或过期。
- 退出 Electron 时调用 `await runtime.dispose()` 后再 `app.quit()`；禁止 fire-and-forget 关闭。

**Step 5: 更新本地 harness**

Harness 继续用于核心烟雾，但改为通过 controller/fake ports 组合，避免保留第二套启动顺序。

**Step 6: 验证 Task 4**

```powershell
npm.cmd test -- --run apps/host/src/desktop/host-runtime-controller.test.ts apps/host/src/dev/local-remote-host-harness.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 5：实现白名单日志和只读 Doctor

**Files:**

- Create: `apps/host/src/desktop/redacted-logger.ts`
- Create: `apps/host/src/desktop/redacted-logger.test.ts`
- Create: `apps/host/src/desktop/doctor.ts`
- Create: `apps/host/src/desktop/doctor.test.ts`
- Modify: `apps/host/src/desktop/config-store.ts`
- Modify: `apps/host/src/desktop/config-store.test.ts`

**Step 1: 写日志失败测试**

允许字段只有：

```ts
const SafeLogRecordSchema = z
  .object({
    timestamp: z.string().datetime(),
    level: z.enum(["info", "warning", "error"]),
    event: z.string().max(100),
    result: z.enum(["started", "succeeded", "failed", "ignored"]),
    errorCode: z.string().max(100).optional(),
    protocolVersion: z.number().int().optional(),
    appVersion: z.string().max(50).optional(),
    hostIdSuffix: z.string().max(12).optional(),
    workspaceId: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
  })
  .strict();
```

测试向调用边界输入包含 Windows 路径、邮箱、Bearer token、JWT、私钥 JWK、配对码、命令、prompt、output、ciphertext 和嵌套 Error 的对象，确认 logger 拒绝整个未知对象而不是“尽量清洗后写入”。

覆盖：

- 2 MiB 轮换；
- 最多保留 5 个文件；
- 删除 7 天前日志；
- 所有目标必须是已验证 logs 目录的直接子文件；
- 写入失败不能终止 Host；
- 日志文件名不包含账号、Host 全 ID 或 workspace 路径。

**Step 2: 实现白名单 logger**

- 调用方只能传 `SafeLogRecord`；禁止 `unknown`、`Error` 或任意 metadata map。
- 先运行 Schema，再序列化单行 JSONL。
- 错误在产生边界映射为稳定 code，logger 不负责解析错误字符串。

**Step 3: 写 Doctor 失败测试**

返回 DTO：

```ts
interface DoctorItem {
  id: DoctorCheckId;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  remediation?: string;
}
```

检查：Windows 10/11 x64、safeStorage、Session、Host key、Host 注册、Supabase 查询、有效设备/配对状态、授权目录、固定 CLI 路径和版本、临时 app-server 握手、登录启动项、通知公开配置、最近安全错误码。

要求：

- Doctor 只读；不安装 CLI、不刷新系统设置、不改登录启动项、不改代理；
- App Server 检查使用独立临时进程，initialize 成功后立即关闭；
- 单项失败不阻止后续检查；
- 复制摘要只包含项目名、pass/warning/fail、稳定 error code 和应用版本；
- 摘要不含路径、邮箱、token、JWK、配对码、prompt、output 或原始 Error。

**Step 4: 实现 Doctor 与摘要持久化**

- `config.v1.json` 只保存最近一次 Doctor 的非敏感摘要和时间。
- 关键项全部 pass 才允许下一次手动 start 重置 App Server 重试计数。

**Step 5: 验证 Task 5**

```powershell
npm.cmd test -- --run apps/host/src/desktop/redacted-logger.test.ts apps/host/src/desktop/doctor.test.ts apps/host/src/desktop/config-store.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 6：接入 Electron main、托盘和中文界面

**Files:**

- Modify: `apps/host/src/desktop/main.ts`
- Modify: `apps/host/src/desktop/pairing-controller.ts`
- Modify: `apps/host/src/desktop/pairing-controller.test.ts`
- Modify: `apps/host/src/desktop/pairing-transport.ts`
- Modify: `apps/host/src/desktop/pairing-transport.test.ts`
- Modify: `apps/host/src/desktop/tray-controller.ts`
- Modify: `apps/host/src/desktop/tray-controller.test.ts`
- Modify: `apps/host/src/desktop/preload.ts`
- Modify: `apps/host/src/renderer/app.tsx`
- Modify: `apps/host/src/renderer/app.test.tsx`
- Modify: `apps/host/src/renderer/pairing-screen.tsx`
- Modify: `apps/host/src/renderer/pairing-screen.test.tsx`
- Modify: `apps/host/src/renderer/styles.css`

**Step 1: 写 main 组合层测试或提取可测工厂**

若 `main.ts` 直接测试困难，只提取 `createDesktopRuntimeBindings()`；不创建第二个生命周期控制器。测试：

- `startHost` 调用 controller.start；
- `stopHost` 传递 force；
- `runDoctor` 更新 Doctor DTO 和 notice；
- `openLogFolder` 只打开验证后的 logs 目录；
- signOut 前先 await runtime.stop({ force: true })；
- 数据彻底删除前停止并 dispose runtime；
- before-quit 先阻止退出，await dispose 后再真正退出；
- `powerMonitor` resume 调用 controller.handleSystemResume；
- online 事件调用 handleNetworkOnline；
- auth session 更新调用 handleSessionChanged。

**Step 2: 替换 Task 5 的假状态**

- 删除注册 Host 时临时创建、仅供配对的独立 transport。
- Pairing transport 改为调用 `HostRuntimeController.createPairingRequest()`。
- `isHostActive` 改为读取 controller snapshot，只有 `degraded/awaiting-pairing` 才允许首次配对。
- 删除 `activeTurnWorkspaceIds`；workspaceAuthorizer 回调读取 `threadStore.hasActiveTurn(workspaceId)`。

**Step 3: 完成 renderer 和托盘**

总览最少显示：

- Host 已停止 / 启动中 / 等待手机配对 / 运行中 / 网络中断 / Codex 正在恢复 / 异常；
- 最近在线时间；
- 活动远程任务数量；
- 启动/停止按钮；
- Doctor 检查结果；
- 打开日志目录；
- 最近安全错误码的中文说明。

交互：

- 未登录、无项目、Doctor 关键失败时启动按钮禁用并显示原因；
- `awaiting-pairing` 时显示生成配对码入口；
- 已运行时不再显示“假装可配对”的按钮；
- 有活动 Turn 时停止按钮先弹中文确认；
- 网络离线时显示 Codex 仍在本机运行，不声称远程可用；
- 所有触控目标和窗口宽度保持现有响应式约束。

托盘状态增加 degraded 标签；退出回调等待 runtime dispose。不要修改睡眠、休眠、代理、防火墙或管理员权限。

**Step 4: 验证 Task 6**

```powershell
npm.cmd test -- --run apps/host/src/desktop apps/host/src/renderer
npm.cmd run typecheck --workspace @codex-remote/host
npm.cmd run lint --workspace @codex-remote/host
npm.cmd run build --workspace @codex-remote/host
```

Expected: PASS.

---

### Task 7：全量回归、真实本机烟雾和 Git 交付

**Files:**

- Modify if needed: `apps/host/README.md`
- Modify: `docs/superpowers/plans/2026-08-26-windows-host-packaging.md`（只勾选实际通过的 Task 6 项）

**Step 1: 检查修改范围和敏感信息**

```powershell
git status --short --branch
git diff --stat
git diff --check
git diff -- apps/host docs/superpowers/plans
```

检查不得出现 `.env`、Supabase secret/service-role、VAPID 私钥、access/refresh token、Host 私钥、邮箱、个人 Windows 绝对路径、配对码、prompt、output、ciphertext 或真实 Codex 历史。

**Step 2: 执行模拟自动化门禁**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npm.cmd audit --omit=dev
git diff --check
```

执行规则：

- 根 `format:check` 当前已有 143 个历史文件基线问题；本模块不得为追求绿色一次性格式化无关文件。必须保证所有本次修改文件通过 Prettier，并把根检查的当前数量与实施前基线对比，不能新增失败。
- 根 Web build 需要 Supabase 公共构建配置。可使用明确标注为本地测试的公开非密钥值，禁止使用或输出 service-role；若环境仍缺失，Host workspace build 必须通过，并把根 build 标记为环境门禁未验证，不能谎报通过。
- `npm audit` 若只有无法在固定版本范围内安全修复的已知项，记录包名和风险，不自动升级大版本。

**Step 3: 真实本地 Codex smoke**

先运行 Doctor，再对 resolver 找到的固定 0.149.0 x64 binary 做一次只读烟雾：

1. spawn `codex.exe app-server`；
2. 完成 initialize / initialized；
3. 调用 `thread/list`，cwd 仅使用一个用户已授权的测试 workspace；
4. 关闭连接和子进程；
5. 验证没有遗留 codex 子进程。

禁止：创建/恢复 Thread、启动 Turn、批准命令、修改项目、打印会话历史、改变代理或 Codex 登录。

如果真实 smoke 会访问用户本地 Codex 状态，执行前在交付阶段向用户说明目标和影响；失败一次后停止，不反复尝试或自动修复用户环境。

**Step 4: 最终代码审查**

重点检查：

- 是否存在第二套 runtime/runner；
- pairing 是否引用真正的 controller-owned transport；
- active workspace 是否只由 RemoteThreadStore 决定；
- 所有 close/dispose 是否 await 且幂等；
- App Server 重试和 Transport 重连计数是否严格分离；
- renderer/日志/Doctor 是否可能泄露秘密或路径；
- 运行时是否仍可能回退到 WindowsApps 或全局 Codex。

**Step 5: 提交并推送功能分支**

仅在实际门禁结果已复核后：

```powershell
git add apps/host docs/superpowers/plans/2026-08-26-windows-host-packaging.md docs/superpowers/plans/2026-08-28-host-runtime-controller.md
git commit -m "feat(windows): run the encrypted Host desktop"
git push origin feat/windows-host
```

不得推送或合并 `main`，不得创建 PR。

**Step 6: 按七项格式暂停验收**

汇报：

1. 本模块完成的功能；
2. 修改或新增的文件；
3. 数据库、API 或配置变更；
4. 已完成的测试和验证；
5. 当前已知问题或注意事项；
6. 可继续的下一模块（Checkpoint 5C Windows 安装包）；
7. 分支、Commit ID、Commit 信息、推送结果、GitHub 分支链接。

完成后暂停，不开始 Task 7/Checkpoint 5C。

---

## 4. 验收标准

只有同时满足以下条件，Task 6 才可标记完成：

- 首次未配对 Host 显示“等待手机配对”，不显示“运行中”；
- 手机完成配对后 Host 自动建立私有频道并变为运行中；
- 运行中才允许远程命令，断网时不接受新的本地假命令循环；
- 远程 Turn 开始、完成、失败、停止后，活动目录状态准确变化；
- 活动或未知 Turn 所在目录不能被删除；
- App Server 崩溃最多按 1/2/4 秒恢复三次，网络恢复不消耗次数；
- token 刷新后 Realtime 与通知使用新 token，旧 token 不留在新闭包；
- Doctor 不修改系统，日志与复制摘要不泄露敏感内容；
- Electron 退出、退出登录和数据重置前都完成有序停止；
- 模拟测试、Host typecheck/lint/build 通过；根门禁没有新增失败；
- 真实 smoke 只读、单次、无项目修改；
- 代码已提交并推送 `feat/windows-host`，等待用户验收。

## 5. 下一阶段

本计划完成并验收后，下一阶段才是 Checkpoint 5C：准备固定 Codex 资源、配置 electron-builder、生成 Windows x64 NSIS 安装包并做 Electron 自动化验收。
