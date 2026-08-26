# Windows Host Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use `superpowers:using-git-worktrees` before implementation, `superpowers:test-driven-development` for every behavior change, `superpowers:systematic-debugging` for failures, and `superpowers:verification-before-completion` before every checkpoint report. Execute one checkpoint at a time and stop after pushing it.

**Goal:** 将现有 Host 核心交付为安全、可安装、当前用户运行的 Windows 10/11 x64 Electron 应用，并在独立授权后完成安卓手机流量、VPN 关闭状态下的端到端验收。

**Architecture:** Electron main 独占凭据、文件、Supabase 和 Codex 进程权限；本地 React/Vite renderer 只通过严格 Schema 的 preload API 管理状态。`HostRuntimeController` 组合现有 `CodexProcess`、`CodexAppServerAdapter`、`SupabaseTransport`、`RemoteCommandRunner` 和通知投递器。敏感数据由 Electron `safeStorage`/Windows DPAPI 保护，安装包使用当前用户级 NSIS x64。

**Tech Stack:** Node.js 24、TypeScript 5.9.3 strict、Electron 44.0.0、electron-builder 26.15.3、Vite 8.2.2、React 19.2.8、Tailwind CSS 4.3.3、Zod 3.25.76、Supabase JS 2.112.3、Vitest 3.2.7、Playwright 1.62.1、官方 Codex CLI 0.149.0。

**Spec:** `docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md`

## Global Constraints

- 只实现模块五；不新增 Git、Diff、文件浏览、语音、图片、多用户、多 Host 或原生安卓功能。
- Windows 应用在当前用户会话中运行，不创建 LocalSystem 服务，不请求管理员权限，不开放入站端口。
- 不修改睡眠、休眠、电源计划、防火墙、路由器、VPN 或现有 Codex/OpenAI 代理设置。
- Electron 不加载 Vercel 或其他远程页面；renderer 只加载打包的 `app://host` 本地资源。
- renderer 禁用 Node 集成，启用 context isolation 和 sandbox；只暴露白名单 IPC 方法，不暴露 `ipcRenderer`。
- access token、refresh token 和 Host 私钥只存在主进程内存及 DPAPI 加密文件中。
- 手机、Supabase、云端审计和 Push 通知都不得看到 Windows 路径、提示词、回复、代码、原始命令或凭据。
- 手机始终只提交 `workspaceId`；主进程将其解析为已授权规范路径。
- 默认卸载保留本机配置；完全清除必须在应用内二次确认，且不得触碰项目目录或 Codex 历史。
- MVP 不实现自动更新；没有代码签名证书时明确记录 SmartScreen 限制。
- 新建 `feat/windows-host` 功能分支/工作树；不推送或合并 `main`，不创建 PR。
- Hosted Supabase、Vercel 环境变量、Preview 部署和真机测试属于独立外部操作；每项执行前报告目标与影响并等待明确授权。
- 模块五分 5A、5B、5C、5D 四个验收点；每个验收点提交、推送后暂停。

## File Map

### Desktop shell and shared contracts

- `apps/host/src/desktop/main.ts`：Electron 生命周期和单实例入口。
- `apps/host/src/desktop/app-protocol.ts`：只读 `app://host` 本地资源协议。
- `apps/host/src/desktop/window-manager.ts`：安全 BrowserWindow 和窗口恢复。
- `apps/host/src/desktop/tray-controller.ts`：托盘菜单和状态。
- `apps/host/src/desktop/login-item.ts`：当前用户登录启动项。
- `apps/host/src/desktop/ipc-controller.ts`：sender 校验、Schema 校验和命令分发。
- `apps/host/src/desktop/preload.ts`：最小 `contextBridge` API。
- `apps/host/src/desktop/contract.ts`：renderer/main DTO 和 Zod Schema。
- `apps/host/src/renderer/*`：登录、总览、项目、配对、Doctor 和设置界面。
- `apps/host/src/renderer/components/ui/*`：仅复制本窗口需要的 shadcn/ui 源码组件。

### Local state and Host runtime

- `apps/host/src/desktop/credential-store.ts`：DPAPI 加密 Session 和 Host 私钥。
- `apps/host/src/desktop/config-store.ts`：版本化、原子非敏感配置。
- `apps/host/src/desktop/workspace-authorizer.ts`：原生目录授权和规范路径。
- `apps/host/src/desktop/supabase-auth-controller.ts`：Electron 邮箱 OTP 和令牌刷新。
- `apps/host/src/desktop/host-registry.ts`：唯一 Host 注册和恢复。
- `apps/host/src/desktop/host-runtime-controller.ts`：现有 Host 核心的统一生命周期。
- `apps/host/src/desktop/codex-cli-resolver.ts`：定位安装包内独立 Codex CLI。
- `apps/host/src/desktop/doctor.ts`：只读诊断。
- `apps/host/src/desktop/redacted-logger.ts`：白名单 JSONL 和轮换。
- `apps/host/src/desktop/data-reset.ts`：二次确认后的精确本机数据清理。

