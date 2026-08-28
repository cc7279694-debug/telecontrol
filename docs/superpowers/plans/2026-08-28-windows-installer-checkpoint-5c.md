# Windows Installer Checkpoint 5C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for behavior changes, `superpowers:systematic-debugging` for failures, and `superpowers:verification-before-completion` before the checkpoint report. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已经验收的 Windows Host 运行时打包成当前用户安装的 Windows 10/11 x64 NSIS 安装包，并完成可重复的打包内容、Electron 桌面流程和卸载保留验收。

**Architecture:** `electron-builder` 只打包编译后的 Electron main/preload/renderer 和生产依赖；固定版本 Codex Windows x64 资源、公开运行配置位于 `resources`，不进入 ASAR。自动化分为静态包审计、未安装程序烟雾和开发态 Electron UI 测试；测试夹具必须在打包应用中失败关闭，不能形成生产认证后门。

**Tech Stack:** Node.js 24、TypeScript 5.9.3 strict、Electron 44.0.0、electron-builder 26.15.3、React 19.2.8、Vite 8.2.2、Vitest 3.2.7、Playwright 1.62.1、`@electron/asar` 3.4.1、官方 Codex CLI 0.149.0。

**Spec:** `docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md`

## Global Constraints

- 本计划只实现 Checkpoint 5C；不修改 Hosted Supabase、Vercel、VAPID、Preview、Production 或手机真实数据。
- Windows 应用只在当前用户会话运行，安装器使用 `asInvoker` 和 `perMachine: false`；不创建管理员服务、入站端口、防火墙规则或计划任务。
- 不修改睡眠、休眠、电源计划、代理、VPN、Codex 登录或用户项目。
- 产品名固定为 `Codex Remote Host`，`appId` 固定为 `com.codexremote.host`，版本沿用 `apps/host/package.json` 的 `0.1.0`。
- Codex CLI 固定为 `@openai/codex@0.149.0` 和 `@openai/codex-win32-x64@0.149.0-win32-x64`；复制完整 `vendor`，不能只复制 `codex.exe`。
- 安装包中的公开配置只能包含 Supabase URL、publishable key、Web Origin 和协议版本 1；禁止 service-role、数据库密码、VAPID 私钥、Token、Session、Host 私钥和 `.env`。
- 默认卸载保留 Electron `userData`；完全清除仍只允许在应用内二次确认，不由 NSIS 自动执行。
- MVP 不实现自动更新和代码签名。未签名安装包必须记录 SmartScreen 限制和 SHA-256，不伪装成正式公开发行版。
- Electron UI 测试模式只允许 `app.isPackaged === false` 且用户数据目录位于系统临时目录；打包应用收到测试开关必须退出并报告安全错误。
- 安装、卸载、开机启动验证会改变当前 Windows 用户状态；生成安装包后必须暂停，得到用户明确授权才执行人工安装验收。
- 所有提交只推送 `feat/windows-host`；不创建 PR，不合并或推送 `main`。

## File Map

### Package policy and resources

- `.prettierrc.json`：统一采用 `endOfLine: auto`，避免 Windows CRLF 触发全仓无意义改写。
- `.prettierignore`：忽略 `.superpowers/` 生成的执行进度文件；产品文档仍参与格式检查。
- `apps/host/electron-builder.yml`：唯一 electron-builder 配置来源。
- `apps/host/scripts/prepare-codex-resource.ts`：验证并复制固定 Codex Windows 资源。
- `apps/host/scripts/verify-package.ts`：审计 app.asar、extraResources、PE 架构、禁入文件和安装包哈希。
- `apps/host/src/desktop/package-policy.test.ts`：锁定 NSIS、资源、脚本和安全策略。
- `apps/host/scripts/prepare-codex-resource.test.ts`：资源复制与路径保护测试。
- `apps/host/scripts/verify-package.test.ts`：包审计规则测试。

### Electron acceptance

- `apps/host/src/desktop/e2e-mode.ts`：只解析并验证开发态 E2E 开关，不包含生产凭据。
- `apps/host/src/desktop/e2e-mode.test.ts`：验证打包模式拒绝、临时目录约束和安全默认值。
- `apps/host/src/desktop/main.ts`：在安全门通过后选择惰性、无网络的测试夹具。
- `apps/host/playwright.config.ts`：串行 Electron 测试配置。
- `apps/host/e2e/desktop-shell.spec.ts`：本地协议、窗口、托盘、隐藏启动和导航边界。
- `apps/host/e2e/host-flow.spec.ts`：登录界面、目录、配对、Host 状态、Doctor 和数据清理 UI。
- `apps/host/e2e/recovery.spec.ts`：断网、恢复、Codex 崩溃和错误文案。
- `apps/host/e2e/fixtures.ts`：只包含不连接网络、不读真实磁盘的安全假状态。

