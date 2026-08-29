# Task 5D Cloud Preview and Android Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不发布 Production、不改变 Windows 网络与系统设置的前提下，把现有 Codex Remote 连接到一个新的非生产 Supabase 和 Vercel Preview，生成仅含公开配置的 Windows Host 安装包，并用安卓真机在关闭 VPN 的手机流量环境完成端到端、通知、恢复和延迟验收。

**Architecture:** 保持现有 `安卓 PWA ⇄ Supabase 加密中转 ⇄ Windows Host ⇄ Codex App Server` 架构不变。浏览器与 Host 只持有 Supabase publishable key；Vercel 服务端独占数据库高权限密钥和 VAPID 私钥；云端仅保存加密信封与脱敏审计元数据。Task 5D 分成四个可独立验收的阶段，每个阶段提交、推送并暂停，外部资源创建、数据库写入、Preview 部署和本机安装分别设置授权闸门。

**Tech Stack:** Node.js 24、npm 11.5.1、TypeScript、Electron、Next.js 15.5.24、React 19、Tailwind CSS、Supabase CLI 2.111.0、PostgreSQL、Supabase Auth/Realtime、Vercel Preview、Web Push、Playwright、Vitest、pgTAP。

**Spec:** `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`、`docs/superpowers/plans/2026-08-26-windows-host-packaging-design.md`、`docs/superpowers/plans/2026-08-26-windows-host-packaging.md`、`docs/acceptance/windows-host-real-device.md`。

## Global Constraints

- 基线分支为 `feat/windows-host`，规划时基线提交为 `1dbc2ec`；只推送当前功能分支，不创建 PR，不推送或合并 `main`。
- 目标 Supabase 必须是新建或经身份核对后明确选定的非生产项目 `codex-remote-dev`，区域固定新加坡 `ap-southeast-1`。不得改写其他可见项目。
- 目标 Vercel 必须是 Preview 项目 `codex-remote-web-dev`；Git 来源为 `feat/windows-host`，Root Directory 为 `apps/web`，允许构建时读取仓库根目录的 workspace 包；不得部署 Production。
- 浏览器和 Host 只使用 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY`。数据库高权限密钥、VAPID 私钥、SMTP 凭据只进入相应服务端密钥存储，不进入 Git、浏览器构建、安装包、日志或验收文档。
- 协议版本保持 `1`；不新增 Cloudflare Transport，不改变页面与 `CodexAdapter` 接口。
- Windows Host 继续运行在当前用户会话；不创建系统服务，不开放入站端口，不改防火墙、睡眠、代理或 VPN 设置。
- 外部操作按顺序单独授权：Supabase 项目与邮箱通道、数据库迁移、Vercel Preview/VAPID、Windows 安装、安卓真机测试。一次授权不自动覆盖后续操作。
- 外部身份、成本、目标或写入结果出现不一致时立即停止；不得换用另一个项目、重复创建资源或自动修复生产外部状态。
- Realtime 必须关闭公开频道访问，客户端频道必须使用 `private: true`，授权继续由 `realtime.messages` 上的策略约束。
- 单元/数据库/浏览器/安装包验证按串行方式执行，避免 Windows 资源竞争造成假失败。

## Current Platform Decision

2026-06-03 起，新建 Free Supabase 项目若使用默认 SMTP，不能自定义认证邮件模板；现有 Electron 和 PWA 登录界面要求邮件中包含 `{{ .Token }}` 的 6 位 OTP。因此本计划不把“新 Free 项目 + 默认 SMTP”视为可用路径。

执行 Supabase 外部阶段前必须二选一，并单独获得授权：

1. **推荐的无额外 Supabase 付费路径：** Free 项目 + 用户已有或另行授权创建的自定义 SMTP；模板使用 `{{ .Token }}`。SMTP 账户、发件域名和凭据不由本计划擅自创建。
2. **最少第三方配置路径：** Supabase Pro 或更高套餐 + Supabase 默认 SMTP；创建前必须查询实时费用并由用户明确确认。

如果两条路径都未获授权，完成 5D-A 后停止；不得临时把 Electron/PWA 改成 Magic Link，也不得把 SMTP 凭据写入仓库。

依据：

- [Supabase Free Tier 邮件模板变更](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
- [Supabase 自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Email Templates 与 OTP Token](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Vercel Monorepos](https://vercel.com/docs/monorepos)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)

---

## Checkpoint 5D-A: Local Cloud Readiness

### Task 1: Make the web workspace deployable in isolation

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/dependency-security.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Add a failing workspace-dependency test**

Extend `apps/web/src/lib/dependency-security.test.ts` so it reads `apps/web/package.json` and requires the explicit internal dependency:

```ts
expect(webPackage.dependencies?.["@codex-remote/protocol"]).toBe("0.1.0");
```

Run:

```powershell
npm.cmd test -- apps/web/src/lib/dependency-security.test.ts
```

Expected: FAIL because `apps/web` currently imports the protocol package but does not declare it.

- [ ] **Step 2: Declare all deployment-time dependencies explicitly**

Add to `apps/web/package.json`:

```json
"@codex-remote/protocol": "0.1.0"
```

Do not add Vercel CLI to the application dependency tree. The first attempted install showed that CLI `59.10.0` brings transitive high/critical audit findings into the repository even though it is only a deployment tool. Keep the deployment tool exact and isolated; later cloud steps invoke `vercel@59.10.0` ephemerally and verify its version before use. Update the application lockfile only through npm:

```powershell
npm.cmd install
```

- [ ] **Step 3: Verify the workspace graph and dependency safety**

```powershell
npm.cmd ls @codex-remote/protocol --workspace @codex-remote/web --all
npm.cmd test -- apps/web/src/lib/dependency-security.test.ts
npm.cmd audit --audit-level=high
npm.cmd run build --workspace @codex-remote/web
```

Expected: protocol dependency resolves from the web workspace, test/build pass, audit reports no high-or-higher vulnerability.

- [ ] **Step 4: Commit the isolated fix**

```powershell
git add apps/web/package.json apps/web/src/lib/dependency-security.test.ts package-lock.json
git commit -m "fix(web): declare preview deployment dependencies"
```

### Task 2: Enforce cloud ciphertext and audit retention

**Files:**

- Create: one migration generated by `supabase.cmd migration new add_remote_retention`
- Modify: `supabase/tests/remote_transport.sql`
- Modify: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Write failing pgTAP coverage**

Add tests that prove:

- terminal commands completed more than 24 hours ago are removed;
- nonterminal commands expired more than 24 hours ago are removed;
- recent completed/queued commands remain;
- audit events older than 30 days are removed while recent rows remain;
- expired pairing requests are removed;
- `anon`, `authenticated` and `service_role` cannot directly execute the cleanup function;
- exactly one active cron job named `codex-remote-retention-hourly` exists.

Run:

```powershell
supabase.cmd test db --local
```

Expected: FAIL because the cleanup function and job do not exist.

- [ ] **Step 2: Generate the migration through the CLI**

```powershell
supabase.cmd migration new add_remote_retention
```

Do not invent or rename the timestamp. In the generated migration:

```sql
create extension if not exists pg_cron with schema extensions;

