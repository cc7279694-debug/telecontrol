# Windows Installer Checkpoint 5C Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:systematic-debugging` for any failed gate and `superpowers:verification-before-completion` before each completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Checkpoint 5C 的依赖修复后最终打包、脱敏证据更新、文档交接和当前用户人工安装验收，并在进入 5D 前形成可复核的 Git 记录。

**Architecture:** 不新增产品功能，也不改变 Windows Host 架构。先在同一功能分支串行重跑完整自动化门禁，再用一次性回环公开配置重新生成 x64 NSIS 私人测试包；安装包只保留在本机忽略目录，Git 只提交脱敏文档。人工安装、卸载和重装作为独立授权门，未获得明确授权时必须停止。

**Tech Stack:** Node.js 24、npm 11.5.1、TypeScript 5.9.3 strict、Next.js 15.5.24、Electron 44.0.0、electron-builder 26.15.3、Vitest 3.2.7、Playwright 1.62.1、Supabase CLI、本地 Docker Desktop。

**Spec:** `docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md` 的 Checkpoint 5C，以及 `docs/superpowers/plans/2026-08-28-windows-installer-checkpoint-5c.md` 的 Task 5。

## Global Constraints

- 本计划只关闭 Checkpoint 5C；不创建或修改 Hosted Supabase、Vercel、VAPID、Preview、Production、DNS 或 Android 真机数据。
- 5D 的手机流量、VPN 关闭、锁屏通知、网络切换和 20 轮时延测试不属于本计划。
- 不修改产品源代码。若任一自动化门禁暴露真实缺陷，停止 5C 收尾，另起最小修复计划；不得在文档提交中夹带代码修复。
- 最终 5C 安装包使用回环 Supabase URL、公开测试 publishable key、回环 Web Origin 和协议版本 1；它是本地私人测试包，不是可供异地安卓手机使用的云端安装包。
- 禁止把 service-role、数据库密码、VAPID 私钥、Token、Session、Host 私钥、`.env`、邮箱、Windows 个人路径、配对码、提示词、回复、代码或命令正文写入文档或安装包。
- Windows 安装器保持 x64、`asInvoker`、`perMachine: false`、当前用户安装、无 Windows 服务、无入站端口、无防火墙/电源/代理/VPN修改。
- 安装包保持未签名；必须记录 SmartScreen 限制和 SHA-256，不得描述为正式公开发行版。
- Web E2E、Host E2E、生产构建和打包必须串行执行。不得在同一工作树同时启动两套 Web E2E 或在 Web 开发服务器运行时改写 `apps/web/.next`。
- `release/`、`.package-resources/`、`public-runtime.json`、Playwright 报告和临时用户数据继续保持 Git 忽略。
- 只允许提交并推送 `feat/windows-host`；不创建 PR，不合并或推送 `main`。

## File Map

- Modify: `apps/host/README.md` — 固定开发、打包、校验命令和私人测试包限制。
- Modify: `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md` — 把模块五状态更新到 5C 自动化完成或人工安装待授权。
- Create/Update: `docs/windows-host-user-guide.md` — 面向小白的安装、启动、托盘、Doctor、卸载和数据保留说明。
- Create/Update: `docs/acceptance/windows-host-real-device.md` — 只记录脱敏的 5C 自动化、安装器和人工安装结果；5D 保持空模板。
- Track: `docs/superpowers/plans/2026-08-29-next15-security-dependency-upgrade.md` — 保留生产依赖漏洞修复决策和验收依据。
- Create: `docs/superpowers/plans/2026-08-29-windows-installer-checkpoint-5c-closeout.md` — 本收尾执行计划。
- Generated, never tracked: `apps/host/release/Codex-Remote-Host-0.1.0-Windows-x64.exe`。

---

### Task 1: Freeze the accepted dependency and document scope

**Files:**

- Inspect only: `package.json`
- Inspect only: `apps/web/package.json`
- Inspect only: `package-lock.json`
- Inspect only: `apps/web/src/lib/dependency-security.test.ts`
- Inspect only: the six 5C documentation files listed in the File Map

**Interfaces:**