### Handoff and evidence

- `docs/windows-host-user-guide.md`：小白安装、托盘、配对和排错说明。
- `docs/acceptance/windows-host-real-device.md`：5C 人工安装结果和未来 5D 真机记录模板。
- `apps/host/README.md`：开发、打包、验证命令和产物位置。

---

### Task 1: Lock the package policy and restore a deterministic repository gate

**Files:**

- Create: `.prettierrc.json`
- Modify: `.prettierignore`
- Modify: `apps/host/index.html`
- Modify: `package.json`
- Modify: `apps/host/package.json`
- Create: `apps/host/src/desktop/package-policy.test.ts`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: existing Host entry `dist/desktop/main.js`, renderer `dist/renderer`, `package:win`, Electron 44.0.0 and electron-builder 26.15.3.
- Produces: scripts `package:prepare`, `package:dir`, `package:win`, `package:verify`, and a tested `electron-builder.yml` contract used by Tasks 2–5.

- [ ] **Step 1: Write the failing package-policy test**

Create `package-policy.test.ts` that reads `electron-builder.yml` and both package files. The assertions must include these exact policy values and scripts:

```ts
expect(builderConfig).toContain("appId: com.codexremote.host");
expect(builderConfig).toContain("productName: Codex Remote Host");
expect(builderConfig).toContain("target: nsis");
expect(builderConfig).toContain("- x64");
expect(builderConfig).toContain("requestedExecutionLevel: asInvoker");
expect(builderConfig).toContain("oneClick: false");
expect(builderConfig).toContain("perMachine: false");
expect(builderConfig).toContain("allowToChangeInstallationDirectory: true");
expect(builderConfig).toContain("deleteAppDataOnUninstall: false");
expect(hostPackage.scripts).toMatchObject({
  "package:prepare": expect.any(String),
  "package:dir": expect.any(String),
  "package:win": expect.any(String),
  "package:verify": expect.any(String),
});
expect(hostPackage.devDependencies).not.toHaveProperty("electron-updater");
```

Also assert that `package:win` runs build, public-config generation and resource preparation before electron-builder, and that the root package exposes `package:host` and `verify:host-package` without changing `test:e2e` for the web app.

- [ ] **Step 2: Run the package-policy test and verify RED**

Run:

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/package-policy.test.ts
```

Expected: FAIL because `electron-builder.yml` and the new scripts do not exist.

- [ ] **Step 3: Add the minimal package scripts and dependencies**

Pin these Host dev dependencies explicitly, even if npm currently hoists them through another workspace:

```json
{
  "@electron/asar": "3.4.1",
  "@playwright/test": "1.62.1",
  "playwright": "1.62.1"
}
```

Use these scripts:

```json
{
  "package:prepare": "tsx scripts/prepare-codex-resource.ts",
  "package:dir": "npm run build && npm run generate-public-runtime && npm run package:prepare && electron-builder --config electron-builder.yml --dir --win --x64",
  "package:win": "npm run build && npm run generate-public-runtime && npm run package:prepare && electron-builder --config electron-builder.yml --win nsis --x64",
  "package:verify": "tsx scripts/verify-package.ts",
  "test:e2e": "playwright test --config playwright.config.ts"
}
```

Root scripts:

```json
{
  "package:host": "npm run package:win --workspace @codex-remote/host",
  "verify:host-package": "npm run package:verify --workspace @codex-remote/host"
}
```

- [ ] **Step 4: Repair formatting without rewriting the repository**

Create:

```json
{
  "endOfLine": "auto"
}
```

Append `.superpowers/` to `.prettierignore`, then format only `apps/host/index.html`, root `package.json`, `apps/host/package.json`, `.prettierrc.json`, `.prettierignore` and the new policy test. Do not run a repository-wide write.

- [ ] **Step 5: Verify Task 1 and commit**

Run:

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/package-policy.test.ts apps/host/src/desktop/build-contract.test.ts
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
```

Commit:

