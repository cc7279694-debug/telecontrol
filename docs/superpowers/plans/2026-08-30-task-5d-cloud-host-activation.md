# Task 5D Cloud Host Activation and Android Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 Windows Host 从本地回环配置切换为新加坡 Supabase 和现有 Vercel Preview，修复 Host 对 8 位邮箱 OTP 的兼容问题，生成可安装的 0.1.1 测试包，并完成真实 Windows 与安卓设备的安全配对。

**Architecture:** 保持 `安卓 PWA ⇄ Supabase 加密中转 ⇄ Windows Host ⇄ Codex App Server` 不变。Host 和浏览器仅使用 Supabase Project URL 与 publishable key；Host 登录会话和 P-256 私钥继续由 Electron `safeStorage` 保护；配对码只在内存中显示五分钟，云端只保存哈希和加密信封。数据库迁移、安装新版本和真实设备操作分别设置授权闸门。

**Tech Stack:** Node.js 24、npm workspaces、TypeScript、Electron 44、React 19、Next.js 15、Supabase Auth/Postgres/Realtime、Vercel Preview、Vitest、Playwright、pgTAP。

**Spec:** `docs/superpowers/plans/2026-08-30-task-5d-cloud-android-acceptance.md`

## Global Constraints

- 当前分支固定为 `feat/windows-host`；不创建 PR，不推送或合并 `main`。
- 使用已经创建的新加坡非生产 Supabase 项目和已存在的 `codex-remote` Vercel Preview，不创建第二套云资源。
- 目标 Supabase 身份必须在任何数据库写入前重新核对；当前 Supabase 连接器的只读项目查询返回权限不足，因此不能把未核验状态当作已完成。
- 不在 Git、日志、命令输出、验收文档或聊天中记录邮箱验证码、SMTP 授权码、数据库密码、secret/service-role key、refresh token、私钥或 Web Push 私钥。
- Host 安装包只包含 Project URL、publishable key、Web Origin 和协议版本 `1`。任何高权限密钥进入安装包都必须立即停止。
- Windows Host 继续使用当前用户会话和本机 `stdio` Codex App Server；不创建系统服务、不开放入站端口、不修改防火墙、VPN、代理、睡眠或休眠设置。
- Supabase Realtime 只使用 `host:<hostId>` 私有频道。当前平台已锁定 `realtime` schema，但仍允许维护 `realtime.messages` RLS 策略；不要尝试修改该 schema 的表、函数或触发器。
- 数据库迁移、Windows 安装和真机测试属于外部状态操作，执行前分别报告目标与影响并获得明确授权。
- 所有实现先写失败测试，再写最小修复；测试和构建串行运行，避免 Windows 资源竞争。

## Current Verified Baseline

- Git HEAD 为 `4ef0d31`，工作树在规划开始时干净。
- Vercel 已链接到项目 `codex-remote`，Preview 登录页和 `/pair` 页面可以打开。
- Web 登录已经支持 6–10 位邮箱 OTP；当前真实邮件为 8 位 OTP。
- Windows Host 的 IPC 校验和输入框仍只允许 6 位 OTP，会阻止真实 Host 登录。
- Host 的注册、P-256 密钥、Supabase Transport、五分钟配对码和 Web 端消费配对码均已有实现与单元测试。
- 当前 Host 版本为 `0.1.0`，现有安装包内嵌的是 `127.0.0.1` 本地配置，不能用于安卓远程控制。
- 本地仓库尚未链接目标 Supabase，线上迁移状态必须重新读取；验收文档中的云端与真机项目仍标记为未测试。

---

### Task 1: Make Windows Host accept the configured email OTP length

**Files:**

- Modify: `apps/host/src/desktop/contract.test.ts`
- Modify: `apps/host/src/desktop/contract.ts`
- Modify: `apps/host/src/renderer/app.test.tsx`
- Modify: `apps/host/src/renderer/app.tsx`

**Interfaces:**

- Consumes: `DesktopApi.verifyOtp({ email, token })`
- Produces: `verifyOtpInputSchema` accepting a numeric OTP from 6 through 10 digits; renderer input capped at 10 digits.

- [ ] **Step 1: Write the failing IPC contract test**

Add an assertion that an 8-digit token is accepted while 5-digit, 11-digit and non-numeric values remain rejected:

```ts
expect(
  verifyOtpInputSchema.safeParse({
    email: "user@example.com",
    token: "12345678",
  }).success,
).toBe(true);

for (const token of ["12345", "12345678901", "12345a"]) {
  expect(
    verifyOtpInputSchema.safeParse({
      email: "user@example.com",
      token,
    }).success,
  ).toBe(false);
}
```

- [ ] **Step 2: Write the failing renderer test**

Render the signed-out Host, request an OTP, enter `12345678`, submit, and assert that `verifyOtp` receives all eight digits:

```ts
await user.type(screen.getByLabelText("邮箱验证码"), "12345678");
await user.click(screen.getByRole("button", { name: "完成登录" }));
expect(api.verifyOtp).toHaveBeenCalledWith({
  email: "user@example.com",
  token: "12345678",
});
```

- [ ] **Step 3: Run the focused tests and verify the failure**

```powershell
npm.cmd test -- apps/host/src/desktop/contract.test.ts apps/host/src/renderer/app.test.tsx --pool=forks --maxWorkers=1
```

Expected: the contract rejects or the input truncates the 8-digit token.

- [ ] **Step 4: Implement the minimal compatibility fix**

Use the same accepted range as the Web app:

```ts
token: z
  .string()
  .trim()
  .regex(/^\d{6,10}$/, "验证码必须是6到10位数字"),
```

In the renderer, keep only digits and cap at 10:

```tsx
onChange={(event) =>
  setToken(event.target.value.replace(/\D/g, "").slice(0, 10))
}
maxLength={10}
pattern="[0-9]{6,10}"
```

- [ ] **Step 5: Run focused and Host tests**

```powershell
npm.cmd test -- apps/host/src/desktop/contract.test.ts apps/host/src/renderer/app.test.tsx --pool=forks --maxWorkers=1
npm.cmd run typecheck --workspace @codex-remote/host
```

Expected: tests and typecheck pass without changing the six-digit device pairing code.

- [ ] **Step 6: Commit the OTP fix**

```powershell
git add apps/host/src/desktop/contract.test.ts apps/host/src/desktop/contract.ts apps/host/src/renderer/app.test.tsx apps/host/src/renderer/app.tsx
git commit -m "fix(host): support variable length email otp"
```

---

### Task 2: Verify and apply the encrypted relay schema to the exact Singapore project

**Files:**

- Verify: `supabase/migrations/*.sql`
- Verify: `supabase/tests/remote_transport.sql`
- Modify after verification: `docs/acceptance/windows-host-real-device.md`
- Local ignored state: `supabase/.temp/project-ref`

**Interfaces:**

- Consumes: the six committed migrations in `supabase/migrations`.
- Produces: `hosts`, `devices`, `host_device_links`, `remote_commands`, `audit_events`, private pairing/push storage, RPCs and private Realtime authorization in the exact non-production project.

- [ ] **Step 1: Re-establish read-only Supabase access and verify identity**

Use the authenticated Supabase connector when available; otherwise use the Dashboard or CLI after reading `supabase.cmd --help` and the relevant subcommand help. Verify project name, project ref, organization, Free plan and region `ap-southeast-1`. Do not print any key or password.

Stop if the identity differs from the already configured Singapore project. Do not select the older Sydney project.

- [ ] **Step 2: Inspect remote state before linking or writing**

Read the remote migration list, exposed tables, Realtime public-channel setting and Auth email configuration. Expected outcomes are one of:

- empty application schema, so all six repository migrations are pending; or
- exact migration names already applied with matching schema and policies.

Any partial or unknown migration state blocks apply until the difference is explained.

- [ ] **Step 3: Run local database verification**

```powershell
npm.cmd run test:db
```

Expected: the local schema/contract tests pass before any online write.

- [ ] **Step 4: Report the exact pending migration list and request database-write authorization**

The report must name the target project using a safe identifier, state the Singapore region, list pending migration filenames, and explain that the write creates relay tables, RLS policies, RPCs and one retention cron job. Do not apply yet.

- [ ] **Step 5: Link and dry-run only after authorization**

Discover current CLI syntax first:

```powershell
supabase.cmd link --help
supabase.cmd db push --help
```

Link to the verified project without exposing the database password, then run:

```powershell
supabase.cmd migration list --linked
supabase.cmd db push --linked --include-all --dry-run
```