- Consumes: accepted dependency commit `dcf4b32` and existing uncommitted 5C documentation.
- Produces: a verified clean boundary between the dependency commit, 5C documentation and generated artifacts.

- [ ] **Step 1: Confirm branch and commit identity**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/feat/windows-host
```

Expected: branch `feat/windows-host`; local and remote HEAD both equal `dcf4b32d50e2515b2917af227d43728557b59ccc`. Existing dirty files are limited to the 5C README/plan/guide/acceptance documents and planning artifacts. If any product source or dependency manifest is dirty, stop and report the overlap.

- [ ] **Step 2: Reconfirm the dependency tree and production audit**

Run:

```powershell
npm.cmd ls next postcss sharp --all
npm.cmd exec -- vitest run apps/web/src/lib/dependency-security.test.ts --pool=forks --maxWorkers=1
npm.cmd audit --omit=dev
```

Expected: Next.js `15.5.24`, PostCSS `8.5.26`, Sharp `0.35.3`; policy test passes; audit reports `found 0 vulnerabilities`.

- [ ] **Step 3: Preserve the existing documentation boundary**

Run:

```powershell
git diff -- apps/host/README.md docs/superpowers/plans/2026-08-23-codex-remote-mvp.md
git status --short docs
```

Expected: no product source file appears. Do not stage or rewrite the documentation yet; final evidence is recorded only after Task 2 produces the new installer hash.

---

### Task 2: Run the final automated gate and regenerate the NSIS artifact

**Files:**

- Read only: all tracked product and test files
- Generate, ignored: `apps/web/.next/`
- Generate, ignored: `apps/host/dist/`
- Generate, ignored: `apps/host/.package-resources/`
- Generate, ignored: `apps/host/public-runtime.json`
- Generate, ignored: `apps/host/release/`

**Interfaces:**

- Consumes: accepted source at `dcf4b32`, Docker Desktop local Supabase, and disposable loopback public configuration.
- Produces: one verified x64 NSIS artifact plus fresh automated evidence and a new SHA-256 value.

- [ ] **Step 1: Run repository static and test gates**

Run these commands in order; do not launch them concurrently:

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
```

Expected: formatting, type checking and lint exit 0; 69 unit-test files and 349 tests pass; 23 database tests pass. If test counts change, record the actual passing count and investigate any decrease before continuing.

- [ ] **Step 2: Build all workspaces with disposable Web public configuration**

