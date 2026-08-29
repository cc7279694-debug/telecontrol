# Next.js 15 Security Dependency Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for the manifest policy change, superpowers:systematic-debugging for any install/build/audit failure, and superpowers:verification-before-completion before the module report. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 Checkpoint 5C 的 3 个 high 生产依赖漏洞，同时保留 Next.js 15、React 19 和现有 PWA/Host 架构，不引入 Next.js 16 的破坏性迁移。

**Architecture:** 将 `next` 从 `15.5.23` 精确升级到 `15.5.24`，并在根 `package.json` 中仅针对 `next@15.5.24` 覆盖 `postcss@8.5.26` 和 `sharp@0.35.3`。Next 15.5.24 的可选依赖范围已显式允许 Sharp 0.35.3；PostCSS 保持 8.x 主版本，通过 Web 构建、PWA E2E、Host 打包烟雾和生产依赖审计验证兼容性。

**Tech Stack:** Node.js 24、npm 11.5.1 workspaces、Next.js 15.5.24、React 19.2.8、PostCSS 8.5.26、Sharp 0.35.3、TypeScript 5.9.3、Vitest 3.2.7、Playwright 1.62.1、Electron 44.0.0。

**Spec:** `docs/superpowers/plans/2026-08-28-windows-installer-checkpoint-5c.md` 的 Task 5 生产依赖审计门禁，以及 GitHub Advisory `GHSA-fxqj-rqcc-2cmp`、`GHSA-r28c-9q8g-f849`、`GHSA-f88m-g3jw-g9cj`。

## Global Constraints

- 技术栈继续固定为 Next.js 15；本计划禁止升级 Next.js 16。
- 不运行 `npm audit fix` 或 `npm audit fix --force`，不使用 `--legacy-peer-deps` 或 `--force` 绕过解析错误。
- 不添加 audit ignore、白名单或降低 5C 门禁；`npm.cmd audit --omit=dev` 必须退出 0。
- 不升级 React、React DOM、Supabase、Tailwind、Electron、Codex CLI 或其他无关依赖。
- 只允许修改根依赖策略、Web 的 Next.js 精确版本、锁文件和一个依赖策略测试。
- 当前工作树已有未提交的 5C 文档；依赖模块不得改写、暂存或提交这些文档。
- 不创建或修改 Hosted Supabase、Vercel、VAPID、Preview、Production 或真实用户数据。
- 不人工安装或卸载 Windows Host；依赖模块只验证解包版打包与烟雾测试。
- 若 Next 15.5.24 加精确覆盖仍无法使 audit、构建或 E2E 全部通过，立即停止并另写 Next.js 16 迁移计划，不扩大覆盖范围。
- 只提交并推送 `feat/windows-host`，不创建 PR，不合并或推送 `main`。

## Chosen Versions and Evidence

| 依赖             | 当前版本  | 目标版本  | 原因                                                               |
| ---------------- | --------- | --------- | ------------------------------------------------------------------ |
| `next`           | `15.5.23` | `15.5.24` | 保持 Next.js 15，并使用显式允许 Sharp 0.35.3 的最新已核对补丁版本  |
| `next > postcss` | `8.4.31`  | `8.5.26`  | PostCSS `<=8.5.22` 仍受当前审计公告影响；8.5.26 已高于全部补丁下限 |
| `next > sharp`   | `0.34.5`  | `0.35.3`  | Sharp `<0.35.0` 受影响；官方公告建议升级到 0.35.3                  |

实施开始时重新执行 `npm.cmd view next@15.5 version --json`。如果出现比 `15.5.24` 更新的 15.x 补丁，不自动换版本；先比较其 `dependencies.postcss`、`optionalDependencies.sharp` 和官方发布说明，再更新本计划。

## File Map

- `package.json`：新增只针对 `next@15.5.24` 的 `overrides`。
- `apps/web/package.json`：把 `next` 精确版本改为 `15.5.24`。
- `package-lock.json`：解析 Next 15.5.24、PostCSS 8.5.26 和 Sharp 0.35.3。
- `apps/web/src/lib/dependency-security.test.ts`：固定允许的 Next 主版本和两个安全覆盖，不测试 npm Registry。

---

### Task 1: Protect the dirty 5C handoff and add a failing dependency policy test

**Files:**

- Create: `apps/web/src/lib/dependency-security.test.ts`
- Do not modify: `apps/host/README.md`
- Do not modify: `docs/windows-host-user-guide.md`
- Do not modify: `docs/acceptance/windows-host-real-device.md`
- Do not modify: `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`

**Interfaces:**