### Build, packaging, and acceptance

- `apps/host/index.html`、`apps/host/vite.config.ts`：本地 renderer 构建。
- `apps/host/tsconfig.desktop.json`、`tsconfig.renderer.json`：主进程/preload 与 renderer 类型边界。
- `apps/host/electron-builder.yml`：NSIS x64 当前用户安装包。
- `apps/host/assets/*`：应用和托盘 ICO。
- `apps/host/e2e/*`、`apps/host/playwright.config.ts`：Electron 用户路径验收。
- `apps/host/scripts/*`：只处理公开运行配置、Codex CLI 和打包产物校验。
- `apps/host/package.json`、根 `package.json`、`package-lock.json`：固定依赖和统一命令。
- `docs/windows-host-user-guide.md`：面向小白的安装、配对、启动和故障说明。
- `docs/acceptance/windows-host-real-device.md`：真机验收记录模板。
- `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`：只更新模块状态和交接入口。

---

## Checkpoint 5A: Electron desktop security shell

### Task 1: Create the isolated Windows Host branch and build skeleton

**Files:**

- Create: `docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md`
- Create: `docs/superpowers/plans/2026-08-26-windows-host-packaging.md`
- Modify: `apps/host/package.json`
- Modify: `package-lock.json`
- Modify: `package.json`
- Create: `apps/host/index.html`
- Create: `apps/host/vite.config.ts`
- Create: `apps/host/tsconfig.desktop.json`
- Create: `apps/host/tsconfig.renderer.json`
- Create: `apps/host/src/desktop/main.ts`
- Create: `apps/host/src/desktop/preload.ts`
- Create: `apps/host/src/renderer/main.tsx`
- Create: `apps/host/src/renderer/app.tsx`
- Create: `apps/host/src/renderer/styles.css`

- [ ] **Step 1: Verify the exact base before creating the worktree**

From the existing `feat/android-pwa` worktree run:

```powershell
git status --short --branch
git rev-parse HEAD
git ls-remote --heads origin feat/windows-host
```

Expected base commit: `94029f95f0271be8360b7c12b9e4c756bcef50aa` plus this planning-only commit if the planning documents were committed before execution. The source worktree must be clean. If the remote branch already exists unexpectedly, stop and report it; do not overwrite it.

- [ ] **Step 2: Create the isolated worktree**

Create `E:\CODEX\VIBE CODING\codex-remote\.worktrees\feat-windows-host` on new branch `feat/windows-host`. Verify branch, HEAD, worktree path and clean status before installing anything.

- [ ] **Step 3: Add exact dependencies without changing the web stack**

Pin these Host-only dependencies:

```text
dependencies:
  @openai/codex 0.149.0
  class-variance-authority 0.7.1
  clsx 2.1.1
  lucide-react 1.33.0
  react 19.2.8
  react-dom 19.2.8
  tailwind-merge 3.6.0
  tailwindcss 4.3.3
  zod 3.25.76

devDependencies:
  @tailwindcss/vite 4.3.3
  electron 44.0.0
  electron-builder 26.15.3
  vite 8.2.2
  @vitejs/plugin-react 6.1.0
  @testing-library/jest-dom 7.0.1
  @testing-library/react 16.3.2
  @testing-library/user-event 14.6.6
  @types/react 19.2.11
  @types/react-dom 19.2.3
  jsdom 30.0.1
```

Do not add `electron-updater`, a separate backend, another state library or a second UI component system. Run `npm.cmd install` once and inspect the lockfile for unrelated upgrades.

- [ ] **Step 4: Write failing build-contract tests**

Add a small source-level test that requires:

- `apps/host` package `main` points to compiled Electron main;
- scripts exist for `dev`, `build`, `typecheck`, `test:e2e`, and `package:win`;
- renderer build outputs to `dist/renderer`;
- desktop/preload code compiles independently from the existing Host core;
- the package does not contain `electron-updater`.

- [ ] **Step 5: Add the minimum Electron/Vite skeleton**

Keep the existing `apps/host/tsconfig.json` for the reusable Host core. Add separate configs for desktop main/preload and renderer. The root Host build order is:

