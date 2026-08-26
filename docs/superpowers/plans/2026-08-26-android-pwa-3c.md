# Android PWA 3C Remote Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已验收的 3B 加密浏览器客户端之上，交付安卓优先的单 Host 控制台、聊天式任务控制页和安全离线 PWA。

**Architecture:** `/hosts` 使用一个客户端会话 Provider 读取当前不可导出的设备身份和唯一有效 Host 链接，再复用 `BrowserRemoteClient` 连接私有 Realtime 频道。页面通过关联 `messageId` 的命令等待器消费权威快照，敏感正文只保存在 React 内存中；Service Worker 仅缓存静态壳、图标和离线页。

**Tech Stack:** Node.js 24、TypeScript 5.9.3 strict、Next.js 15.5.23 App Router、React 19.2.8、Tailwind CSS 4.3.3、shadcn/ui 源码组件、Supabase JS 2.112.3、Vitest 3.2.7、React Testing Library 16.3.2、Playwright 1.62.1。

**Spec:** `docs/superpowers/plans/2026-08-26-android-pwa-3c-design.md`

## Global Constraints

- 仅实现 3C；不创建 Vercel、Hosted Supabase、Web Push 或 Windows 安装包。
- 简体中文优先；单账号、单 Windows Host、单安卓浏览器设备是首要路径。
- 不在 Supabase、Cache Storage、Local Storage、日志或分析中保存明文提示词、回复、代码、命令、Windows 路径或密文信封。
- 浏览器只使用 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；禁止包含 `service_role` 或 secret key。
- 手机只提交 `workspaceId`；界面不得显示或推导本地 Windows 路径。
- 外部正在运行的 Codex Desktop 任务只读；不得追加、停止或审批。
- 每次新的用户操作使用新的 `messageId` 和默认幂等键；仅同一次明确重试可以复用调用方指定的幂等键。
- 离线时禁止新建、恢复、发送、追加、审批和停止；只显示静态壳和最后一次非敏感状态。
- 保持 `protocolVersion = 1`；未知或缺少归属信息的审批必须失败关闭，不能显示为可操作审批。
- 继续使用现有 `feat/android-pwa` 工作树和分支；不合并或推送 `main`，不自动创建 PR。
- 每个任务先写失败测试，再最小实现，再运行聚焦验证并提交；完成全部 3C 后才推送功能分支并暂停验收。

## File Map

- `packages/protocol/src/commands.ts`：为审批事件补充任务和 Turn 归属。
- `apps/host/src/codex-event-mapper.ts`、`remote-command-runner.ts`：从 App Server 请求中提取安全的审批归属，缺失时拒绝远程展示。
- `apps/web/src/features/remote/remote-command-service.ts`：订阅优先、按回执关联事件的可靠页面命令等待器。
- `apps/web/src/features/remote/remote-reducer.ts`：保存审批、回执和任务终态，不负责页面导航。
- `apps/web/src/features/session/*`：恢复浏览器设备、查找唯一有效 Host 链接并创建远程会话。
- `apps/web/src/features/hosts/*`：单屏 Host、项目和任务首页。
- `apps/web/src/features/thread/*`：任务控制器、时间线、输入区、审批和停止对话框。
- `apps/web/src/features/pwa/*`、`apps/web/public/sw.js`：安装、联网状态和严格静态缓存边界。
- `apps/web/e2e/*`：本地 OTP、加密 Fake Host、响应式控制台和 PWA 验收。

---

### Task 1: Complete the UI-facing remote contracts and reducer

**Files:**

- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/commands.test.ts`
- Modify: `apps/host/src/codex-event-mapper.ts`
- Modify: `apps/host/src/codex-event-mapper.test.ts`
- Modify: `apps/host/src/remote-command-runner.ts`
- Modify: `apps/host/src/remote-command-runner.test.ts`
- Create: `apps/web/src/features/remote/remote-command-service.ts`
- Create: `apps/web/src/features/remote/remote-command-service.test.ts`
- Modify: `apps/web/src/features/remote/remote-reducer.ts`
- Modify: `apps/web/src/features/remote/remote-reducer.test.ts`
- Modify: `apps/web/src/features/remote/remote-client-context.tsx`

**Interfaces:**

- Produces: `RemoteApprovalRequest = Extract<RemoteEvent, { type: "approval.request" }>` with required `threadId` and `turnId`.
- Produces: `enqueueAndWaitForEvent<T>()` for `thread.list.result`, `thread.snapshot`, `turn.status`, and `command.receipt` correlation.
- Produces: reducer fields `pendingApprovals` and `commandReceipts`.
- Consumes: the accepted 3B `RemoteClient.enqueue()`, `subscribe()`, and unique-by-default idempotency behavior.

- [ ] **Step 1: Write failing approval ownership tests**

Add protocol and Host tests requiring this wire shape:

```ts
const approval = {
  type: "approval.request" as const,
  requestMessageId,
  requestId: "approval-1",
  threadId: "thread-1",
  turnId: "turn-1",
  method: "item/commandExecution/requestApproval",
  display: { title: "需要确认操作" },
  allowedDecisions: ["accept", "decline"] as const,
};

expect(remoteEventSchema.parse(approval)).toEqual(approval);
```

Update the mapper test so `params.threadId` and `params.turnId` are copied, while `params.command`, `params.cwd`, and `params.reason` never appear in the result. Add a malformed request test where either ID is missing and `approvalRequest()` returns `null`.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
npm.cmd exec -- vitest run packages/protocol/src/commands.test.ts apps/host/src/codex-event-mapper.test.ts apps/host/src/remote-command-runner.test.ts
```

Expected: FAIL because approval events do not yet contain `threadId` and `turnId`, and the mapper does not fail closed.

- [ ] **Step 3: Add task ownership to approval events**

Extend the strict `approval.request` schema with required `threadId` and `turnId`. Change the Host mapper contract to:

```ts
export interface ApprovalDisplay {
  requestId: string | number;
  threadId: string;
  turnId: string;
  method: string;
  display: { title: string };
  allowedDecisions: ["accept", "acceptForSession", "decline", "cancel"];
}

approvalRequest(request: JsonRpcServerRequest): ApprovalDisplay | null;
```

Only accept string `params.threadId` and `params.turnId` with non-zero length. In `forwardApproval`, if mapping returns `null`, call `resolveApproval({ requestId: request.id, decision: "cancel" })` and do not broadcast an event.

- [ ] **Step 4: Write failing correlated-command tests**

Create `remote-command-service.test.ts` with a fake `RemoteClient`. Cover an event that arrives before `enqueue()` resolves, an unrelated event, timeout cleanup, enqueue rejection, and a caller-supplied retry key.

```ts
const resultPromise = enqueueAndWaitForEvent(
  client,
  { type: "thread.read", workspaceId: "workspace-1", threadId: "thread-1" },
  (event): event is Extract<RemoteEvent, { type: "thread.snapshot" }> =>
    event.type === "thread.snapshot",
  { timeoutMs: 1_000 },
);

await expect(resultPromise).resolves.toMatchObject({
  type: "thread.snapshot",
  requestMessageId: receipt.messageId,
});
```

- [ ] **Step 5: Implement the subscribe-before-send command waiter**

Export this exact API:

```ts
export interface WaitForEventOptions {
  timeoutMs?: number;
  idempotencyKey?: string;
}

export async function enqueueAndWaitForEvent<T extends RemoteEvent>(
  client: RemoteClient,
  command: RemoteCommand,
  accepts: (event: RemoteEvent) => event is T,
  options?: WaitForEventOptions,
): Promise<T>;
```

Subscribe before `enqueue`, retain only candidate events received before the receipt, and resolve only when `event.requestMessageId` or `event.messageId` equals the returned receipt `messageId`. Default timeout is 10 seconds. Every resolve, reject, and timeout path must unsubscribe and clear its timer. Do not automatically retry a failed command.

- [ ] **Step 6: Track approvals and receipts in the reducer**

Add these fields without persisting them:

```ts
pendingApprovals: Record<string, RemoteApprovalRequest>;
commandReceipts: Record<
  string,
  Extract<RemoteEvent, { type: "command.receipt" }>
>;
```

Use `String(requestId)` as the approval key. A terminal `turn.status` (`completed`, `failed`, or `interrupted`) removes approvals with the same `threadId` and `turnId`. A `command.receipt` replaces the status for its `messageId`. Update `eventToAction()` so approval and receipt events are no longer discarded.

- [ ] **Step 7: Run focused and shared verification**

Run:

```powershell
npm.cmd exec -- vitest run packages/protocol/src/commands.test.ts apps/host/src/codex-event-mapper.test.ts apps/host/src/remote-command-runner.test.ts apps/web/src/features/remote
npm.cmd run typecheck
npm.cmd run lint
```

Expected: all commands pass and existing 3B reconnect/idempotency tests remain green.

- [ ] **Step 8: Commit the contract slice**

```powershell
git add packages/protocol/src/commands.ts packages/protocol/src/commands.test.ts apps/host/src/codex-event-mapper.ts apps/host/src/codex-event-mapper.test.ts apps/host/src/remote-command-runner.ts apps/host/src/remote-command-runner.test.ts apps/web/src/features/remote
git commit -m "feat(remote): add correlated console state"
```

---

### Task 2: Restore the paired Host session in the protected route layout

**Files:**

- Create: `apps/web/src/features/session/paired-host-registry.ts`
- Create: `apps/web/src/features/session/paired-host-registry.test.ts`
- Create: `apps/web/src/features/session/remote-session-context.tsx`
- Create: `apps/web/src/features/session/remote-session-context.test.tsx`
- Create: `apps/web/src/app/hosts/layout.tsx`
- Modify: `apps/web/src/features/remote/remote-client-context.tsx`

**Interfaces:**

- Produces: `PairedHostRecord { hostId, hostName, deviceId, protocolVersion }`.
- Produces: `RemoteSessionState = loading | unpaired | connecting | ready | offline | error`.
- Produces: `useRemoteSession()` and, after a pair is found, the existing `useRemote()` context.
- Consumes: `DeviceIdentityStore`, verified Supabase claims, `host_device_links`, `hosts`, and `BrowserRemoteClient`.

- [ ] **Step 1: Write failing paired-Host registry tests**

Cover missing verified claims, missing IndexedDB identity, no active link, revoked link, revoked Host, protocol version other than `1`, and the one valid Host path. Query the active link first by `device_id`, then query the Host by returned `host_id`; do not rely on an untyped nested join.

```ts
await expect(registry.load()).resolves.toEqual({
  hostId: "host-1",
  hostName: "开发电脑",
  deviceId: "device-1",
  protocolVersion: 1,
});
```

If multiple active links are returned, select the most recently updated link but expose a diagnostic error in tests; the UI still operates only one Host in this MVP.

- [ ] **Step 2: Implement `PairedHostRegistry`**

Use `auth.getClaims()` for the owner ID. Load the owner’s `DeviceIdentity`, read active `host_device_links` restricted by `owner_id` and `device_id`, then read the non-revoked Host. Return `null` for no identity or no link. Throw Chinese user-safe errors for protocol mismatch and database failures. Never return `public_key` or a session key to components.

- [ ] **Step 3: Write failing session Provider tests**

Use injected factories for the registry and client. Verify these transitions:

```text
loading -> unpaired
loading -> connecting -> ready
loading -> connecting -> offline
loading -> error
ready -> offline -> ready after online event and snapshot recovery
```

Verify cleanup calls `disconnect()` exactly once and that a snapshot timeout does not report the Host as online.

- [ ] **Step 4: Implement `RemoteSessionProvider`**

Export:

```ts
export type RemoteSessionState =
  | { status: "loading" }
  | { status: "unpaired" }
  | { status: "connecting"; host: PairedHostRecord }
  | { status: "ready"; host: PairedHostRecord }
  | { status: "offline"; host: PairedHostRecord; message: string }
  | { status: "error"; message: string };
```