create or replace function private.cleanup_remote_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.remote_commands
  where (
    completed_at is not null
    and completed_at < now() - interval '24 hours'
  ) or (
    completed_at is null
    and expires_at < now() - interval '24 hours'
  );

  delete from public.audit_events
  where created_at < now() - interval '30 days';

  delete from private.pairing_requests
  where expires_at < now();
end;
$$;

revoke all on function private.cleanup_remote_retention()
from public, anon, authenticated, service_role;

select cron.schedule(
  'codex-remote-retention-hourly',
  '17 * * * *',
  $$select private.cleanup_remote_retention();$$
);
```

Before scheduling, make the migration idempotently remove an existing job with the same name through `cron.unschedule(jobid)` if present; never insert into `cron.job` directly.

- [ ] **Step 3: Rebuild and test the local database**

```powershell
supabase.cmd db reset --local
supabase.cmd test db --local
supabase.cmd db lint --local --level warning
```

Expected: migrations apply from zero, all pgTAP assertions pass, and no new warning is introduced. If local Docker or `pg_cron` is unavailable, stop and diagnose rather than weakening the retention requirement.

- [ ] **Step 4: Record the readiness status and commit**

Update Checkpoint 5D in `docs/acceptance/windows-host-real-device.md` to record only local readiness evidence; leave every cloud and real-device row as `未测试`.

```powershell
git add supabase/migrations supabase/tests/remote_transport.sql docs/acceptance/windows-host-real-device.md
git commit -m "feat(db): add encrypted relay retention"
```

### Task 3: Run the complete local release gate

**Files:**

- Verify only; modify files only to correct failures within Tasks 1–2.

- [ ] **Step 1: Run repository validation serially**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
npm.cmd run build
npm.cmd run test:e2e -- --workers=1
npm.cmd run verify:host-package
npm.cmd audit --audit-level=high
```

- [ ] **Step 2: Inspect scope and secrets**