Run:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-key'
npm.cmd run build
```

Expected: Host, Web and protocol builds exit 0; Next.js reports version `15.5.24`. Multiple-lockfile and existing ESLint-plugin messages may be recorded as warnings but are not treated as build failures.

- [ ] **Step 3: Run Web and Host E2E serially**

Before Web E2E, confirm port 3100 has no listener. If `apps/web/.next` contains evidence from an interrupted run, move that exact generated directory to a uniquely named system temporary path before starting; never delete or move source files.

Run:

```powershell
Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
npm.cmd run test:e2e --workspace @codex-remote/web
npm.cmd run test:e2e --workspace @codex-remote/host
```

Expected: Web E2E reports 18 passed and 3 explicitly skipped; Host E2E reports 13 passed. A navigation abort, missing `.next` manifest or module error requires stopping all Web test processes, verifying port 3100 is free and restarting once from a fresh generated `.next`; do not increase timeouts or change source code without a separate bugfix review.

- [ ] **Step 4: Generate the final unsigned NSIS installer once**

Use only these disposable public values in the current PowerShell process:

```powershell
$env:CODEX_REMOTE_SUPABASE_URL='http://127.0.0.1:54321'
$env:CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY='public-key'
$env:CODEX_REMOTE_WEB_ORIGIN='http://127.0.0.1:3000'
$env:CODEX_REMOTE_PROTOCOL_VERSION='1'
npm.cmd run package:win --workspace @codex-remote/host
```

Expected: exactly one `Codex-Remote-Host-0.1.0-Windows-x64.exe` is generated under `apps/host/release`; build succeeds without configuring code signing. Do not rebuild repeatedly after success because each rebuild can change the artifact hash.

- [ ] **Step 5: Verify the final installer and unpacked startup**

Run:

```powershell
npm.cmd run package:verify --workspace @codex-remote/host
npm.cmd run package:smoke --workspace @codex-remote/host
npm.cmd audit --omit=dev
```

Expected: verifier reports the exact installer filename, architecture `x64`, signing status `unsigned`, 93 checked files and a non-empty SHA-256; unpacked smoke exits 0; production audit remains at zero. Copy only the filename, hash, architecture, signing state and counts into the acceptance record.

- [ ] **Step 6: Inspect generated and tracked boundaries**

Run:

```powershell
git status --short
git diff --check
git check-ignore apps/host/release apps/host/.package-resources apps/host/public-runtime.json apps/web/.next
```

Expected: generated artifacts remain ignored. If any generated binary, public runtime file, Playwright report or personal test data appears as trackable, stop before documentation changes.

---

### Task 3: Update the sanitized handoff and push the automated 5C checkpoint

**Files:**

- Modify: `apps/host/README.md`
- Modify: `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`
- Create/Modify: `docs/windows-host-user-guide.md`
- Create/Modify: `docs/acceptance/windows-host-real-device.md`
- Track: `docs/superpowers/plans/2026-08-29-next15-security-dependency-upgrade.md`
- Track: `docs/superpowers/plans/2026-08-29-windows-installer-checkpoint-5c-closeout.md`

**Interfaces:**

- Consumes: Task 2's exact automated results and final installer metadata.
- Produces: beginner handoff, sanitized automated acceptance record and a pushed documentation checkpoint.

- [ ] **Step 1: Update the acceptance record from fresh evidence**

Replace the obsolete production-audit blocker with the exact zero-vulnerability result. Record the actual current unit, database, Web E2E, Host E2E, build, package audit, smoke, filename, SHA-256, x64 and unsigned results. Keep all manual installation rows explicitly marked as not executed; do not infer shortcut, tray, uninstall or reinstall results.

- [ ] **Step 2: Finalize the beginner guide and developer README**

Confirm both documents state:

- current-user Windows 10/11 x64 installation;
- unsigned private-test SmartScreen warning and hash verification;
- Host requires the current Windows user to remain logged in and the PC to remain online;
- no Windows service, firewall, power, proxy, router or VPN changes;
- default uninstall preserves Host configuration and Codex/project data;
- complete local data removal requires the in-app confirmation flow before uninstall;
- loopback 5C package is not the cloud/mobile-ready 5D package.

Do not include real account data, personal paths or external project identifiers.

- [ ] **Step 3: Update the parent status without claiming manual acceptance**

Set the parent plan status to: 5C automated packaging and handoff complete; current-user install/uninstall/reinstall awaiting explicit authorization. Keep 5D cloud and Android work excluded.

- [ ] **Step 4: Format and inspect only the documentation scope**

Run:

```powershell
npm.cmd exec -- prettier --write apps/host/README.md docs/windows-host-user-guide.md docs/acceptance/windows-host-real-device.md docs/superpowers/plans/2026-08-23-codex-remote-mvp.md docs/superpowers/plans/2026-08-29-next15-security-dependency-upgrade.md docs/superpowers/plans/2026-08-29-windows-installer-checkpoint-5c-closeout.md
npm.cmd run format:check
git diff --check
git status --short
```

Expected: only the six documentation files are new or modified. If product code, manifests or generated artifacts appear, stop before staging.

- [ ] **Step 5: Scan the exact documentation diff for sensitive information**

Inspect the full diff and reject any email, personal Windows path, token, key, pairing code, prompt, output, command body, project name or notification endpoint. Public loopback URLs and the final installer SHA-256 are allowed.

Run:

```powershell
git diff -- apps/host/README.md docs/windows-host-user-guide.md docs/acceptance/windows-host-real-device.md docs/superpowers/plans/2026-08-23-codex-remote-mvp.md docs/superpowers/plans/2026-08-29-next15-security-dependency-upgrade.md docs/superpowers/plans/2026-08-29-windows-installer-checkpoint-5c-closeout.md
```

- [ ] **Step 6: Commit and push the automated handoff**

Stage exactly the six documentation files listed in Step 5, then verify the staged names and diff before committing.

```powershell
git add -- apps/host/README.md docs/windows-host-user-guide.md docs/acceptance/windows-host-real-device.md docs/superpowers/plans/2026-08-23-codex-remote-mvp.md docs/superpowers/plans/2026-08-29-next15-security-dependency-upgrade.md docs/superpowers/plans/2026-08-29-windows-installer-checkpoint-5c-closeout.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(windows): complete installer handoff"
git push origin feat/windows-host
```

Expected: push succeeds without touching `main` and without creating a PR. Report branch, commit ID, message, push result, principal files, automated gates, GitHub branch link, local installer path, SHA-256 and unsigned limitation.

- [ ] **Step 7: Pause before changing the Windows user profile**

Report the exact local installer path, version, SHA-256, unsigned/SmartScreen limitation, current-user installation scope and default configuration retention. Ask for a separate explicit authorization to install, uninstall and reinstall. Do not launch the installer in the same turn as the report.

---

### Task 4: Perform the separately authorized manual installer acceptance

**Authorization gate:** This task is forbidden until the user explicitly authorizes installing, uninstalling and reinstalling `Codex Remote Host 0.1.0` in the current Windows user profile.

**Files:**

- Modify after the manual run: `docs/acceptance/windows-host-real-device.md`

**Interfaces:**

- Consumes: the exact Task 2 installer and hash plus explicit user authorization.
- Produces: a factual manual acceptance result; it does not produce cloud or Android evidence.

- [ ] **Step 1: Revalidate the artifact immediately before launch**

Run the package verifier again and compare the installer SHA-256 with the Task 3 report. Any mismatch stops the installation; do not regenerate or substitute another installer.

- [ ] **Step 2: Install as the current user and verify visible shell behavior**

With the user aware that Windows state will change, launch the exact installer. Verify the installer does not request administrator elevation, then verify desktop/start-menu entry, tray icon, management window, close-to-tray, second-launch window activation and explicit application exit. Do not enable login startup unless that exact toggle is part of the authorized manual check.

- [ ] **Step 3: Verify default uninstall retention**

Record only generic pass/fail results. Uninstall normally and verify program files and shortcuts are removed while Host configuration remains available for reinstall. Do not clear real Host data and do not inspect or record credential contents.

- [ ] **Step 4: Reinstall and verify restoration**

Reinstall the same hash-identical artifact and confirm the application can reopen with retained non-sensitive configuration. Do not connect Hosted Supabase, deploy Web, pair a real Android device or run remote Codex tasks in 5C.

- [ ] **Step 5: Record the sanitized manual result**

Update only the manual-install rows in `docs/acceptance/windows-host-real-device.md`. Record pass/fail, Windows major version, app version and installer hash; omit usernames, paths, email, configuration values and screenshots containing personal data.

- [ ] **Step 6: Verify, commit and push the manual acceptance record**

Run:

```powershell
npm.cmd exec -- prettier --write docs/acceptance/windows-host-real-device.md
npm.cmd run format:check
git diff --check
git diff -- docs/acceptance/windows-host-real-device.md
git add -- docs/acceptance/windows-host-real-device.md
git diff --cached --check
git commit -m "test(windows): record installer acceptance"
git push origin feat/windows-host
```

Expected: only the acceptance record is committed. Report the seven module-delivery fields, installer hash, manual result and remaining unsigned limitation, then pause for final 5C acceptance.

## Stop Conditions

- Any production dependency vulnerability, failed test, build failure, package-verifier failure or hash mismatch stops the current task.
- Any request for administrator elevation, all-users installation, service creation, firewall/power/proxy change or unexpected data removal fails the manual acceptance.
- Any source-code fix discovered during closeout requires a separate plan and commit before resuming this document.
- Any Hosted Supabase, Vercel, VAPID, Preview, Production or Android action belongs to Checkpoint 5D and requires a separate plan and explicit external-change authorization.

## Completion Gate

Checkpoint 5C is complete only when:

1. automated gates, final NSIS verification and production audit pass;
2. sanitized handoff documents are committed and pushed;
3. the user separately authorizes and completes current-user install/uninstall/reinstall acceptance;
4. the manual acceptance record is committed and pushed;
5. no 5D external action has been performed.