```text
protocol build → Host core tsc → desktop tsc → Vite renderer build
```

The initial Electron entry must request a single-instance lock, create no remote URL, and quit cleanly. The renderer initially shows only “Codex Remote Host 正在准备”。

- [ ] **Step 6: Run focused validation**

```powershell
npm.cmd run typecheck --workspace @codex-remote/host
npm.cmd run build --workspace @codex-remote/host
npm.cmd exec -- vitest run apps/host/src/desktop
git diff --check
```

- [ ] **Step 7: Commit the build skeleton**

```powershell
git add apps/host package.json package-lock.json docs/superpowers/plans
git commit -m "build(windows): scaffold Electron Host"
```

### Task 2: Implement the local protocol, secure window, IPC boundary, and tray

**Files:**

- Create: `apps/host/src/desktop/app-protocol.ts`
- Create: `apps/host/src/desktop/app-protocol.test.ts`
- Create: `apps/host/src/desktop/window-manager.ts`
- Create: `apps/host/src/desktop/window-manager.test.ts`
- Create: `apps/host/src/desktop/contract.ts`
- Create: `apps/host/src/desktop/contract.test.ts`
- Create: `apps/host/src/desktop/ipc-controller.ts`
- Create: `apps/host/src/desktop/ipc-controller.test.ts`
- Modify: `apps/host/src/desktop/preload.ts`
- Create: `apps/host/src/desktop/tray-controller.ts`
- Create: `apps/host/src/desktop/tray-controller.test.ts`
- Create: `apps/host/src/desktop/login-item.ts`
- Create: `apps/host/src/desktop/login-item.test.ts`
- Modify: `apps/host/src/desktop/main.ts`

- [ ] **Step 1: Write failing local-protocol tests**

Require `app://host/index.html` and known static assets to resolve only inside `dist/renderer`. Reject traversal, encoded traversal, unknown hosts, methods other than GET/HEAD, and paths outside the renderer root. Do not fall back to `file://`.

- [ ] **Step 2: Implement the read-only local protocol**

Register the scheme before app ready as secure, standard, CORS-disabled local content. Canonicalize every resolved asset and verify it remains under the renderer root. Missing route paths return the bundled `index.html`; missing files return 404.

- [ ] **Step 3: Write failing BrowserWindow security tests**

Assert these exact preferences:

```ts
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  preload: trustedPreloadPath,
}
```

Also require navigation outside `app://host` to be denied, `window.open` to be denied, the menu bar to be hidden, and no devtools in packaged production by default.

- [ ] **Step 4: Implement window lifecycle**

Create one window, restore it on tray click or second-instance, and hide instead of quitting on close. Retain explicit main references. Never pass secrets through query strings, URL fragments or renderer initialization props.

- [ ] **Step 5: Define and test the exact IPC contract**

Start with these renderer methods:

```ts
getDesktopState(): Promise<DesktopState>
requestOtp(input: { email: string }): Promise<ActionResult>
verifyOtp(input: { email: string; token: string }): Promise<ActionResult>
signOut(): Promise<ActionResult>
chooseWorkspace(): Promise<ActionResult>
removeWorkspace(input: { workspaceId: string }): Promise<ActionResult>
createPairingCode(): Promise<ActionResult>
startHost(): Promise<ActionResult>
stopHost(): Promise<ActionResult>
runDoctor(): Promise<ActionResult>
setOpenAtLogin(input: { enabled: boolean }): Promise<ActionResult>
openLogFolder(): Promise<ActionResult>
beginDataReset(): Promise<{ phrase: string }>
confirmDataReset(input: { phrase: string }): Promise<ActionResult>
subscribeDesktopState(handler: (state: DesktopState) => void): () => void
```

Every input and output uses strict Zod Schema. `DesktopState` contains only UI-safe state, never Session, private/public JWK, access token, refresh token, Supabase row payload or raw Error.

- [ ] **Step 6: Implement sender validation and preload bridge**

The IPC controller accepts calls only from the current management window whose committed URL uses `app://host`. Reject destroyed frames and unexpected origins. Preload exposes frozen wrappers, not raw channels or `ipcRenderer`. Subscription cleanup removes only its own listener.

- [ ] **Step 7: Implement tray and current-user startup wrapper**

Retain the Tray reference and rebuild the menu from `DesktopState`. Use `app.setLoginItemSettings()` with `process.execPath` and `--hidden`; verify using exactly the same path and args. Do not use the removed `openAsHidden` option and do not write the Registry directly.