```powershell
git add .prettierrc.json .prettierignore package.json package-lock.json apps/host
git commit -m "build(windows): define installer policy"
```

### Task 2: Stage the pinned Codex resources and configure current-user NSIS

**Files:**

- Create: `apps/host/scripts/prepare-codex-resource.ts`
- Create: `apps/host/scripts/prepare-codex-resource.test.ts`
- Create: `apps/host/electron-builder.yml`
- Modify: `apps/host/src/desktop/codex-cli-resolver.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `CODEX_CLI_VERSION`, `CODEX_WINDOWS_X64_PACKAGE_VERSION`, installed package roots and `apps/web/public/icons/icon-512.png`.
- Produces: `prepareCodexResource(input): Promise<PreparedCodexResource>` and ignored directory `apps/host/.package-resources/codex`, which the packaged resolver reads at `process.resourcesPath/codex`.

Define the public interface exactly:

```ts
export type PrepareCodexResourceInput = {
  platformPackageRoot: string;
  entryPackageJsonPath: string;
  allowedOutputParent: string;
  outputRoot: string;
};

export type PreparedCodexResource = {
  outputRoot: string;
  executablePath: string;
  cliVersion: "0.149.0";
  platformVersion: "0.149.0-win32-x64";
};

export async function prepareCodexResource(
  input: PrepareCodexResourceInput,
): Promise<PreparedCodexResource>;
```

- [ ] **Step 1: Write failing resource-preparation tests**

Use temporary fixture directories. Cover correct copy, missing `codex.exe`, wrong entry version, wrong platform version, missing helper executables, output outside the allowed `.package-resources` or test temp root, and copied metadata names.

The successful fixture must contain:

```text
codex/package.json                    # version 0.149.0-win32-x64
codex/codex-cli-package.json          # version 0.149.0
codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe
codex/vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe
codex/vendor/x86_64-pc-windows-msvc/codex-path/rg.exe
codex/vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe
codex/vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe
```

- [ ] **Step 2: Run the resource tests and verify RED**

```powershell
npm.cmd exec -- vitest run apps/host/scripts/prepare-codex-resource.test.ts
```

Expected: FAIL because `prepareCodexResource` does not exist.

- [ ] **Step 3: Implement guarded resource staging**

Resolve the installed package paths with `createRequire(import.meta.url)`. Validate both versions before deleting or copying anything. Require `outputRoot` to be a strict descendant of the already-resolved `allowedOutputParent`; reject equality, drive roots, workspace roots, symlink escapes and unresolved paths before any recursive replacement. The production entry passes `apps/host/.package-resources` as the allowed parent and `.package-resources/codex` as the output; tests pass their own `mkdtemp` root and a `codex` child. Copy the entire platform `vendor` directory and the two package metadata files. Never invoke `codex.exe` in this script.

- [ ] **Step 4: Add the electron-builder configuration**

Use the following policy:

```yaml
appId: com.codexremote.host
productName: Codex Remote Host
asar: true
directories:
  output: release
files:
  - dist/**/*
  - package.json
  - "!**/*.map"
  - "!**/*.test.*"
extraResources:
  - from: public-runtime.json
    to: public-runtime.json
  - from: .package-resources/codex
    to: codex
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: ../web/public/icons/icon-512.png
  requestedExecutionLevel: asInvoker
  artifactName: Codex-Remote-Host-${version}-Windows-${arch}.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  deleteAppDataOnUninstall: false
```

Remove the obsolete `build` object from `apps/host/package.json` so there is one configuration source. Add `.package-resources/` and `release/` to `.gitignore`; keep `public-runtime.json` ignored.

- [ ] **Step 5: Verify the packaged resolver contract**

Extend `codex-cli-resolver.test.ts` with a fixture matching the exact staged tree. Assert packaged mode returns `source: "packaged-resource"`, resolves the real `codex.exe`, rejects a missing helper-resource tree during preparation, and never searches WindowsApps or a global executable.

- [ ] **Step 6: Verify Task 2 and commit**

```powershell
npm.cmd exec -- vitest run apps/host/scripts/prepare-codex-resource.test.ts apps/host/src/desktop/codex-cli-resolver.test.ts apps/host/src/desktop/package-policy.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build --workspace @codex-remote/host
```

Commit:

```powershell
git add .gitignore apps/host
git commit -m "build(windows): stage pinned Codex resources"
```

### Task 3: Audit the unpacked application and NSIS artifact

**Files:**

- Create: `apps/host/scripts/verify-package.ts`
- Create: `apps/host/scripts/verify-package.test.ts`
- Create: `apps/host/scripts/smoke-unpacked-host.ts`
- Create: `apps/host/scripts/smoke-unpacked-host.test.ts`
- Modify: `apps/host/package.json`

**Interfaces:**

- Consumes: `apps/host/release/win-unpacked`, NSIS artifact, `@electron/asar`, staged Codex resources and generated `public-runtime.json`.
- Produces: `verifyPackage(input): Promise<PackageVerificationResult>` and a safe report containing only artifact filename, version, architecture, file count, signing state and SHA-256.

```ts
export type PackageVerificationInput = {
  releaseDir: string;
  expectedVersion: "0.1.0";
  requireInstaller: boolean;
};