```powershell
git status --short
git diff HEAD~2 --check
git diff HEAD~2 --stat
git grep -n -I -E "sb_secret_|service_role.*eyJ|WEB_PUSH_VAPID_PRIVATE_KEY=.+|SUPABASE_SERVICE_ROLE_KEY=.+|SMTP_PASS=.+"
```

Expected: only planned files changed and no real secret is present. Example variable names with empty values are allowed; any populated match blocks delivery.

- [ ] **Step 3: Push and pause for 5D-A acceptance**

```powershell
git push origin feat/windows-host
```

Report branch, both commit IDs/messages, push result, major files, validation results, GitHub branch link and “Checkpoint 5D-A 等待确认”. Do not start cloud discovery before user acceptance.

---

## Checkpoint 5D-B: Authorized Supabase Environment

### Task 4: Perform read-only identity, cost and auth-path discovery

**Files:**

- Modify only after discovery: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Read current CLI help before any external call**

```powershell
supabase.cmd projects create --help
supabase.cmd link --help
supabase.cmd db push --help
supabase.cmd db advisors --help
```

- [ ] **Step 2: Inspect visible Supabase organizations/projects without mutation**

Record only organization/project names, IDs, regions and plan labels needed for target selection. Never print API keys, access tokens, database passwords, SMTP credentials or user emails.

Confirm all of the following:

- no existing project named `codex-remote-dev` would be overwritten;
- selected organization is the one the user intends to pay from;
- target region is `ap-southeast-1`;
- current project-creation cost has been retrieved from the authoritative Supabase interface;
- auth path is explicitly selected: Free + custom SMTP, or paid Supabase + default SMTP.

- [ ] **Step 3: Report exact intended writes and stop for authorization**

Report project name, organization, region, live cost, chosen OTP route, migration count, Realtime public-channel change and retention cron job. Obtain one explicit authorization for project creation/auth configuration, then a separate authorization for migration apply.

### Task 5: Create and configure the approved non-production Supabase project once

**Files:**

- Create locally through Supabase CLI: `supabase/.temp/project-ref` (ignored)
- Modify: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Create the exact approved project**

Prefer an authenticated Supabase project-creation interface that exposes a cost quote and confirmation token. If only the Dashboard is available, let the user enter the database password directly; never place it in a command argument, file, transcript or environment dump.

After creation, verify project name, project ref, organization and region read-only before continuing. A mismatch is terminal for this stage.

- [ ] **Step 2: Configure Auth and Realtime**

Configure only the selected OTP route:

- Magic Link/OTP email template body contains `{{ .Token }}` and no login URL;
- email sign-in is enabled for the single account;
- Site URL and redirect allowlist use the later Preview hostname only after it exists; until then use the exact localhost development callback already supported by the app;
- Free + custom SMTP stores SMTP credentials only in Supabase Auth settings;
- paid/default SMTP path does not add a third-party SMTP account;
- Realtime “Allow public access” is disabled.

Send one OTP only to the organization-authorized test address and verify that a 6-digit token is delivered. Do not record the address or token.

- [ ] **Step 3: Link, inspect and dry-run the exact migration set**

```powershell
supabase.cmd link --project-ref $codexRemoteProjectRef
supabase.cmd migration list --linked
supabase.cmd db push --linked --include-all --dry-run
```

`$codexRemoteProjectRef` must be assigned from the already verified project result without printing secrets. Compare every pending migration filename with the repository. Report the dry-run and stop for separate apply authorization.

- [ ] **Step 4: Apply once and verify read-only**

```powershell
supabase.cmd db push --linked --include-all
supabase.cmd migration list --linked
supabase.cmd db advisors --linked --type security
supabase.cmd db advisors --linked --type performance
```

Verify through read-only SQL or the dashboard:

- all exposed tables have RLS enabled;
- owner and pairing policies exist;
- `realtime.messages` policies target private topic `host:<hostId>`;
- public Realtime access is disabled;
- one hourly retention cron job exists and has a successful manual test run;
- no client bundle key has database-admin privileges;
- no advisor finding caused by this project is left unexplained.

- [ ] **Step 5: Update evidence, commit, push and pause**

Record only project ref suffix, region, migration status, policy counts, cron status and redacted advisor result. Never record keys or email addresses.

```powershell
git add docs/acceptance/windows-host-real-device.md
git commit -m "test(db): record nonproduction relay acceptance"
git push origin feat/windows-host
```

Pause for Checkpoint 5D-B acceptance. Vercel work does not start automatically.

---