- [ ] **Step 8: Verify and commit**

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/app-protocol.test.ts apps/host/src/desktop/window-manager.test.ts apps/host/src/desktop/contract.test.ts apps/host/src/desktop/ipc-controller.test.ts apps/host/src/desktop/tray-controller.test.ts apps/host/src/desktop/login-item.test.ts
npm.cmd run typecheck --workspace @codex-remote/host
npm.cmd run lint
npm.cmd run build --workspace @codex-remote/host
```

Commit:

```powershell
git add apps/host/src/desktop
git commit -m "feat(windows): add secure desktop shell"
```

### Task 3: Add DPAPI credentials, atomic config, and explicit data reset

**Files:**

- Create: `apps/host/src/desktop/credential-store.ts`
- Create: `apps/host/src/desktop/credential-store.test.ts`
- Create: `apps/host/src/desktop/config-store.ts`
- Create: `apps/host/src/desktop/config-store.test.ts`
- Create: `apps/host/src/desktop/data-reset.ts`
- Create: `apps/host/src/desktop/data-reset.test.ts`
- Modify: `apps/host/src/desktop/contract.ts`
- Modify: `apps/host/src/desktop/ipc-controller.ts`

- [ ] **Step 1: Write failing credential-store tests**

Use an injected `SafeStoragePort` and filesystem port. Cover first write/read, update, corrupted ciphertext, unavailable encryption, key rotation, invalid decrypted Schema, and missing file. Assert plaintext tokens and private JWK never appear in filesystem writes or error strings.

- [ ] **Step 2: Implement the fail-closed credential store**

Use a versioned strict payload and Electron 44 async encryption/decryption. Write the encrypted bytes atomically to `credentials.v1.bin`. If safe storage is unavailable, return a Chinese diagnostic code and do not create a plaintext fallback. Zero or release temporary buffers where practical and never log decrypted data.

- [ ] **Step 3: Write failing config-store tests**

Cover version validation, atomic replace, interrupted temp write, duplicate workspace ID/path, malformed path, unsupported future version and preservation of the last valid file. The config DTO must not accept tokens, secret keys, pairing codes, prompt text or model output.

- [ ] **Step 4: Implement versioned local config**

Use `config.v1.json` below the exact injected user-data directory. Write to a unique file in the same directory, fsync where supported, then rename. Do not silently migrate an unknown future version.

- [ ] **Step 5: Write and implement the two-step reset**

`beginDataReset()` creates a short-lived random Chinese confirmation phrase held only in memory. `confirmDataReset()` rejects wrong or expired phrases. Before deletion, resolve every target and verify it is a direct child of the configured user-data directory. Delete only config, credentials, local thread/idempotency state and Host logs. Never recurse into a workspace or Codex home.

- [ ] **Step 6: Run 5A full gate**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
git diff --check
git status --short --branch
```

- [ ] **Step 7: Inspect secrets and desktop bundle**

Search tracked files and `apps/host/dist` for `access_token`, `refresh_token`, private JWK `"d"`, JWT-like fixtures, personal paths, `.env`, `service_role`, `sb_secret_` and pairing codes. Schema field names may exist in main-process source; real values must not exist anywhere, and no secret-related field may occur in renderer output.

- [ ] **Step 8: Push checkpoint 5A and stop**

Commit remaining 5A-only files if needed:

```powershell
git commit -m "feat(windows): protect local Host credentials"
git push -u origin feat/windows-host
```

Report the seven delivery fields, including branch, commits, push result and GitHub branch link. Wait for user acceptance; do not begin 5B.

---

## Checkpoint 5B: Product Host runtime

### Task 4: Implement Electron OTP auth and Host registration

**Files:**

- Create: `apps/host/src/desktop/public-runtime-config.ts`
- Create: `apps/host/src/desktop/public-runtime-config.test.ts`
- Create: `apps/host/src/desktop/supabase-auth-controller.ts`
- Create: `apps/host/src/desktop/supabase-auth-controller.test.ts`
- Create: `apps/host/src/desktop/host-registry.ts`
- Create: `apps/host/src/desktop/host-registry.test.ts`
- Create: `apps/host/src/desktop/host-key-manager.ts`
- Create: `apps/host/src/desktop/host-key-manager.test.ts`
- Modify: `apps/host/src/desktop/ipc-controller.ts`
- Modify: `apps/host/src/renderer/*`

- [ ] **Step 1: Define public runtime configuration**

Accept only HTTPS Supabase URL, publishable/anon key, HTTPS web origin and protocol version. Development may read process variables; packaged builds read a generated public JSON resource. Reject `service_role`, secret keys, VAPID private key, database URL and non-loopback HTTP. Never bundle private deployment values.

- [ ] **Step 2: Write failing auth tests**