Compare the dry-run migration set byte-for-byte by filename with the repository list. A mismatch stops the task.

- [ ] **Step 6: Apply once and verify read-only**

```powershell
supabase.cmd db push --linked --include-all
supabase.cmd migration list --linked
```

Verify all public tables have RLS, the pairing RPC accepts only active same-owner sessions, the `host:<hostId>` Realtime policies exist, public channels are disabled, the retention job is single-instance, and security/performance advisors show no unexplained new finding.

- [ ] **Step 7: Record redacted evidence and commit**

Update only the Supabase row in `docs/acceptance/windows-host-real-device.md`; never record email, tokens or keys.

```powershell
git add docs/acceptance/windows-host-real-device.md
git commit -m "test(db): record singapore relay acceptance"
```

---

### Task 3: Build a cloud-configured Windows Host 0.1.1 package

**Files:**

- Modify: `apps/host/package.json`
- Modify: `package-lock.json`
- Modify: `apps/host/scripts/verify-package.ts`
- Modify: `apps/host/scripts/verify-package.test.ts`
- Temporarily generate, then restore: `apps/host/public-runtime.json`
- Generate ignored artifact: `apps/host/release/Codex-Remote-Host-0.1.1-Windows-x64.exe`

**Interfaces:**

- Consumes: verified Project URL, publishable key, Vercel Preview origin and protocol version `1`.
- Produces: a versioned current-user Windows installer containing only public runtime configuration.

- [ ] **Step 1: Write the failing package-version assertions**

Change the expected installer version and filename in package verification tests to:

```ts
const EXPECTED_VERSION = "0.1.1" as const;
const EXPECTED_INSTALLER = "Codex-Remote-Host-0.1.1-Windows-x64.exe" as const;
```

Run:

```powershell
npm.cmd test -- apps/host/scripts/verify-package.test.ts --pool=forks --maxWorkers=1
```

Expected: FAIL while the package remains `0.1.0`.

- [ ] **Step 2: Bump only the Host application version**

Set `apps/host/package.json` to `0.1.1`, update the root lockfile through npm, and update the verification constant. Do not change the shared protocol package version.

```powershell
npm.cmd install --package-lock-only
```