- Consumes: root and Web workspace package manifests.
- Produces: a policy test that fails unless the exact Next 15 remediation is present.

- [ ] **Step 1: Snapshot the current dirty files and branch**

Run:

```powershell
git status --short --branch
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: branch `feat/windows-host`; only the existing 5C documentation is dirty/untracked. If a dependency manifest or source file is already dirty, stop and report the overlap.

- [ ] **Step 2: Write the failing manifest policy test**

Create `apps/web/src/lib/dependency-security.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as Record<string, unknown>;
}

describe("Next.js production dependency policy", () => {
  it("keeps Next 15 and pins the audited transitive fixes", () => {
    const rootPackage = readJson("package.json") as {
      overrides?: Record<string, unknown>;
    };
    const webPackage = readJson("apps/web/package.json") as {
      dependencies?: Record<string, string>;
    };

    expect(webPackage.dependencies?.next).toBe("15.5.24");
    expect(rootPackage.overrides).toEqual({
      "next@15.5.24": {
        postcss: "8.5.26",
        sharp: "0.35.3",
      },
    });
    expect(webPackage.dependencies).not.toHaveProperty("postcss");
    expect(webPackage.dependencies).not.toHaveProperty("sharp");
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/lib/dependency-security.test.ts --pool=forks --maxWorkers=1
```

Expected: FAIL because Web still uses `next@15.5.23` and the root manifest has no scoped overrides.

---

### Task 2: Apply the smallest Next 15 manifest and lockfile change

**Files:**

- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Test: `apps/web/src/lib/dependency-security.test.ts`

**Interfaces:**

- Consumes: npm workspace dependency resolution.
- Produces: one resolved dependency tree with Next 15.5.24, PostCSS 8.5.26 and Sharp 0.35.3.

- [ ] **Step 1: Change only the two manifests**

Change `apps/web/package.json`:

```json
"next": "15.5.24"
```

Add to root `package.json` after `workspaces`:

```json
"overrides": {
  "next@15.5.24": {
    "postcss": "8.5.26",
    "sharp": "0.35.3"
  }
}
```

Do not add PostCSS or Sharp as direct Web dependencies.

- [ ] **Step 2: Resolve the lockfile once**

Run from the repository root:

```powershell
npm.cmd install
```

Do not rerun with `--force` if npm rejects the override. Stop and preserve the error for review.

- [ ] **Step 3: Inspect the dependency-only diff**

Run:

```powershell
git diff -- package.json apps/web/package.json package-lock.json apps/web/src/lib/dependency-security.test.ts
npm.cmd ls next postcss sharp --all
npm.cmd explain postcss
npm.cmd explain sharp
```

Required resolved state:

```text
next@15.5.24
postcss@8.5.26
sharp@0.35.3
```

The lockfile must not upgrade unrelated top-level dependencies. If unrelated versions change, stop and review the exact lockfile diff before continuing.

- [ ] **Step 4: Verify GREEN and the production audit**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/lib/dependency-security.test.ts --pool=forks --maxWorkers=1
npm.cmd audit --omit=dev
```

Expected: the focused test passes and npm audit reports zero production vulnerabilities. Any remaining vulnerability is a hard stop; do not add an ignore entry.

---

### Task 3: Prove Web and repository compatibility

**Files:**

- No new files.
- Verify: `apps/web`, shared protocol, Supabase tests and repository gates.

**Interfaces:**

- Consumes: the resolved dependency tree from Task 2.
- Produces: evidence that the PostCSS override and Sharp native package do not change application behavior.

- [ ] **Step 1: Run static and unit gates**

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --pool=forks --maxWorkers=1
npm.cmd run test:db
```

Expected: all commands exit 0. Use the existing local Supabase/Docker environment for `test:db`; do not apply hosted migrations.

- [ ] **Step 2: Build every workspace with disposable public values**

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-key'
npm.cmd run build
```

Expected: Next.js remains on 15.5.24, Web and Host builds both exit 0, and no secret or `.env` file is created.

- [ ] **Step 3: Run Web and Host E2E**

```powershell
npm.cmd run test:e2e --workspace @codex-remote/web
npm.cmd run test:e2e --workspace @codex-remote/host
```

Expected: OTP/session middleware, PWA shell, Host desktop flow and recovery tests all pass. A Next middleware warning is recorded but does not authorize a Next 16 migration.

---

### Task 4: Prove Windows packaging compatibility without installing

**Files:**

- No tracked file changes.
- Generated and ignored: `apps/host/public-runtime.json`, `.package-resources/`, `release/`.

**Interfaces:**

- Consumes: the updated npm tree and existing 5C package scripts.
- Produces: a verified unpacked Host artifact; no current-user installation state.

- [ ] **Step 1: Build the unpacked package with disposable loopback config**

```powershell
$env:CODEX_REMOTE_SUPABASE_URL='http://127.0.0.1:54321'
$env:CODEX_REMOTE_SUPABASE_PUBLISHABLE_KEY='public-key'
$env:CODEX_REMOTE_WEB_ORIGIN='http://127.0.0.1:3000'
$env:CODEX_REMOTE_PROTOCOL_VERSION='1'
npm.cmd run package:dir --workspace @codex-remote/host
```

- [ ] **Step 2: Audit and smoke-test the unpacked Host**

```powershell
npm.cmd run package:verify --workspace @codex-remote/host -- --allow-missing-installer
npm.cmd run package:smoke --workspace @codex-remote/host
```

Expected: x64 package audit and bounded packaged smoke both pass. Do not run the NSIS installer and do not modify the login startup setting.

- [ ] **Step 3: Re-run the security gate after packaging**

```powershell
npm.cmd audit --omit=dev
git diff --check
git status --short --branch
```

Expected: audit remains at zero, dependency files plus the new policy test are the only new dependency-module changes, and pre-existing 5C documentation remains separate.

---

### Task 5: Commit the isolated remediation and pause for review

**Files:**

- Commit: `package.json`
- Commit: `apps/web/package.json`
- Commit: `package-lock.json`
- Commit: `apps/web/src/lib/dependency-security.test.ts`
- Do not stage: existing 5C README, guide, acceptance record or parent-plan changes.

**Interfaces:**

- Produces: one reviewable security remediation commit on `feat/windows-host`.
- Leaves: Checkpoint 5C documentation and final NSIS regeneration for the next accepted module.

- [ ] **Step 1: Verify the exact staged scope**

```powershell
git add package.json apps/web/package.json package-lock.json apps/web/src/lib/dependency-security.test.ts
git diff --cached --check
git diff --cached --stat
git status --short --branch
```

Expected: exactly four dependency-module files are staged. If any 5C document is staged, unstage it before committing.

- [ ] **Step 2: Commit and push the feature branch**

```powershell
git commit -m "fix(deps): remediate Next.js production audit"
git push origin feat/windows-host
```

Do not create a PR or touch `main`.

- [ ] **Step 3: Report and pause**

Report:

1. Next/PostCSS/Sharp old and new versions;
2. resolved dependency tree;
3. `npm audit --omit=dev` result;
4. unit, database, build, Web E2E, Host E2E and unpacked package results;
5. exact four-file dependency commit scope;
6. existing uncommitted 5C documentation status;
7. branch, Commit ID, push result and GitHub branch link.

Pause for acceptance. Do not regenerate the final NSIS installer, update its SHA-256, commit the 5C handoff or begin manual installation until the dependency remediation is accepted.

## Alternatives Considered

### Upgrade to Next.js 16.3.3

Rejected for this remediation because it changes the fixed Next.js 15 stack and introduces a separate migration surface: Turbopack becomes the default, `middleware` is renamed/deprecated in favor of `proxy`, and async request APIs become mandatory. It remains the fallback only if the scoped Next 15 remediation fails its gates.

### Ignore the advisories or accept the current risk

Rejected because Checkpoint 5C explicitly requires a clean production audit. The Sharp advisory affects versions below 0.35.0, while the PostCSS advisories include file-read/path-traversal risks in affected versions; an audit exception would hide rather than fix the dependency tree.

### Wait for a future Next.js 15 patch

Rejected as the primary path because it leaves the release gate blocked for an unknown period. The plan already uses the latest verified Next 15 patch and validates a narrow same-major PostCSS override instead.

## Rollback and Stop Conditions

- Before commit: if install, audit, build, E2E or package smoke fails, stop with the exact diff and error; do not use force flags and do not alter the pre-existing 5C documents.
- After commit but before merge: use a normal `git revert <commit>` if the user explicitly requests rollback; never reset or overwrite remote history.
- Three failed fix attempts indicate the scoped override approach is not viable. Stop and plan the Next.js 16 migration as a separate architectural module.

## Self-Review Checklist

- Scope keeps Next.js 15 and changes only three dependency versions.
- No audit ignore, force install, broad refresh or hosted environment write is allowed.
- The plan protects the existing dirty 5C documentation from accidental staging.
- The PostCSS override is tested through CSS/Next build and Web E2E, not trusted solely because it shares major version 8.
- The Sharp update is tested on Windows/Node 24 and through Next build.
- Host packaging compatibility is verified without installation.
- A failed scoped remediation stops before any Next.js 16 migration.