Cover OTP request, six-digit token verification, refresh-token restoration, auth state refresh, revoked Session, sign-out and same-account restoration. Assert the Supabase client uses custom persistence backed by `CredentialStore`, not Local Storage.

- [ ] **Step 3: Implement Electron Auth controller**

Renderer sends only validated email and OTP to main. Main calls Supabase Auth, stores the resulting Session in DPAPI storage, refreshes before expiry and publishes only `{ signedIn, maskedEmail }`. Raw Supabase errors are mapped to concise Chinese error codes.

- [ ] **Step 4: Write failing Host key/registry tests**

Cover first P-256 key generation, reuse, missing private key with existing Host, same-owner Host restore, revoked Host, protocol mismatch and different-account collision. Private JWK stays in credentials; public key and Host ID may stay in config.

- [ ] **Step 5: Implement unique Host registration**

After login, query the owner’s active Host. Reuse it only when local key identity matches; otherwise require explicit local reset. First registration inserts Host name, public key, app version and protocol version. Never create duplicate active Hosts automatically.

- [ ] **Step 6: Build the login and overview screens**

Use a simple local React screen: email, OTP, sign-out, masked account, Host registration state and safe error message. No renderer network calls and no token display. Add loading locks and accessible labels.

- [ ] **Step 7: Verify and commit**

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/public-runtime-config.test.ts apps/host/src/desktop/supabase-auth-controller.test.ts apps/host/src/desktop/host-key-manager.test.ts apps/host/src/desktop/host-registry.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Commit:

```powershell
git add apps/host
git commit -m "feat(windows): add Host login and registration"
```

### Task 5: Add authorized directories and pairing

**Files:**

- Create: `apps/host/src/desktop/workspace-authorizer.ts`
- Create: `apps/host/src/desktop/workspace-authorizer.test.ts`
- Create: `apps/host/src/desktop/pairing-controller.ts`
- Create: `apps/host/src/desktop/pairing-controller.test.ts`
- Modify: `apps/host/src/desktop/ipc-controller.ts`
- Create/Modify: `apps/host/src/renderer/workspaces-screen.tsx`
- Create/Modify: `apps/host/src/renderer/pairing-screen.tsx`

- [ ] **Step 1: Write failing directory authorization tests**

Cover native picker cancellation, nonexistent path, file path, drive root, duplicate real path, symlink/junction resolving outside the chosen directory, stable UUID, renamed display label, removed directory, and active-Turn removal rejection. Test Windows case-insensitive duplicates.

- [ ] **Step 2: Implement local-only directory authorization**

Call `dialog.showOpenDialog({ properties: ["openDirectory"] })` in main. Canonicalize with `realpath`, reject drive roots and duplicates, then store `{ id, name, path }` locally. Only the name and ID enter Host snapshots; paths are never included in transport events or renderer logs.

- [ ] **Step 3: Write and implement pairing tests**

Require a signed-in active Host and runtime-ready transport. Call existing `SupabaseTransport.createPairingRequest()`, expose only code and expiry to the local renderer, prevent concurrent requests, expire locally after five minutes, and allow manual regeneration. Pairing codes must never enter logs or config.

- [ ] **Step 4: Build project and pairing screens**

Projects show local path because this is the trusted Windows-only UI, but copy/diagnostic actions use only workspace ID/name. Pairing uses a large 6-digit code, visible expiry countdown and clear phone instructions. Disable controls when signed out or Host identity is invalid.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/workspace-authorizer.test.ts apps/host/src/desktop/pairing-controller.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Commit:

```powershell
git add apps/host
git commit -m "feat(windows): add directory authorization and pairing"
```

### Task 6: Compose the Host runtime, recovery, Doctor, and redacted logs

**Files:**

- Create: `apps/host/src/desktop/codex-cli-resolver.ts`
- Create: `apps/host/src/desktop/codex-cli-resolver.test.ts`
- Create: `apps/host/src/desktop/host-runtime-controller.ts`
- Create: `apps/host/src/desktop/host-runtime-controller.test.ts`
- Create: `apps/host/src/desktop/doctor.ts`
- Create: `apps/host/src/desktop/doctor.test.ts`
- Create: `apps/host/src/desktop/redacted-logger.ts`
- Create: `apps/host/src/desktop/redacted-logger.test.ts`
- Modify: `apps/host/src/codex-process.ts`
- Modify: `apps/host/src/webhook-notification-sink.ts`
- Modify: `apps/host/src/desktop/main.ts`
- Modify: `apps/host/src/desktop/tray-controller.ts`
- Modify: `apps/host/src/renderer/*`