## Checkpoint 5D-C: Authorized Vercel Preview and Cloud Host Package

### Task 6: Create the exact Vercel Preview configuration

**Files:**

- Create locally through Vercel CLI: `.vercel/project.json` or `apps/web/.vercel/project.json` (ignored)
- Modify if required by verified build behavior only: `apps/web/next.config.ts`
- Modify: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Perform read-only Vercel identity discovery**

Use the pinned CLI and authenticated Vercel interface to identify the exact team and confirm that `codex-remote-web-dev` does not conflict with an unrelated project. Inspect help before commands:

```powershell
npx.cmd --yes vercel@59.10.0 whoami
npx.cmd --yes vercel@59.10.0 link --help
npx.cmd --yes vercel@59.10.0 env --help
npx.cmd --yes vercel@59.10.0 deploy --help
```

Report team, project name, root directory, source branch, environment scope and intended secrets. Stop for Preview/VAPID authorization.

- [ ] **Step 2: Link the Preview project with monorepo settings**

Configure:

- Framework Preset: Next.js;
- Root Directory: `apps/web`;
- Include source files outside Root Directory: enabled;
- Node.js: 24;
- Production Branch remains untouched and receives no deployment;
- Preview source branch: `feat/windows-host`.

Do not add a `vercel.json` or change `next.config.ts` unless a local Vercel build proves the monorepo cannot resolve `packages/protocol`; if a change is required, add a failing regression test first and keep the fix scoped.

- [ ] **Step 3: Generate and store Preview-only environment values**