export type PackageVerificationResult = {
  installerName: string | null;
  installerSha256: string | null;
  architecture: "x64";
  signingStatus: "unsigned" | "signed";
  checkedFileCount: number;
};
```

- [ ] **Step 1: Write failing package-verifier tests**

Create temporary fake package trees and assert rejection of:

- missing main/preload/renderer entries in `app.asar`;
- missing protocol production package;
- missing or wrong-version Codex resources;
- x86/ARM PE headers when x64 is required;
- `.env`, `service_role`, VAPID private key names, source maps, test files, `.git`, logs or credentials;
- malformed `public-runtime.json` or any key outside `supabaseUrl`, `publishableKey`, `webOrigin`, `protocolVersion`;
- unexpected installer filename or absent installer when `requireInstaller` is true.

- [ ] **Step 2: Run verifier tests and verify RED**

```powershell
npm.cmd exec -- vitest run apps/host/scripts/verify-package.test.ts
```

Expected: FAIL because `verifyPackage` does not exist.

- [ ] **Step 3: Implement package verification**

Use `@electron/asar` to list `resources/app.asar`, parse the PE machine field and require `0x8664`, recursively inspect only the resolved release directory, and hash the installer with SHA-256. Never print public keys, config values, absolute personal paths or arbitrary file contents.

- [ ] **Step 4: Add a bounded unpacked smoke process**

`smoke-unpacked-host.ts` launches `release/win-unpacked/Codex Remote Host.exe --hidden --package-smoke` with a temporary user-data directory. Add a production-safe `--package-smoke` branch in `main.ts` that performs only: app ready, packaged public-config parse, local `app://host` registration, packaged Codex resolver check, then exits within 15 seconds. It must not restore Session, register a Host, connect Supabase, spawn App Server, create login-startup state or open a project.

The smoke script must terminate the child on timeout, remove only its validated temporary directory, and return a nonzero exit code for crash, timeout or resolver/config failure.

Add the Host script at this step:

```json
{
  "package:smoke": "tsx scripts/smoke-unpacked-host.ts"
}
```

- [ ] **Step 5: Build and verify the unpacked directory**

Use explicit local-only public values without writing `.env`:

```powershell
$env:CODEX_REMOTE_SUPABASE_URL='http://127.0.0.1:54321'
$env:CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY='public-key'
$env:CODEX_REMOTE_WEB_ORIGIN='http://127.0.0.1:3000'
$env:CODEX_REMOTE_PROTOCOL_VERSION='1'
npm.cmd run package:dir --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host -- --allow-missing-installer
npm.cmd run package:smoke --workspace @codex-remote/host
```

These values are disposable loopback configuration. The resulting artifact is for 5C validation only and must not be presented as the real mobile-ready installer.

- [ ] **Step 6: Build the unsigned NSIS installer once**

Run:

```powershell
npm.cmd run package:win --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host
```

Accept only the expected unsigned/SmartScreen limitation. If electron-builder reports signing configuration, resource, architecture or installer errors, stop and debug; do not repeatedly rebuild without a root cause.

- [ ] **Step 7: Verify Task 3 and commit**

```powershell
npm.cmd exec -- vitest run apps/host/scripts/verify-package.test.ts apps/host/scripts/smoke-unpacked-host.test.ts
npm.cmd run typecheck
npm.cmd run lint
git diff --check
```

Commit:

```powershell
git add apps/host
git commit -m "test(windows): verify packaged host artifacts"
```

### Task 4: Add safe Electron desktop acceptance without a production backdoor

**Files:**