- [ ] **Step 1: Test and implement the packaged Codex CLI resolver**

Resolve the pinned `@openai/codex@0.149.0` Windows x64 native binary from the installed/package resource location. Verify file existence and version. Reject WindowsApps aliases and do not silently fall back to an unknown global binary. Spawn it with the current user environment so existing Codex auth and proxy variables continue unchanged.

- [ ] **Step 2: Write failing runtime state-machine tests**

Cover missing login, no workspace, unavailable credentials, Codex initialization failure, successful start order, duplicate start, graceful stop order, token refresh, transport reconnect, system resume, command-runner failure and App Server exit. Use fake ports; never open real Supabase or spawn real Codex in unit tests.

Require retry delays of 1 s, 2 s and 4 s, then permanent `error`. A manual start after Doctor success resets the retry counter. Network reconnect does not consume App Server retry attempts.

- [ ] **Step 3: Implement `HostRuntimeController`**

Compose the existing core without duplicating protocol logic. Recreate the webhook notification sink when the access token changes. Connect transport only after App Server initialization, broadcast an authoritative snapshot, then consume queued commands. Shutdown in reverse order and make every close idempotent.

- [ ] **Step 4: Write failing redaction tests**

Feed nested errors containing Windows paths, email, bearer token, JWT, secret key, private JWK, pairing code, command, prompt, output and ciphertext. Assert the emitted JSONL contains only the approved whitelist. Cover 2 MiB rotation, five-file limit, seven-day cleanup and failure to write logs without crashing Host execution.

- [ ] **Step 5: Implement whitelist logging**

Callers provide structured event IDs and safe scalar identifiers; the logger never serializes arbitrary Error objects. Map errors to stable error codes at their boundary. All local file targets are direct children of the validated logs directory.

- [ ] **Step 6: Write failing Doctor tests**

Cover OS/arch, safeStorage, Session, Host key, Supabase connection, workspaces, Codex version/app-server handshake, startup setting, notification config and latest safe error. A failed item must not mutate settings or auto-install software. Copied summary must exclude local paths and account email.

- [ ] **Step 7: Implement Doctor and finish the desktop screens**

Doctor returns `pass | warning | fail` items with Chinese names and remediation text. Add start/stop controls, runtime status, last observed time, Doctor results, open-log-folder action and settings. Stop requires confirmation only when a remote Turn is active; quitting the app always performs graceful stop.

- [ ] **Step 8: Run 5B full gate and real local Codex smoke**

First run all simulated tests, then run one real local smoke against the packaged/pinned CLI:

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

The real smoke may initialize `codex app-server`, list an authorized test workspace and stop. It must not create a remote Turn, modify user projects, change proxy settings or print model history.

- [ ] **Step 9: Inspect, commit, push, and stop at 5B**

```powershell
git status --short --branch
git diff --stat origin/feat/windows-host...HEAD
git commit -m "feat(windows): run the encrypted Host desktop"
git push origin feat/windows-host
```

Report the seven delivery fields and wait for user acceptance. Do not begin packaging.

---

## Checkpoint 5C: Windows installer and desktop acceptance

### Task 7: Package the current-user NSIS installer

**Files:**