The Provider creates one browser Supabase client, one `DeviceIdentityStore`, one `PairedHostRegistry`, and one `BrowserRemoteClient` per mount. After loading a pair it renders the existing `RemoteProvider`, which remains the sole owner of `connect()` and `disconnect()`.

Extend `RemoteProviderProps` with this exact callback:

```ts
onConnectionStateChange?: (
  state:
    | { status: "connecting" }
    | { status: "ready" }
    | { status: "offline"; message: string }
    | { status: "error"; message: string },
) => void;
```

`RemoteProvider` subscribes before connecting, calls `requestSnapshotAndWait()` after subscription, dispatches the returned Host snapshot, and reports `ready` only when that snapshot says online. It reports `offline` for a valid but offline Host and `error` for an unusable channel. `RemoteSessionProvider` translates missing/revoked pairs to `unpaired` and protocol failures to `error`; it must not create a second channel or retry loop.

- [ ] **Step 5: Add the protected Host layout**

`apps/web/src/app/hosts/layout.tsx` is a server layout that relies on the existing middleware authentication gate and renders:

```tsx
<RemoteSessionProvider>{children}</RemoteSessionProvider>
```

Do not pass tokens, claims, device IDs, or keys through server props or rendered HTML.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/features/session apps/web/src/features/remote
npm.cmd run typecheck
npm.cmd run lint
```

Commit:

```powershell
git add apps/web/src/features/session apps/web/src/features/remote/remote-client-context.tsx apps/web/src/app/hosts/layout.tsx
git commit -m "feat(web): restore paired Host sessions"
```

---

### Task 3: Build the single-screen Host, workspace, and thread dashboard

**Files:**

- Modify: `apps/web/src/app/hosts/page.tsx`
- Create: `apps/web/src/components/app-shell.tsx`
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/features/hosts/hosts-dashboard.tsx`
- Create: `apps/web/src/features/hosts/hosts-dashboard.test.tsx`
- Create: `apps/web/src/features/hosts/workspace-switcher.tsx`
- Create: `apps/web/src/features/threads/use-thread-list.ts`
- Create: `apps/web/src/features/threads/use-thread-list.test.ts`
- Create: `apps/web/src/features/threads/thread-list.tsx`
- Create: `apps/web/src/features/threads/thread-list.test.tsx`
- Create: `apps/web/src/features/threads/new-thread-dialog.tsx`
- Create: `apps/web/src/features/threads/new-thread-dialog.test.tsx`

**Interfaces:**

- Produces: `/hosts` single-screen dashboard and `useThreadList(workspaceId)`.
- Produces: list rows linking to `/hosts/[hostId]/threads/[threadId]` only after a matching `thread.snapshot` is received.
- Consumes: `RemoteSessionState`, `HostSnapshot.workspaces`, `thread.list`, `thread.read`, and `thread.start`.

- [ ] **Step 1: Write failing dashboard state tests**

Cover loading, unpaired, connecting, online, offline, no authorized workspace, workspace selection, empty task list, loading skeleton, list error, “电脑端正在运行” read-only badge, idle badge, running badge, pagination, and disabled new-task action while offline.

The chosen workspace follows this rule:

```ts
selectedWorkspaceId =
  workspaces.find((item) => item.id === savedWorkspaceId)?.id ??
  workspaces[0]?.id ??
  null;
```

Persist only the opaque ID under `codex-remote:last-workspace:<hostId>`; never persist workspace name or path.

- [ ] **Step 2: Implement the app shell and minimal shadcn source components**

Use the existing `cn()` helper, Tailwind source classes, 44 px minimum heights, visible `focus-visible` rings, `aria-live` on status text, and safe-area padding. Do not add a component registry runtime or broad visual framework. `AppShell` provides a 720 px content column on mobile/desktop and a compact top bar with “添加电脑”.

- [ ] **Step 3: Implement `useThreadList()` with correlation and pagination**

The hook sends:

```ts
{
  type: "thread.list",
  workspaceId,
  limit: 30,
  ...(cursor ? { cursor } : {}),
}
```