- Create: `apps/host/src/desktop/e2e-mode.ts`
- Create: `apps/host/src/desktop/e2e-mode.test.ts`
- Modify: `apps/host/src/desktop/main.ts`
- Create: `apps/host/playwright.config.ts`
- Create: `apps/host/e2e/fixtures.ts`
- Create: `apps/host/e2e/desktop-shell.spec.ts`
- Create: `apps/host/e2e/host-flow.spec.ts`
- Create: `apps/host/e2e/recovery.spec.ts`

**Interfaces:**

- Consumes: production IPC DTOs, preload, renderer, window manager and tray behavior.
- Produces: `resolveE2eMode(input): E2eMode | null`, where E2E services are inert, deterministic and unavailable in packaged builds.

```ts
export type E2eMode = {
  scenario: "signed-out" | "ready" | "offline" | "codex-failed";
  userDataDir: string;
};

export type E2eControl = {
  setScenario(scenario: E2eMode["scenario"]): void;
  getActionCalls(): readonly string[];
};

export function resolveE2eMode(input: {
  isPackaged: boolean;
  source: NodeJS.ProcessEnv;
  tempDir: string;
}): E2eMode | null;
```

- [ ] **Step 1: Write failing E2E-mode security tests**

Cover no flag, packaged app with a flag, missing user-data path, relative path, path outside `os.tmpdir()`, unknown scenario, and valid temporary fixture. Packaged mode with any `CODEX_REMOTE_E2E_*` variable must throw `E2E_MODE_FORBIDDEN` before creating a window or service.

- [ ] **Step 2: Run security tests and verify RED**

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/e2e-mode.test.ts
```

Expected: FAIL because `resolveE2eMode` does not exist.

- [ ] **Step 3: Implement inert fixture services**

The fixture may return only validated `DesktopState` and deterministic action results. It must not instantiate Supabase, `CredentialStore`, `HostRegistry`, `HostRuntimeController`, shell opening, native directory access, login-startup mutation or `CodexProcess`. Use fixed fake IDs and generic Chinese messages; do not include real paths, emails, tokens, keys, prompts or task content.

Only after `resolveE2eMode` accepts an unpackaged test launch, assign the fixture control to `globalThis.__codexRemoteE2e`. Playwright may call this control through Electron's main-process `evaluate` API to drive recovery states and inspect action calls. The global must be absent in normal development and packaged launches; it is test control, not a renderer IPC or production API.

Production startup remains the default. E2E mode requires all of:

```text
app.isPackaged === false
CODEX_REMOTE_E2E === "1"
CODEX_REMOTE_E2E_SCENARIO in the four allowed values
CODEX_REMOTE_E2E_USER_DATA resolves beneath os.tmpdir()/codex-remote-e2e-*
```

- [ ] **Step 4: Configure serial Electron Playwright tests**

Set `workers: 1`, `fullyParallel: false`, `timeout: 30_000`, retain traces only on failure, and launch Electron 44 with the compiled `dist/desktop/main.js`. Every test creates a fresh `mkdtemp` user-data directory and closes Electron in `finally`.

- [ ] **Step 5: Test the desktop security shell**

Automate these assertions:

1. renderer URL starts with `app://host/`;
2. `window.process`, `window.require` and direct `ipcRenderer` are unavailable;
3. external navigation and new windows are denied;
4. normal launch shows the window; `--hidden` starts without showing it;
5. close hides rather than exits; second-instance callback reopens;
6. tray status and open/start/stop/Doctor labels follow the fixture state.

- [ ] **Step 6: Test the local Host UI flow**

Using inert scenarios, cover OTP control locking, signed-in overview, project list, directory-add cancellation result, pairing-code presentation, Host start/stop confirmation, Doctor pass/fail display, login-startup toggle result, sign-out, and the two-step data-reset phrase. Assert all visible errors are concise Chinese messages and no raw Error, path, email, token, key or code content appears.

- [ ] **Step 7: Test recovery presentation**

Drive state events through the existing preload subscription and verify `transport-offline`, `codex-restarting`, third App Server failure and recovered `running` states. Assert reconnect does not duplicate the renderer subscription and the app remains responsive at 360 px and 390 px viewport widths.

- [ ] **Step 8: Verify Task 4 and commit**