Generate one VAPID keypair without printing it. Add only to Vercel Preview scope:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
WEB_PUSH_VAPID_SUBJECT
WEB_PUSH_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY
```

The first two are browser-public. The remaining four are server-only; `SUPABASE_SERVICE_ROLE_KEY` may hold the exact project's current privileged server key format but must never use the name `NEXT_PUBLIC_*`.

- [ ] **Step 4: Deploy one Preview and verify its identity**

Deploy without `--prod`. Verify through both Vercel and HTTP:

- target is Preview;
- state is READY;
- source commit equals current `feat/windows-host` HEAD;
- hostname is HTTPS;
- `/login` renders;
- unauthenticated protected page redirects to login;
- unauthenticated push APIs return 401/403 without leaking configuration;
- service worker and manifest are reachable;
- build output contains no secret values.

After the final Preview hostname is known, update Supabase Site URL/redirect allowlist to that exact HTTPS origin and repeat one OTP login smoke test.

### Task 7: Build a versioned cloud-configured Windows Host package

**Files:**

- Modify: `apps/host/package.json`
- Modify: `package-lock.json`
- Modify: `docs/acceptance/windows-host-real-device.md`
- Generate ignored artifact: `apps/host/release/Codex Remote Host Setup 0.1.1.exe`

- [ ] **Step 1: Add a package-version assertion, then bump only the Host package**

Add or extend the package verification test so the installer version must be `0.1.1`. Bump `apps/host/package.json` from `0.1.0` to `0.1.1` and update `package-lock.json`. This avoids silently reinstalling a different cloud-configured binary under the same version.

- [ ] **Step 2: Build using public runtime configuration only**

In the packaging process set only:

```text
CODEX_REMOTE_SUPABASE_URL
CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY
CODEX_REMOTE_WEB_ORIGIN
CODEX_REMOTE_PROTOCOL_VERSION=1
```

Run:

```powershell
npm.cmd run package:host
npm.cmd run verify:host-package
```

Inspect the unpacked application and installer strings. Any privileged Supabase key, VAPID private key, SMTP credential, email, token, prompt, path or command blocks delivery.

- [ ] **Step 3: Verify, hash and request installation authorization**

Run package smoke checks and calculate SHA-256. Report installer path, version, hash and the fact that current-user version `0.1.0` remains installed. Ask for explicit authorization to update to `0.1.1`; do not uninstall first unless the installer fails and the user separately approves removal.

- [ ] **Step 4: Install/update only after authorization**

Close the running Host normally, execute the signed/verified current-user installer, then confirm:

- Programs list shows `0.1.1`;
- app launches under the current user;
- public runtime config points to the verified Supabase/Preview targets;
- login UI opens but no email/token is logged;
- no Windows service, inbound port, firewall rule or startup entry outside the existing current-user design was added.

- [ ] **Step 5: Commit, push and pause**

```powershell
git add apps/host/package.json package-lock.json docs/acceptance/windows-host-real-device.md
git commit -m "build(windows): package cloud preview host"
git push origin feat/windows-host
```

Pause for Checkpoint 5D-C acceptance before touching the Android device.

---

## Checkpoint 5D-D: Android Real-Device Acceptance

### Task 8: Validate the primary remote-control flow

**Files:**

- Modify: `docs/acceptance/windows-host-real-device.md`

- [ ] **Step 1: Prepare the real test environment**

On Windows: Host `0.1.1` running, Codex CLI smoke passed, one explicit writable workspace root authorized. On Android: current Chrome, VPN off, Wi-Fi off, mobile data on, Preview installed to home screen. The user personally enters email OTP; automation must not access email, password manager or notification history.

- [ ] **Step 2: Execute the complete user flow**

Verify in order:

1. PWA and Host sign into the same account independently;
2. Host generates a 5-minute pairing code and Android completes one-time pairing;
3. online/offline presence is accurate;
4. phone submits only `workspaceId`, and Host resolves it to the approved local root;
5. thread list and idle history load from the Windows Codex source of truth;
6. a new thread starts with local default model, `approvalPolicy=onRequest`, `workspaceWrite`;
7. streaming output arrives incrementally;
8. a follow-up instruction steers the active turn once without duplication;
9. an actual App Server approval shows only supported choices and one choice resolves correctly;
10. Stop requires confirmation and interrupts the active turn;
11. an externally running Desktop thread is labeled read-only and cannot be taken over;
12. an idle historical thread resumes and accepts a new turn.

Record only PASS/FAIL, timestamps, opaque IDs and sanitized error categories. Never record prompts, code, commands or paths.

### Task 9: Validate notifications and recovery

- [ ] **Step 1: Validate generic Web Push**

With Android locked, verify generic notifications for:

- waiting for approval;
- task completed;
- task failed.

Notification title/body must not contain path, command, code, prompt or model output. Clicking carries only `hostId` and an opaque event ID, opens the correct Host, and then fetches authoritative state.

- [ ] **Step 2: Validate recovery scenarios**

Test serially:

- switch mobile data to Wi-Fi and back;
- disable network briefly and restore;
- close and reopen the PWA;
- restart Windows Host;
- terminate only the Host-owned App Server process and let the Host apply its three-attempt backoff policy.

For every case verify snapshot recovery, event ordering, expired approval behavior, no duplicate command, and normal reconnection within 5 seconds where the network is available. If App Server fails three times, verify the Host stops looping and displays a diagnostic state.

### Task 10: Measure latency and close Task 5D

- [ ] **Step 1: Run 20 mobile-data control-message rounds**

Measure from command submission to reliable Host acknowledgement, excluding model inference. Record 20 numeric samples, failed rounds and reconnect samples without message content.

Calculate and record:

- P50 target: `≤ 1.5 s`;
- P95 target: `≤ 3 s`;
- normal reconnect target: `≤ 5 s`;
- maximum latency and failed-round count.

- [ ] **Step 2: Apply the architecture stop rule**

If optimized Supabase still exceeds P95 in two consecutive 20-round runs, stop feature expansion. Write a separate Cloudflare outbound-Tunnel transport plan; do not add Cloudflare code, expose a Windows port or mutate the current transport inside Task 5D.

- [ ] **Step 3: Run the final repository and cloud verification**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
npm.cmd run build
npm.cmd run test:e2e -- --workers=1
npm.cmd run verify:host-package
npm.cmd audit --audit-level=high
git diff --check
git status --short
```

Reverify read-only that Supabase is the exact non-production project, Vercel deployment is Preview/READY/current commit, public Realtime is disabled, cron is healthy, and no Production deployment exists.

- [ ] **Step 4: Complete evidence, commit, push and stop**

Update the acceptance matrix with pass/fail evidence, sanitized metrics, Preview URL, installer version/hash and unresolved limitations. Update the parent Windows packaging plan only to mark Checkpoint 5D complete if every mandatory row passes.

```powershell
git add docs/acceptance/windows-host-real-device.md docs/superpowers/plans/2026-08-26-windows-host-packaging.md
git commit -m "test(windows): record real device acceptance"
git push origin feat/windows-host
```

Report the required seven delivery fields and pause for final user acceptance. Do not create a PR, merge `main`, deploy Production or delete cloud resources.

## Required Delivery Report at Every Checkpoint

1. 本阶段完成的功能；
2. 修改或新增的文件；
3. 数据库、API 或配置变更；
4. 已完成的测试和验证；
5. 当前已知问题或注意事项；
6. 分支、Commit ID、Commit 信息、推送结果和 GitHub 分支链接；
7. 下一阶段及当前等待用户确认的事项。