Use `enqueueAndWaitForEvent()` and accept only `thread.list.result` with the selected `workspaceId`. A fresh load replaces the list; “加载更多” appends by thread ID and updates `nextCursor`. Switching workspace cancels the old state update. Offline mode leaves the last in-memory list visible but does not enqueue.

- [ ] **Step 4: Implement the single-screen dashboard**

Render Host name, online/offline badge, last observed time, project selector, task list, refresh, and new task in `/hosts`. Display project names only. If session is unpaired, show one primary action to `/pair`; protocol/revocation errors show “重新配对”.

Task rows display title, relative update time, state, and read-only warning. Clicking a row sends `thread.read`; after the matching snapshot arrives, navigate to the thread route. A read failure stays on the list and announces an error.

- [ ] **Step 5: Implement new task creation**

The dialog confirms the selected project name and sends `{ type: "thread.start", workspaceId }`. Disable submission when offline, no project is selected, or a request is pending. Navigate only after the matching `thread.snapshot`; do not infer a thread ID from a queue receipt.

- [ ] **Step 6: Run focused responsive component verification**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/features/hosts apps/web/src/features/threads
npm.cmd run typecheck
npm.cmd run lint
```

Expected: all state and interaction tests pass; no component renders a Windows path or unknown JSON.

- [ ] **Step 7: Commit the dashboard slice**

```powershell
git add apps/web/src/app/hosts/page.tsx apps/web/src/components apps/web/src/features/hosts apps/web/src/features/threads
git commit -m "feat(web): add Host and thread dashboard"
```

---

### Task 4: Build the chat-style thread console and safe controls

**Files:**

- Create: `apps/web/src/app/hosts/[hostId]/threads/[threadId]/page.tsx`
- Create: `apps/web/src/components/ui/textarea.tsx`
- Create: `apps/web/src/components/ui/scroll-area.tsx`
- Create: `apps/web/src/features/thread/use-thread-controller.ts`
- Create: `apps/web/src/features/thread/use-thread-controller.test.ts`
- Create: `apps/web/src/features/thread/thread-screen.tsx`
- Create: `apps/web/src/features/thread/thread-screen.test.tsx`
- Create: `apps/web/src/features/thread/thread-timeline.tsx`
- Create: `apps/web/src/features/thread/thread-timeline.test.tsx`
- Create: `apps/web/src/features/thread/thread-composer.tsx`
- Create: `apps/web/src/features/thread/thread-composer.test.tsx`
- Create: `apps/web/src/features/thread/approval-card.tsx`
- Create: `apps/web/src/features/thread/approval-card.test.tsx`
- Create: `apps/web/src/features/thread/stop-turn-dialog.tsx`
- Create: `apps/web/src/features/thread/stop-turn-dialog.test.tsx`

**Interfaces:**

- Produces: `useThreadController({ hostId, threadId })` with snapshot, stream text, approvals, send, resume, stop, refresh, pending flags, and error.
- Consumes: `thread.read`, `thread.resume`, `turn.start`, `turn.steer`, `turn.interrupt`, `approval.respond`, reducer snapshots/deltas/status/approvals, and current session state.

- [ ] **Step 1: Write failing controller tests**

Cover route Host mismatch, initial `thread.read`, idle historical resume, new turn, active Host-owned steer, whitespace rejection, offline rejection, external-running read-only rejection, matching stream delta, terminal status, interrupt, and command failure preserving draft text.

Use these exact command rules:

```ts
if (snapshot.readOnly && snapshot.state === "running") reject("电脑端正在运行");
if (snapshot.readOnly && snapshot.state === "idle") send("thread.resume");
if (snapshot.activeTurnId) send("turn.steer");
else send("turn.start");
```

After `thread.resume`, wait for the matching authoritative snapshot before enabling the composer.

- [ ] **Step 2: Implement the controller**

Read the thread on first mount if it is not already in reducer state. Derive the active stream key as `${threadId}:${activeTurnId}`. Keep drafts in component memory only. `send(text)` trims for validation but sends the user’s original non-empty text; clear the draft only after queue insertion succeeds. Never auto-retry an ambiguous send.

`stop()` requires an active Turn ID and sends `turn.interrupt`. After stop, wait for `turn.status` with `interrupted`, then request `thread.read` for an authoritative snapshot.

- [ ] **Step 3: Write and implement timeline tests**

Test every `RemoteTimelineItem.kind`, status labels, stream text, empty state, failure state, semantic roles, and unknown data omission. Render user text on the right and Codex text on the left; render reasoning/command/file-change as compact expandable status blocks.

Implement near-bottom scrolling with an 80 px threshold:

```ts
const nearBottom =
  element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