```powershell
npm.cmd exec -- vitest run apps/host/src/desktop/e2e-mode.test.ts apps/host/src/desktop/ipc-controller.test.ts apps/host/src/desktop/window-manager.test.ts apps/host/src/renderer/app.test.tsx
npm.cmd run build --workspace @codex-remote/host
npm.cmd run test:e2e --workspace @codex-remote/host
npm.cmd run typecheck
npm.cmd run lint
```

Commit:

```powershell
git add apps/host
git commit -m "test(windows): add Electron desktop acceptance"
```

### Task 5: Write the handoff, run the 5C gate, and pause before installation

**Files:**

- Create: `docs/windows-host-user-guide.md`
- Create: `docs/acceptance/windows-host-real-device.md`
- Modify: `apps/host/README.md`
- Modify: `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`

**Interfaces:**

- Consumes: verified installer filename, SHA-256, signing status and automated test evidence.
- Produces: beginner installation guide, sanitized acceptance template and Checkpoint 5C delivery report.

- [ ] **Step 1: Write the beginner guide**

Document in simplified Chinese:

- Windows 10/11 x64 and current-user installation;
- unsigned private build SmartScreen warning and how to verify SHA-256 before opening;
- email OTP, adding an authorized project, phone pairing, Host start/stop and tray behavior;
- Windows must stay powered on, online and logged in;
- the app does not change VPN, proxy, sleep, firewall or router settings;
- Doctor and log-folder use;
- default uninstall retention;
- application data reset must happen before uninstall and never deletes projects or Codex history.

- [ ] **Step 2: Create the sanitized acceptance record**

Use a table with these columns:

```markdown
| 检查项 | 环境/版本 | 结果 | 脱敏证据 | 备注 |
```

Add 5C sections for package contents, unpacked smoke, Electron E2E, installer hash and manual install/reinstall/uninstall. Add an empty 5D section listing real Android, mobile data, VPN-off, Push and 20-round latency fields, but do not record credentials, paths, emails, pairing codes, commands or task content.

- [ ] **Step 3: Run the complete automated gate**

Use explicit loopback public configuration for build/package commands and do not create `.env`:

```powershell
$env:CODEX_REMOTE_SUPABASE_URL='http://127.0.0.1:54321'
$env:CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY='public-key'
$env:CODEX_REMOTE_WEB_ORIGIN='http://127.0.0.1:3000'
$env:CODEX_REMOTE_PROTOCOL_VERSION='1'
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-key'
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

If `npm audit` reports a production vulnerability, record the exact dependency path and stop; do not run `npm audit fix`. Warnings about absent code signing are expected; other packaging warnings require investigation.

- [ ] **Step 4: Inspect the final artifact and tracked diff**

Confirm the installer is x64/asInvoker/current-user, contains no service, auto-updater, firewall, power or proxy changes, and excludes all forbidden files. Confirm Git does not track `release`, `.package-resources`, `public-runtime.json`, temporary user data, screenshots containing personal data or Playwright reports.

- [ ] **Step 5: Commit and push Checkpoint 5C**

```powershell
git add .prettierrc.json .prettierignore .gitignore package.json package-lock.json apps/host docs
git commit -m "feat(windows): package remote host"
git push origin feat/windows-host
```

Report the seven delivery fields plus installer filename, SHA-256, signing status, automated gate results and GitHub branch link.

- [ ] **Step 6: Stop for user-authorized manual installation**

Do not install or uninstall automatically. Report the exact installer path, version, SHA-256, unsigned limitation, install scope and default data-retention behavior. Wait for explicit authorization before installing into the current Windows user profile.

After authorization, perform exactly one manual cycle: install → launch → tray/start-menu check → close/reopen → uninstall with data retained → reinstall → verify retained configuration. Test full data reset only with a temporary test profile unless the user separately authorizes deleting the real Host data.

## Self-Review Checklist

- Every packaging behavior has a failing test before implementation.
- `electron-builder.yml` is the only builder configuration source.
- Packaged Codex metadata matches resolver expectations exactly.
- Complete Codex Windows `vendor` resources remain outside ASAR.
- Public runtime config has four allowed fields and no private values.
- Test fixtures cannot activate when `app.isPackaged` is true.
- NSIS is x64, asInvoker, current-user and retains userData on uninstall.
- No auto-update, service, inbound port, firewall, power, proxy or VPN change exists.
- Static package audit, unpacked smoke and Electron UI tests are separate gates.
- Manual installation remains an explicit user-authorization boundary.
- 5D cloud deployment and Android real-device work are excluded and require a later plan.