- [ ] **Step 3: Run the complete pre-package gate serially**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
npm.cmd run build
```

Expected: all gates pass before creating the installer.

- [ ] **Step 4: Generate runtime config from process-only public values**

Set only these four variables for the packaging process:

```text
CODEX_REMOTE_SUPABASE_URL
CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY
CODEX_REMOTE_WEB_ORIGIN
CODEX_REMOTE_PROTOCOL_VERSION=1
```

Use the exact verified Singapore Project URL and current Vercel Preview origin. Never set service-role/secret, SMTP or VAPID values in the Host environment.

- [ ] **Step 5: Build and audit the package**

```powershell
npm.cmd run package:win --workspace @codex-remote/host
npm.cmd run package:verify --workspace @codex-remote/host
npm.cmd run package:smoke --workspace @codex-remote/host
```

Inspect the unpacked `public-runtime.json`; it must contain the exact Project URL, publishable key, Preview origin and protocol version only. Search the installer/unpacked resources for forbidden high-privilege key prefixes and credential variable names.

- [ ] **Step 6: Restore the tracked local placeholder and inspect Git scope**

Restore `apps/host/public-runtime.json` to the repository's loopback placeholder using an explicit patch, not a destructive checkout. Confirm the cloud publishable key and URL are not present in the Git diff, while they remain inside the ignored release artifact by design.

```powershell
git status --short
git diff --check
git diff --stat
```

- [ ] **Step 7: Hash, commit and push the code changes**

Calculate SHA-256 for the 0.1.1 installer without committing the binary. Then:

```powershell
git add apps/host/package.json package-lock.json apps/host/scripts/verify-package.ts apps/host/scripts/verify-package.test.ts
git commit -m "feat(host): package cloud relay build"
git push origin feat/windows-host
```

Report branch, commit, push result, installer path/version/hash and all validation results. Pause before installation.

---

### Task 4: Install, sign in and create the first real pairing request

**Files:**

- External Windows current-user installation only.
- Modify after verification: `docs/acceptance/windows-host-real-device.md`

**Interfaces:**

- Consumes: verified 0.1.1 installer and the same authorized email account already used by the PWA.
- Produces: one registered Host ID, one authorized workspace, an active Host connection and one five-minute six-digit device pairing code.

- [ ] **Step 1: Report installer target and request installation authorization**

State that this updates the current-user Host from 0.1.0 to 0.1.1, preserves configuration by default, and does not uninstall first. Do not start the installer until explicitly authorized.

- [ ] **Step 2: Install/update and verify process identity**

Close the old Host normally, install 0.1.1, launch it under the current Windows user, and verify no service, inbound listener or firewall rule was added.

- [ ] **Step 3: Complete Host OTP login**

Enter the authorized email, send one OTP, and pause only when the secret OTP must be entered by the user. Verify that the full 8-digit token is accepted and that the window shows `Host 已登录` plus `注册状态：已连接`.

- [ ] **Step 4: Authorize one local workspace and start Host**

Use the directory chooser so the user selects the exact allowed project root. Start Host and verify the status becomes either `等待配对`/`awaiting-pairing` or online; do not broaden the authorized root automatically.

- [ ] **Step 5: Generate one pairing request**

Click `生成配对码` and verify the window displays:

- a UUID Host ID;
- a six-digit pairing code;
- a countdown no longer than five minutes.

Do not record the code in logs, screenshots committed to Git, or acceptance docs.

- [ ] **Step 6: Record redacted Host evidence**

Record only installer version/hash, login pass/fail, host registration pass/fail, workspace authorization pass/fail and pairing request pass/fail.

---

### Task 5: Pair Android and close the real-device acceptance checkpoint

**Files:**

- Modify: `docs/acceptance/windows-host-real-device.md`
- Modify only if a reproducible defect is found: the smallest relevant source/test files.

**Interfaces:**

- Consumes: Host ID, live pairing code, authenticated PWA device identity and P-256 public keys.
- Produces: one active `host_device_links` row, a locally derived AES session key, private Realtime access and verified remote Codex control.

- [ ] **Step 1: Pair on Android Chrome**

Open the existing Preview `/pair` page on Android, sign in with the same account, enter the Host ID and current pairing code, and confirm redirect to the paired Host. Repeat attempts must use a newly generated code; never retry an expired code.

- [ ] **Step 2: Verify the primary control flow**

With Windows online and VPN disabled on the phone, verify in order:

1. Host online state;
2. thread list and history read;
3. create a thread inside the authorized workspace;
4. send one text turn and observe streaming output;
5. append/steer once;
6. respond to one actual approval request;
7. interrupt one running turn;
8. resume an idle thread.

Do not include prompt text, code, commands or paths in the acceptance record.

- [ ] **Step 3: Verify recovery and notifications**

Test Wi-Fi to mobile-data switching, closing/reopening the PWA, restarting Host, and one App Server crash/restart. Verify commands are not duplicated. Confirm generic approval/completion/failure notifications contain no sensitive content.

- [ ] **Step 4: Measure transport latency**

Run at least 20 control-message round trips on mobile data with VPN disabled. Record P50, P95 and maximum, excluding model inference. Acceptance target: P50 at most 1.5 seconds, P95 at most 3 seconds, and typical reconnect within 5 seconds.

- [ ] **Step 5: Run the final repository gate**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
npm.cmd run build
npm.cmd run verify:host-package
```

- [ ] **Step 6: Update acceptance evidence, commit and push**

Fill every mandatory 5D row with sanitized evidence. If any row fails, leave Task 5D open and record the defect instead of marking it complete.

```powershell
git add docs/acceptance/windows-host-real-device.md
git commit -m "test(e2e): record cloud android acceptance"
git push origin feat/windows-host
```

Report the seven delivery items required by `AGENTS.md` and pause for final module acceptance. Do not create a PR or touch `main`.

## Plan Self-Review

- Spec coverage: OTP compatibility, exact-project database apply, cloud package, Windows installation, secure pairing, remote-control flow, recovery, notification and latency all have explicit tasks.
- Secret boundary: no step requires printing or committing a secret; only public runtime configuration enters the Host artifact.
- Type consistency: email OTP remains separate from the six-digit device pairing code; no shared `CodexAdapter` or `RemoteTransport` interface changes are required.
- Scope: this plan closes the existing 5D path and does not add Cloudflare, native Android, Git/Diff, file management, voice, images or multi-user support.