- Create: `apps/host/electron-builder.yml`
- Create: `apps/host/scripts/prepare-codex-resource.mjs`
- Create: `apps/host/scripts/verify-package.mjs`
- Create: `apps/host/assets/icon.ico`
- Create: `apps/host/assets/tray.ico`
- Modify: `apps/host/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing package-policy tests**

Require:

```yaml
appId: com.codexremote.host
productName: Codex Remote Host
win:
  target: nsis
  arch: x64
  requestedExecutionLevel: asInvoker
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
```

Also require renderer/main/preload, public runtime config and the pinned Codex x64 binary to be present; source maps, tests, `.env`, service-role values, Git metadata and developer logs must be absent.

- [ ] **Step 2: Prepare app and tray icons**

Reuse the accepted grayscale PWA icon as the source; generate ICO sizes suitable for Windows and a monochrome/high-contrast tray variant. Inspect both visually and verify embedded dimensions. Do not redesign product branding in this module.

- [ ] **Step 3: Configure electron-builder**

Package only required files and unpack the Codex native binary from ASAR. Set `artifactName` to include product version, Windows and x64. Do not configure auto-update, administrator execution, Windows service, firewall rules or automatic user-data deletion.

- [ ] **Step 4: Build and verify the unpacked application**

Run the directory build first. Launch it once with a temporary user-data directory and public loopback test config. Verify single instance, local protocol, tray, hidden startup arg, no external navigation and clean exit. Then inspect package contents and hashes with `verify-package.mjs`.

- [ ] **Step 5: Build the NSIS installer**

Run `npm.cmd run package:win --workspace @codex-remote/host` once. If signing is not configured, accept only the expected unsigned warning and record it. Do not install or uninstall automatically in this step.

### Task 8: Add Electron UI acceptance and installation handoff

**Files:**

- Create: `apps/host/playwright.config.ts`
- Create: `apps/host/e2e/desktop-shell.spec.ts`
- Create: `apps/host/e2e/login-pairing.spec.ts`
- Create: `apps/host/e2e/runtime-doctor.spec.ts`
- Create: `apps/host/e2e/data-reset.spec.ts`
- Create: `apps/host/e2e/helpers/fake-electron-ports.ts`
- Create: `docs/windows-host-user-guide.md`
- Create: `docs/acceptance/windows-host-real-device.md`
- Modify: `apps/host/README.md`

- [ ] **Step 1: Add deterministic Electron test mode**

Inject fake main-process ports only when an explicit test flag and temporary user-data path are both present. Production builds must fail to enable fake auth/Host ports. Do not include service-role keys or decrypted content in fixtures.

- [ ] **Step 2: Test the complete local desktop flow**

Automate: first launch, OTP UI, signed-in overview, native directory picker stub, project list, pairing code, Host start/stop, tray reopen, login startup toggle, Doctor, sign-out and second-confirmation reset. Assert renderer has no Node globals and cannot navigate outside `app://host`.

- [ ] **Step 3: Test recovery and error presentation**

Simulate offline/online, Session refresh, revoked pairing, Codex crash three times, app resume and packaged public-config failure. Every screen must show a concise Chinese result and never raw Error, path, token or decrypted remote content.

- [ ] **Step 4: Write the beginner guide**

Document installation, SmartScreen warning for unsigned private builds, email login, adding a project, phone pairing, tray behavior, login startup, VPN-off expectations, Windows must remain on and online, Doctor, default uninstall retention and full reset. Explicitly state that the app does not change sleep or proxy settings.

- [ ] **Step 5: Perform manual installer acceptance with user awareness**

Installing/uninstalling changes the current Windows user profile. Before doing it, report the exact installer path, version and retention behavior. After user approval, install as current user, launch, verify tray/start menu, close/reopen, then uninstall and confirm config is retained. Reinstall and verify restoration. Full-reset behavior is tested only against a temporary test profile unless the user explicitly authorizes clearing their real Host data.