```

Only call `scrollTo()` after new content when `nearBottom` was true.

- [ ] **Step 4: Write and implement composer tests**

Test disabled states, pending label, Enter to send, Shift+Enter newline, IME composition, draft preservation after error, safe-area padding, and a minimum 44 px send target. Use a growing textarea capped at 160 px. Do not submit while `event.nativeEvent.isComposing` is true.

- [ ] **Step 5: Write and implement approval card tests**

Map only these server decisions:

```ts
const approvalLabels = {
  accept: "允许一次",
  acceptForSession: "本次任务允许",
  decline: "拒绝",
  cancel: "取消",
} as const;
```

Render only `allowedDecisions`. Submit `{ type: "approval.respond", requestId, decision }`, immediately lock all choices, and request a thread refresh after the `command.receipt`. If the matching Turn becomes terminal before response, label the card “审批已失效” and do not enqueue.

- [ ] **Step 6: Write and implement stop confirmation tests**

The first tap opens a dialog containing “停止后，本次正在生成的内容会中断”。Only the dialog’s destructive confirm sends `turn.interrupt`; cancel and backdrop close send nothing. Disable repeated confirmation while pending.

- [ ] **Step 7: Assemble the route and thread screen**

Validate that route `hostId` equals the paired Host and route `threadId` equals the loaded snapshot. Render a back link, task title, state badge, timeline, approvals, resume CTA for idle read-only history, composer, and stop control. External running tasks show a persistent read-only banner.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/features/thread apps/web/src/features/remote
npm.cmd run typecheck
npm.cmd run lint
```

Commit:

```powershell
git add apps/web/src/app/hosts apps/web/src/components/ui apps/web/src/features/thread
git commit -m "feat(web): add remote Codex console controls"
```

---

### Task 5: Add installable PWA, themes, and a non-sensitive offline shell

**Files:**

- Create: `apps/web/src/app/manifest.ts`
- Create: `apps/web/src/app/offline/page.tsx`
- Create: `apps/web/src/app/offline/offline-view.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/theme-provider.tsx`
- Create: `apps/web/src/components/theme-toggle.tsx`
- Create: `apps/web/src/components/service-worker-register.tsx`
- Create: `apps/web/src/components/install-prompt.tsx`
- Create: `apps/web/src/features/pwa/offline-status.ts`
- Create: `apps/web/src/features/pwa/offline-status.test.ts`
- Create: `apps/web/src/features/pwa/service-worker-policy.test.ts`
- Create: `apps/web/public/sw.js`
- Create: `apps/web/public/icons/icon-192.png`
- Create: `apps/web/public/icons/icon-512.png`
- Create: `apps/web/public/icons/icon-maskable-512.png`

**Interfaces:**

- Produces: typed Next.js Manifest, standalone install support, light/dark theme, install prompt, and `/offline` fallback.
- Produces: `OfflineStatus { online: boolean; observedAt: string; lastTurnStatus: string | null }` only.
- Consumes: `navigator.onLine`, `beforeinstallprompt`, non-sensitive reducer state, and static assets.

- [ ] **Step 1: Write failing manifest and cache-policy tests**

Assert Chinese name/short name, `start_url: "/hosts"`, `display: "standalone"`, theme/background colors, 192/512/maskable icons, and that the Service Worker source contains an explicit network-only deny rule for:

```text
/hosts
/login
/pair
/api
supabase.co
/auth/v1
/rest/v1
/realtime/v1
```

Also assert that cache writes are limited to `/offline`, Next static chunks, CSS, fonts, and the three icon paths.

- [ ] **Step 2: Implement the strict offline status store**

Export:

```ts
export interface OfflineStatus {
  online: boolean;
  observedAt: string;
  lastTurnStatus: string | null;
}

export function saveOfflineStatus(status: OfflineStatus): void;
export function loadOfflineStatus(): OfflineStatus | null;
```

Use a versioned localStorage key and strict parsing. Reject extra keys and values larger than 1 KB. Do not accept Host name, workspace, thread ID, title, prompt, output, path, ciphertext, or error detail.

- [ ] **Step 3: Implement Manifest and Service Worker**

Use cache name `codex-remote-shell-v1`. Install pre-caches only `/offline` and icons. For authenticated navigation or Supabase origins, use network-only; failed navigation returns cached `/offline`. For same-origin static assets, use stale-while-revalidate. Delete caches whose names do not equal the current version on activate.

- [ ] **Step 4: Add theme and install guidance**

Wrap the application with `next-themes` using `attribute="class"`, `defaultTheme="system"`, and `enableSystem`. Add a theme toggle to `AppShell`. Register `/sw.js` after the page becomes interactive.

Capture `beforeinstallprompt` without preventing ordinary browser use. Show “安装到手机” when the prompt is available; otherwise show concise Android Chrome instructions. Hide guidance when `display-mode: standalone` matches.

- [ ] **Step 5: Create and inspect the icons**

Use the image generation skill during implementation with this exact direction: “minimal grayscale Codex Remote app icon, rounded square, centered computer screen linked to a phone by one secure arc, no letters, no gradients, high contrast, flat vector style”. Produce 192×192, 512×512, and a 512×512 maskable version with all essential artwork inside the central 80% safe zone. Inspect each file visually and verify dimensions before adding it.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/features/pwa
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

After build, inspect `.next/static` and generated manifest references. Commit:

```powershell
git add apps/web/src/app apps/web/src/components apps/web/src/features/pwa apps/web/public
git commit -m "feat(web): add installable offline PWA shell"
```

---

### Task 6: Add browser acceptance, run the full gate, and push checkpoint 3C

**Files:**

- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`
- Create: `apps/web/e2e/mobile-console.spec.ts`
- Create: `apps/web/e2e/pwa.spec.ts`
- Create: `apps/web/e2e/helpers/local-supabase.ts`
- Create: `apps/web/e2e/helpers/encrypted-fake-host.ts`
- Create: `apps/web/README.md`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `npm.cmd run test:e2e --workspace @codex-remote/web`.
- Produces: a loopback-only encrypted Fake Host used only by Playwright; it never enters the production bundle.
- Consumes: local Supabase/Mailpit from Docker Desktop, local publishable/service-role values held only in child-process memory, and the real protocol encryption helpers.

- [ ] **Step 1: Add fail-closed local test helpers**

`local-supabase.ts` runs `supabase.cmd status -o env`, parses required values in memory, and immediately rejects unless Supabase, database, Studio, and Mailpit hostnames are `127.0.0.1` or `localhost`. Redact every key and JWT from thrown errors and test output. It creates a disposable Auth user and reads the OTP from local Mailpit; cleanup deletes the user and local test rows.

- [ ] **Step 2: Implement the encrypted Fake Host fixture**

The fixture generates an in-memory P-256 Host key, inserts one local Host and one active link for the browser’s registered device using the local service role, derives the AES key from the device public key, and handles only these commands:

```text
host.snapshot
thread.list
thread.read
thread.start
thread.resume
turn.start
turn.steer
turn.interrupt
approval.respond
```

It reads encrypted local `remote_commands`, opens them with `openRemotePayload`, returns encrypted protocol events over private `host:<hostId>` Broadcast, and records only command type plus message ID in test memory. Fixed fixtures must include an idle task, an external running read-only task, ordered stream deltas, one approval request, a completed Turn, and an interrupted Turn. Never print decrypted text or keys.

- [ ] **Step 3: Add real local OTP browser acceptance**

`auth.spec.ts` requests an OTP through `/login`, obtains the code from loopback Mailpit via the helper, verifies it, and asserts redirect to `/hosts`. Also test invalid email, wrong code, expired code message, and protected-route redirect when logged out.

- [ ] **Step 4: Add responsive console acceptance**

Run the same core flow at 360×800 and 390×844, plus a 1280×800 desktop smoke:

1. authenticated user reaches the unpaired state;
2. local fixture links the browser device and the page reconnects;
3. Host status and workspace appear without a path;
4. task list loads, paginates, and opens an idle task;
5. idle history resumes, a new instruction sends, and deltas render in order;
6. running instruction steers instead of starting another Turn;
7. approval renders only allowed buttons and locks after response;
8. stop requires confirmation and reaches interrupted state;
9. external running task remains read-only;
10. offline mode disables every command-producing control.

For each viewport assert `document.documentElement.scrollWidth <= window.innerWidth`, every primary touch control is at least 44×44 px, focus is visible, and the composer remains visible after reducing viewport height to emulate a mobile keyboard.

- [ ] **Step 5: Add PWA browser acceptance**

Verify Manifest fields and icon responses, Service Worker registration, standalone metadata, light/dark theme, install guidance fallback, and offline navigation to `/offline`. Inspect Cache Storage and assert no `/hosts`, thread route, Supabase request, prompt, output, ciphertext, or authenticated HTML was cached.

- [ ] **Step 6: Run the complete local gate once**

With Docker Desktop and local Supabase already running, execute:

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:db
supabase.cmd db lint --local --fail-on error
npm.cmd run build
npm.cmd run test:e2e --workspace @codex-remote/web
npm.cmd audit --omit=dev
git diff --check
git status --short --branch
```