- [ ] **Step 6: Run 5C full gate**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npm.cmd run test:e2e --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host
npm.cmd audit --omit=dev
git diff --check
git status --short --branch
```

- [ ] **Step 7: Inspect final tracked diff and installer contents**

Confirm there are no `.env` files, Supabase secret/service-role values, VAPID private key, credentials, private JWK, emails, personal Windows paths, pairing codes, prompts, outputs or test user data. Confirm installer runs `asInvoker`, contains no service definition, and makes no firewall/power/proxy changes.

- [ ] **Step 8: Commit and push checkpoint 5C**

The final packaging commit required by the MVP is:

```powershell
git add apps/host docs package.json package-lock.json
git commit -m "feat(windows): package remote host"
git push origin feat/windows-host
```

Report installer filename and SHA-256 in addition to the seven delivery fields. Stop and wait; do not deploy Preview or change Hosted Supabase/Vercel.

---

## Checkpoint 5D: Authorized cloud and real-device acceptance

### Task 9: Prepare the external-change audit without writing anything

**Files:**

- Modify only after successful acceptance: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Perform read-only environment discovery**

Verify the intended non-production Supabase project ref/region, Vercel project/team/branch, current Preview URL, current migration history, required public keys, VAPID presence, redirect URLs and Git HEAD. Do not reveal any value; report only present/missing and safe identifiers.

- [ ] **Step 2: Compare migration and deployment scope**

Run a linked Supabase dry-run and Vercel Preview inspection. Any project-ref mismatch, unexpected migration, Production target, branch mismatch or missing secret is a stop gate. Do not repair, retry or infer approval.

- [ ] **Step 3: Request separate authorization**

List the exact intended writes:

1. Supabase migration/config application, if needed;
2. Vercel Preview environment variables, including VAPID secrets;
3. Vercel Preview deployment from `feat/windows-host` or the approved integration branch;
4. test records and push subscriptions created by the real phone flow.

Wait for explicit approval for each stage.

### Task 10: Apply approved non-production changes once

- [ ] **Step 1: Apply only the approved Supabase scope once**

After authorization, apply the reviewed migration/config command once. If it fails or differs from dry-run, stop immediately. Perform read-only RLS, Realtime and RPC verification; do not manually patch Production.

- [ ] **Step 2: Configure only approved Preview environment**

Add public Supabase values and server-only notification/VAPID secrets to Preview scope only. Confirm no server secret is exposed in the browser or Electron renderer bundle.

- [ ] **Step 3: Deploy Preview once**

Deploy the approved branch to Preview, not Production. Perform unauthenticated 401/redirect smoke and authenticated login smoke. A failed deployment is reported once; no automatic Production promotion or PR.

### Task 11: Execute Android/Windows real-device acceptance

- [ ] **Step 1: Establish the physical test setup**

Use Windows 10/11 x64 with the 5C installer, modern Android Chrome, phone mobile data, Wi-Fi off and VPN off. Confirm Windows remains on, online and in the current user session. Do not change its sleep or proxy settings.

- [ ] **Step 2: Run the complete product flow**

Verify:

1. Electron OTP login and Host registration;
2. directory authorization and phone pairing;
3. Host online state from mobile data;
4. task list/history, new and resumed tasks;
5. streaming output and steer/append;
6. allowed approval decisions and stale approval rejection;
7. stop confirmation and interrupted state;
8. generic approval/completed/failed lock-screen Push with no sensitive text;
9. notification click opens the correct Host and refreshes authority;
10. external Codex Desktop running task stays read-only.

- [ ] **Step 3: Run recovery acceptance**

Switch mobile data/Wi-Fi, close and reopen PWA, disconnect/reconnect Windows network, restart Host, and terminate App Server. Verify snapshot restoration, no duplicate command, expired message rejection and no restart loop after the third App Server failure.

- [ ] **Step 4: Measure latency**

Run at least 20 control-message rounds from Shenzhen mobile data with VPN off. Exclude model inference time. Record P50, P95, max, disconnect recovery and failed rounds. Pass target: P50 ≤ 1.5 s, P95 ≤ 3 s, normally reconnect within 5 s.

If Supabase optimization still misses P95 for two consecutive rounds, stop feature expansion and write a separate Cloudflare Transport plan. Do not change transport architecture inside this module.

- [ ] **Step 5: Record evidence without sensitive content**

Update the acceptance document with versions, safe deployment IDs, installer SHA-256, pass/fail matrix, timings and generic screenshots. Redact email, paths, task content, commands, code, tokens, keys, notification endpoints and pairing codes.

- [ ] **Step 6: Run final repository gate**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:db
npm.cmd run build
npm.cmd run test:e2e --workspace @codex-remote/web
npm.cmd run test:e2e --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host
npm.cmd audit --omit=dev
git diff --check
git status --short --branch
```

- [ ] **Step 7: Commit evidence, push, and stop at final acceptance**

If only the acceptance record changed:

```powershell
git add docs/acceptance/windows-host-real-device.md
git commit -m "test(windows): record real device acceptance"
git push origin feat/windows-host
```

Do not create a PR, merge or push `main`. Report all seven delivery fields plus external project/Preview safe identifiers, installer hash, real-device result and latency statistics. Wait for the user’s final decision.

## Checkpoint Report Template

At every 5A–5D stop, report:

1. 本阶段完成的功能；
2. 修改或新增的文件；
3. 数据库、API 或配置变更；
4. 已完成的测试和验证；
5. 当前已知问题或需要注意的地方；
6. 可以继续开发的下一个阶段；
7. Git 分支、Commit ID、提交信息、推送结果、主要文件和 GitHub 分支链接。

## Self-Review Checklist

- 架构：远程 PWA 不进入 Electron；main/preload/renderer 权限边界明确。
- 凭据：Session 与 Host 私钥使用 DPAPI；失败时没有明文降级。
- 路径：只有本机管理界面看路径；手机和云端只看 `workspaceId`。
- 生命周期：当前用户托盘、单实例、隐藏启动、正常停止和三次重启上限均有测试。
- 系统影响：无管理员服务、入站端口、电源、防火墙、代理或自动更新改动。
- 卸载：默认保留配置；完全清除二次确认且只删除已验证的 userData 子项。
- 打包：x64 NSIS、独立 Codex CLI、renderer 无 secret、安装器内容可审计。
- 外部边界：Supabase、Vercel、VAPID、Preview 和真机均有独立授权门。
- 验收：桌面自动化、安装包、真实手机、锁屏通知、恢复和 20 轮延迟均映射到任务。
- Git：只推 `feat/windows-host`，无 main、PR 或 Production 操作。