Expected: every command passes. If any command fails, stop, diagnose, fix only 3C scope, and rerun the smallest failing check before repeating the full gate.

- [ ] **Step 7: Inspect the final diff and sensitive output**

Confirm no unrelated modules changed. Search tracked files and `.next/static` for `service_role`, `sb_secret_`, JWT-like test values, test email addresses, `C:\\`, private JWK `"d"`, prompt fixtures, and plaintext model output. Test fixture matches are allowed only inside test source and must not occur in browser production chunks.

- [ ] **Step 8: Commit any acceptance-only files**

```powershell
git add apps/web/e2e apps/web/playwright.config.ts apps/web/README.md apps/web/package.json package.json package-lock.json
git commit -m "test(web): add Android PWA acceptance"
```

If the previous feature commits already contain every tracked change, do not create an empty commit.

- [ ] **Step 9: Push only the current feature branch**

First verify:

```powershell
git branch --show-current
git status --short --branch
git log --oneline origin/feat/android-pwa..HEAD
```

Expected branch: `feat/android-pwa`; worktree clean. Then push once:

```powershell
git push origin feat/android-pwa
```

Do not push `main`, create a PR, deploy Vercel, or apply a hosted Supabase migration.

- [ ] **Step 10: Stop at checkpoint 3C**

Report exactly:

1. 本模块完成的功能；
2. 修改或新增的文件；
3. 数据库、API 或配置变更；
4. 已完成的测试和验证；
5. 当前已知问题或需要注意的地方；
6. 可以继续开发的下一个模块；
7. 分支、Commit ID、提交信息、推送结果和 GitHub 分支链接。

Wait for user acceptance. Do not begin Web Push/reliability Module 4.

## Self-Review Checklist

- 需求覆盖：单屏首页、项目、任务列表/读取/新建/恢复、时间线、发送/追加、审批、停止、离线、安装、移动端验收均映射到 Task 1–6。
- 安全覆盖：路径不下发、敏感正文不缓存、私有 Realtime、无浏览器 secret、外部运行任务只读、未知审批失败关闭。
- 恢复覆盖：3B 的新 `messageId`、匹配快照和重连逻辑保持不变；3C 页面等待器处理早到事件且不自动重试。
- 类型一致：审批使用 `threadId`、`turnId`；等待器同时支持 `requestMessageId` 与 `messageId`；页面只消费协议 DTO。
- 外部边界：不创建 Hosted Supabase/Vercel，不启用 Web Push，不修改 Windows 安装和睡眠设置。
