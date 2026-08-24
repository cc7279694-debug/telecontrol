# Android PWA Remote Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Android-first PWA that signs in with email OTP, pairs one browser device with the Windows Host, and controls Codex threads through the existing encrypted Supabase relay.

**Architecture:** The browser talks directly to Supabase with a publishable key, keeps its non-exportable P-256 private key in IndexedDB, and sends only encrypted command envelopes to the reliable queue. A new Host command runner decrypts those envelopes, calls the existing Codex App Server adapter, normalizes the result, and broadcasts encrypted events on the private `host:<hostId>` channel. Next.js server code is used only for the authenticated app shell and cookie refresh; it never receives device private keys, prompts, code, paths, or model output.

**Tech Stack:** Node.js 24, TypeScript 5.9.3 strict mode, Next.js 15.5.23 App Router, React 19.2.8, Tailwind CSS 4.3.3, shadcn/ui source components, Supabase JS 2.112.3, Supabase SSR 0.12.4, IndexedDB via idb 8.0.3, Vitest 3.2.7, React Testing Library 16.3.2, Playwright 1.62.1.

**Spec:** `docs/superpowers/plans/2026-08-23-codex-remote-mvp.md`

## Global Constraints

- Simplified Chinese only; one Supabase account, one Windows Host, and one Android browser device are the priority path.
- Do not expose a Supabase secret key or `service_role` key to `apps/web`; the browser receives only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Do not store plaintext prompts, model output, code, commands, or Windows paths in Supabase, browser caches, logs, analytics, or notifications.
- Keep Realtime channels private and authorize `realtime.messages` with the existing host/device link policies.
- The phone submits `workspaceId`; only the Windows Host resolves it to a local path.
- External Codex Desktop threads may be read when idle but must never be steered, interrupted, or approved while another client owns an active turn.
- Offline mode may show the static shell and last non-sensitive status only; creating commands while offline is disabled.
- Web Push, Vercel deployment, hosted Supabase creation, and real-device mobile-data acceptance remain outside this module unless the user separately authorizes them.
- Permanent Windows Host login UI and DPAPI-backed key persistence remain Module 5 work. Module 3 local acceptance uses a loopback-only development Host harness with an in-memory Host private key; it never writes that key or enables itself for a hosted Supabase URL.
- Implement in a new `feat/android-pwa` worktree based on commit `70196f6` or its accepted descendant. Do not merge or push `main`.
- Use pinned dependency versions and commit the updated `package-lock.json`.
- Stop for user acceptance after checkpoints 3A, 3B, and 3C.

## Chosen Design

The selected approach is direct browser-to-Supabase transport. A Next.js API proxy would add latency and create a server that can observe request timing and payload metadata without improving end-to-end encryption. Cloudflare direct transport remains a separate fallback only if measured Supabase latency fails the existing P95 target.

Current official constraints used by this plan:

- Supabase recommends cookie-backed `@supabase/ssr` for Next.js SSR, while documenting that the package API remains beta and should therefore be version-pinned: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side).
- Email OTP uses `signInWithOtp` plus `verifyOtp`; the hosted account must already exist because this MVP sets `shouldCreateUser: false`: [Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).
- Private Broadcast clients use `{ config: { private: true } }` and RLS policies on `realtime.messages`: [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).
- Supabase now locks the Realtime schema but still permits RLS policies on `realtime.messages`; migrations must not create or alter other Realtime objects: [Realtime schema change](https://supabase.com/changelog/realtime-schema-locked-down-against-modification).
- Next.js App Router supports a typed `app/manifest.ts` and a manually registered service worker: [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).

The module is intentionally split into three checkpoints:

1. **3A — Protocol and Host bridge:** browser-safe envelopes, normalized remote DTOs, database envelope metadata, and a tested Host command runner.
2. **3B — Authentication, device identity, and transport:** Next.js shell, OTP login, IndexedDB key custody, pairing, and the browser `RemoteClient`.
3. **3C — Console UI and PWA:** host/thread screens, timeline, composer, approval/stop controls, installable shell, and mobile acceptance.

---

### Task 1: Make the shared encrypted protocol browser-safe and typed

**Files:**

- Modify: `packages/protocol/src/envelope.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/crypto.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/sealed-envelope.ts`
- Create: `packages/protocol/src/sealed-envelope.test.ts`
- Modify: `packages/protocol/src/envelope.test.ts`

**Interfaces:**

- Produces: `WorkspaceSummary`, `RemoteThreadSummary`, `RemoteThreadSnapshot`, `RemoteTimelineItem`, `HostSnapshot`, and fully typed `RemoteEvent` variants.
- Produces: `sealRemotePayload<T extends RemoteCommand | RemoteEvent>()` and `openRemotePayload<T>()`.
- Consumes: existing P-256 ECDH/HKDF/AES-GCM helpers.

- [ ] **Step 1: Write failing browser-compatibility and envelope tests**

Add tests that import the package without a `node:crypto` dependency, round-trip a command, reject a changed `hostId`, reject a changed `kind`, reject expired envelopes, and parse every normalized event variant.

```ts
const envelope = await sealRemotePayload({
  key,
  hostId: "host-1",
  deviceId: "device-1",
  payload: { type: "thread.list", workspaceId: "workspace-1" },
  ttlMs: 30_000,
});

await expect(openRemotePayload({ key, envelope })).resolves.toEqual({
  type: "thread.list",
  workspaceId: "workspace-1",
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm.cmd exec -- vitest run packages/protocol/src/envelope.test.ts packages/protocol/src/sealed-envelope.test.ts`

Expected: FAIL because the sealed-envelope helpers and normalized event schemas do not exist and `envelope.ts` imports `node:crypto`.

- [ ] **Step 3: Define normalized browser-facing DTOs**

Use these exact minimum shapes; raw Codex App Server objects remain inside `apps/host`.

```ts
export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface RemoteThreadSummary {
  id: string;
  workspaceId: string;
  title: string;
  updatedAt: string;
  state: "idle" | "running" | "unknown";
  readOnly: boolean;
}

export interface RemoteTimelineItem {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  kind: "text" | "reasoning" | "command" | "fileChange" | "status";
  text: string;
  status?: "inProgress" | "completed" | "failed" | "interrupted";
}

export interface RemoteThreadSnapshot {
  id: string;
  workspaceId: string;
  title: string;
  state: "idle" | "running" | "unknown";
  readOnly: boolean;
  activeTurnId?: string;
  items: RemoteTimelineItem[];
}
```

Add `host.snapshot.result`, `thread.list.result`, and correlated error events. Command and event type names remain disjoint, and every response event carries `requestMessageId` so the PWA can reconcile queue receipts with authoritative state.

- [ ] **Step 4: Implement sealed envelopes with stable additional authenticated data**

Replace `randomUUID` from `node:crypto` with `globalThis.crypto.randomUUID()`. Build AES-GCM additional data from the immutable envelope header in this exact order:

```ts
JSON.stringify([
  protocolVersion,
  messageId,
  hostId,
  deviceId,
  kind,
  sentAt,
  expiresAt,
]);
```

`sealRemotePayload` validates the payload schema before encryption. `openRemotePayload` validates the envelope, checks expiry before decrypting, decrypts with the same AAD, and parses the plaintext as either `RemoteCommand` or `RemoteEvent` according to `kind`.

- [ ] **Step 5: Run protocol tests and build**

Run:

```powershell
npm.cmd exec -- vitest run packages/protocol/src
npm.cmd run typecheck
npm.cmd run build
```

Expected: all protocol tests pass and both Node and browser consumers compile without polyfills.

- [ ] **Step 6: Commit**

```powershell
git add packages/protocol
git commit -m "feat(protocol): add browser-safe encrypted wire contracts"
```

---

### Task 2: Preserve envelope metadata and allow safe device session rebinding

**Files:**

- Create via CLI: the exact migration path printed by `supabase.cmd migration new add_web_device_session`
- Modify: `supabase/tests/remote_transport.sql`
- Modify: `supabase/migrations/remote-transport-contract.test.ts`
- Modify: `apps/host/src/supabase-transport.ts`
- Modify: `apps/host/src/supabase-transport.test.ts`

**Interfaces:**

- Produces: `remote_commands.sent_at timestamptz not null` so the Host can reconstruct authenticated envelope headers.
- Produces: an owner-only device update policy that permits a new OTP session to bind an existing, non-revoked local device while keeping `public_key` immutable.
- Produces: `getLinkedDevice(deviceId)` on `SupabaseTransport`.

- [ ] **Step 1: Create the migration with the CLI**

Run: `supabase.cmd migration new add_web_device_session`

Use the filename generated by the CLI; do not invent a timestamp.

- [ ] **Step 2: Write failing pgTAP and transport tests**

Add tests proving:

- `sent_at` exists and is returned by `claim_remote_command`.
- an authenticated owner can change only `auth_session_id`, `last_online_at`, `notifications_enabled`, and `updated_at` on a non-revoked device;
- another owner cannot update the device;
- a revoked device cannot be rebound;
- `public_key` cannot be updated by the browser role;
- `getLinkedDevice` rejects an unpaired or revoked device.

- [ ] **Step 3: Implement the migration**

Backfill existing rows before enforcing `not null`:

```sql
alter table public.remote_commands add column sent_at timestamptz;
update public.remote_commands set sent_at = created_at where sent_at is null;
alter table public.remote_commands alter column sent_at set not null;

revoke update on public.devices from authenticated;
grant update (
  auth_session_id, last_online_at, notifications_enabled, updated_at
) on public.devices to authenticated;
```

Replace `devices_owner_update` with an owner-bound policy whose `USING` requires `revoked_at is null` and whose `WITH CHECK` requires `owner_id = auth.uid()`, `revoked_at is null`, and `auth_session_id = auth.jwt() ->> 'session_id'`.

- [ ] **Step 4: Update Host transport row mapping**

Include `protocol_version`, `sent_at`, and all envelope fields in `ClaimedCommand`. Add `getLinkedDevice(deviceId)` returning exactly `{ id, public_key, revoked_at }` only when an active `host_device_links` row exists for the connected Host.

- [ ] **Step 5: Reset and verify the local database**

Run:

```powershell
supabase.cmd db reset --local
npm.cmd run test:db
supabase.cmd db lint --local --fail-on error
```

Expected: migrations apply from zero, pgTAP passes, and database lint reports no schema errors.

- [ ] **Step 6: Commit**

```powershell
git add supabase apps/host/src/supabase-transport.ts apps/host/src/supabase-transport.test.ts
git commit -m "feat(transport): support browser device sessions"
```

---

### Task 3: Add the Host remote command runner and Codex event normalization

**Files:**

- Create: `apps/host/src/remote-command-runner.ts`
- Create: `apps/host/src/remote-command-runner.test.ts`
- Create: `apps/host/src/codex-event-mapper.ts`
- Create: `apps/host/src/codex-event-mapper.test.ts`
- Create: `apps/host/src/remote-thread-store.ts`
- Create: `apps/host/src/remote-thread-store.test.ts`
- Create: `apps/host/src/dev/local-remote-host-harness.ts`
- Modify: `apps/host/src/codex-app-server-adapter.ts`
- Modify: `apps/host/src/supabase-transport.ts`
- Modify: `apps/host/package.json`

**Interfaces:**

- Consumes: `SupabaseTransport`, `CodexAppServerAdapter`, Host P-256 private key, authorized workspaces, and `sealRemotePayload` / `openRemotePayload`.
- Produces: `RemoteCommandRunner.start()`, `stop()`, and `runOnce()`.
- Produces: `CodexEventMapper` that converts raw App Server thread/turn/item notifications into the normalized protocol types.

- [ ] **Step 1: Write command-dispatch and ownership tests**

Use fakes for transport and adapter. Cover every command type, malformed ciphertext, wrong device, expired command, duplicate message ID, external running thread rejection, idle history read, approval correlation, interrupt, and adapter failure.

```ts
await runner.runOnce();
expect(adapter.startTurn).toHaveBeenCalledWith({
  workspaceId: "workspace-1",
  threadId: "thread-1",
  text: "继续修复",
});
expect(transport.completeCommand).toHaveBeenCalledWith(
  expect.objectContaining({ status: "completed" }),
);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd exec -- vitest run apps/host/src/remote-command-runner.test.ts apps/host/src/codex-event-mapper.test.ts apps/host/src/remote-thread-store.test.ts`

Expected: FAIL because the runner, mapper, and ownership store do not exist.

- [ ] **Step 3: Implement normalized mapping and ownership rules**

`RemoteThreadStore` persists only thread IDs, workspace IDs, ownership, and last known running state in the Host configuration directory. It never persists prompts, model output, commands, code, or paths.

Normalize raw App Server data defensively. Missing or unknown fields produce `state: "unknown"` and `readOnly: true`; they must never grant write control. A thread created or resumed by this Host is writable only while the runner owns its active turn. An external thread reported as running remains read-only.

- [ ] **Step 4: Implement one-at-a-time reliable command execution**

`runOnce()` performs this sequence:

1. claim one queued command;
2. load the active linked device public key;
3. derive the AES key and reconstruct the full envelope;
4. decrypt and parse the command;
5. dispatch to the adapter;
6. send a correlated encrypted event or authoritative snapshot;
7. complete the queue row as `completed`, `failed`, or `expired`.

The polling loop waits 250 ms when no command is available, processes one command at a time, and never retries a leased command after an ambiguous Host or App Server failure.

- [ ] **Step 5: Forward streaming and approval events**

Subscribe to adapter notifications and approval requests. Aggregate text deltas for at most 100 ms or 16 KB, attach a monotonically increasing sequence per turn, encrypt the normalized event, and broadcast it to the linked device. Approval requests include only the App Server method, opaque request ID, sanitized display metadata, and the decisions allowed by the protocol.

- [ ] **Step 6: Add a loopback-only development Host harness**

The harness starts only when Supabase URL host is `127.0.0.1` or `localhost`. It creates an in-memory Host key, registers the local Host, prints the five-minute pairing code, and composes the real command runner with either the mock App Server fixture or the pinned local Codex CLI. It must fail closed for any hosted URL and must never print Supabase keys, JWTs, refresh tokens, or the Host private key.

- [ ] **Step 7: Run Host and protocol verification**

Run:

```powershell
npm.cmd exec -- vitest run apps/host/src packages/protocol/src
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all tests pass; logs contain no plaintext fixtures outside tests.

- [ ] **Step 8: Commit and pause at checkpoint 3A**

```powershell
git add apps/host packages/protocol supabase package-lock.json
git commit -m "feat(host): execute encrypted remote commands"
```

Report checkpoint 3A using the seven-item module delivery format and wait for user acceptance before Task 4.

---

### Task 4: Scaffold the Next.js 15 PWA and email OTP authentication

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/features/auth/otp-login-form.tsx`
- Create: `apps/web/src/features/auth/otp-login-form.test.tsx`
- Create: `apps/web/src/lib/supabase/browser.ts`
- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/supabase/middleware.ts`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/utils.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `createBrowserSupabaseClient()` and `createServerSupabaseClient()` using `@supabase/ssr` cookies.
- Produces: two-step OTP form using `signInWithOtp` and `verifyOtp`.

- [ ] **Step 1: Add pinned web dependencies**

Pin these versions in `apps/web/package.json`: Next 15.5.23, React/React DOM 19.2.8, Supabase JS 2.112.3, Supabase SSR 0.12.4, idb 8.0.3, Tailwind CSS and `@tailwindcss/postcss` 4.3.3, PostCSS 8.5.26, lucide-react 1.33.0, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.6.0, next-themes 0.4.6, React Testing Library 16.3.2, jest-dom 7.0.1, user-event 14.6.6, jsdom 30.0.1, and Playwright 1.62.1.

- [ ] **Step 2: Write failing auth and environment tests**

Test invalid email, OTP request loading state, six-digit verification, Supabase error translation, redirect to `/hosts`, missing public environment variables, and rejection of any `service_role`-named variable in browser configuration.

- [ ] **Step 3: Implement Supabase SSR clients and protected routing**

Use cookie-backed browser/server clients. Middleware refreshes the session and redirects unauthenticated requests under `/hosts` or `/pair` to `/login`. Server authorization uses `auth.getClaims()` or `auth.getUser()`, never unverified cookie data.

- [ ] **Step 4: Implement the Chinese two-step OTP screen**

Request codes with:

```ts
supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false },
});
```

Verify with `verifyOtp({ email, token, type: "email" })`. Show rate-limit and expiry errors without exposing provider internals. Preserve the email locally only until verification finishes.

- [ ] **Step 5: Add the minimal design system foundation**

Use a neutral grayscale theme, 44 px minimum touch targets, system font fallback, visible focus rings, safe-area padding, and the shadcn source patterns for Button, Input, Card, Badge, Dialog, Textarea, ScrollArea, and Skeleton. Do not add a runtime dependency on a component registry.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm.cmd exec -- vitest run apps/web/src/features/auth
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Commit: `feat(web): add PWA shell and OTP authentication`

---

### Task 5: Implement non-exportable device identity and pairing

**Files:**

- Create: `apps/web/src/features/device/device-key-store.ts`
- Create: `apps/web/src/features/device/device-key-store.test.ts`
- Create: `apps/web/src/features/device/device-registry.ts`
- Create: `apps/web/src/features/device/device-registry.test.ts`
- Create: `apps/web/src/features/pairing/pairing-service.ts`
- Create: `apps/web/src/features/pairing/pairing-service.test.ts`
- Create: `apps/web/src/features/pairing/pairing-form.tsx`
- Create: `apps/web/src/features/pairing/pairing-form.test.tsx`
- Create: `apps/web/src/app/pair/page.tsx`
- Modify: `packages/protocol/src/crypto.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `apps/host/src/supabase-transport.ts`

**Interfaces:**

- Produces: `DeviceIdentityStore.load(ownerId)`, `save(identity)`, and `clear(ownerId)`.
- Produces: `DeviceRegistry.ensureRegistered()` and `rebindSession()`.
- Produces: `PairingService.consume({ hostId, code, deviceId })`.

- [ ] **Step 1: Write failing key custody tests**

Test that the private key is non-exportable, survives an IndexedDB round-trip as a `CryptoKey`, is scoped by owner ID, and is deleted on explicit device reset. Test that local storage contains no private JWK or shared AES key.

- [ ] **Step 2: Move pairing-code hashing into the shared protocol**

Export `hashPairingCode(code: string): Promise<string>` from `packages/protocol`. Both Host and PWA use the same lowercase SHA-256 hex implementation; remove the Host-local duplicate.

- [ ] **Step 3: Register or rebind the browser device**

Use `auth.getClaims()` to obtain verified `sub` and `session_id`. On first use, generate the P-256 key pair, insert the public JWK into `devices`, then persist the non-exportable private `CryptoKey` and returned `deviceId` in IndexedDB. On a later OTP session, update only the allowed session columns on the existing non-revoked device.

- [ ] **Step 4: Consume the one-time pairing request**

Validate a six-digit code, hash it locally, call `consume_pairing_request`, fetch the paired Host public JWK through RLS, derive the AES key, and immediately send `host.snapshot`. Map expired, already-used, wrong-Host, revoked-device, and offline errors to concise Chinese messages.

- [ ] **Step 5: Verify pairing security**

Run focused unit tests plus `npm.cmd run test:db`. Inspect the production browser bundle and fail if it contains `service_role`, a secret key variable, private JWK material, or test credentials.

- [ ] **Step 6: Commit**

Commit: `feat(web): add secure device pairing`

---

### Task 6: Implement the browser RemoteClient and recovery snapshot

**Files:**

- Create: `apps/web/src/features/remote/remote-client.ts`
- Create: `apps/web/src/features/remote/remote-client.test.ts`
- Create: `apps/web/src/features/remote/remote-client-context.tsx`
- Create: `apps/web/src/features/remote/remote-reducer.ts`
- Create: `apps/web/src/features/remote/remote-reducer.test.ts`

**Interfaces:**

```ts
export interface RemoteClient {
  connect(input: { hostId: string; deviceId: string }): Promise<void>;
  disconnect(): Promise<void>;
  enqueue(command: RemoteCommand): Promise<CommandReceipt>;
  subscribe(handler: (event: RemoteEvent) => void): () => void;
  getPresence(hostId: string): Promise<HostPresence>;
  requestSnapshot(): Promise<CommandReceipt>;
}
```

- [ ] **Step 1: Write failing transport tests**

Cover private-channel subscription, `realtime.setAuth()`, encrypted queue insert, deterministic idempotency keys, duplicate receipts, envelope expiry, wrong-device events, decryption failure, sequence gaps, reconnect, offline command rejection, and snapshot recovery.

- [ ] **Step 2: Implement direct Supabase transport**

Load the device identity and linked Host public key, derive the session AES key, subscribe to `host:<hostId>` with `{ config: { private: true } }`, and parse only decrypted `RemoteEvent` values. Commands are always inserted into `remote_commands`; Broadcast is never used for approvals, interrupts, or text commands.

- [ ] **Step 3: Implement reducer-based authoritative state**

Keep decrypted content only in React memory. Store only `{ hostId, online, lastTurnStatus, observedAt }` as offline metadata. On reconnect, event-sequence gap, tab resume, or channel error recovery, enqueue `host.snapshot` and replace local state with the returned snapshot.

- [ ] **Step 4: Verify and commit at checkpoint 3B**

Run web, protocol, Host, and database tests; typecheck, lint, and build. Commit: `feat(web): add encrypted browser remote client`.

Report checkpoint 3B and wait for user acceptance before Task 7.

---

### Task 7: Build Host, workspace, and thread navigation

**Files:**

- Create: `apps/web/src/app/hosts/page.tsx`
- Create: `apps/web/src/app/hosts/[hostId]/page.tsx`
- Create: `apps/web/src/app/hosts/[hostId]/threads/[threadId]/page.tsx`
- Create: `apps/web/src/features/hosts/host-card.tsx`
- Create: `apps/web/src/features/hosts/host-card.test.tsx`
- Create: `apps/web/src/features/threads/thread-list.tsx`
- Create: `apps/web/src/features/threads/thread-list.test.tsx`
- Create: `apps/web/src/features/threads/new-thread-dialog.tsx`
- Create: `apps/web/src/components/app-shell.tsx`

**Interfaces:**

- Consumes: `HostSnapshot`, `WorkspaceSummary`, `RemoteThreadSummary`, and `RemoteClient`.
- Produces: mobile navigation from Host to workspace to thread without exposing local Windows paths.

- [ ] **Step 1: Write UI state tests**

Test empty account, unpaired device, Host online/offline, workspace selection, loading skeleton, empty thread list, idle/read-only/running badges, pagination cursor, and new-thread disabled state while offline.

- [ ] **Step 2: Implement the Host and workspace screen**

Show Host name, online state, last observation time, protocol mismatch, and authorized workspace display names. Never render a local path. If no paired Host exists, route to `/pair`.

- [ ] **Step 3: Implement thread list and creation**

Enqueue `thread.list` per selected workspace. Show title, last update, ownership state, and read-only warning. New thread requires an online Host and explicit workspace selection; navigate only after the authoritative `thread.snapshot` event arrives.

- [ ] **Step 4: Verify and commit**

Commit: `feat(web): add Host and thread navigation`

---

### Task 8: Build the timeline, composer, approvals, and stop controls

**Files:**

- Create: `apps/web/src/features/thread/thread-timeline.tsx`
- Create: `apps/web/src/features/thread/thread-timeline.test.tsx`
- Create: `apps/web/src/features/thread/thread-composer.tsx`
- Create: `apps/web/src/features/thread/thread-composer.test.tsx`
- Create: `apps/web/src/features/thread/approval-card.tsx`
- Create: `apps/web/src/features/thread/approval-card.test.tsx`
- Create: `apps/web/src/features/thread/stop-turn-dialog.tsx`
- Create: `apps/web/src/features/thread/stop-turn-dialog.test.tsx`
- Create: `apps/web/src/features/thread/thread-screen.tsx`

**Interfaces:**

- Consumes: normalized snapshots, deltas, turn status, approval requests, and command receipts.
- Produces: `turn.start`, `turn.steer`, `turn.interrupt`, and `approval.respond` commands.

- [ ] **Step 1: Write interaction tests**

Cover initial thread read, ordered stream deltas, duplicate sequence suppression, in-progress state, send versus steer, whitespace rejection, keyboard-safe composer, offline disable, read-only external thread, approval decisions, expired approval, and two-step stop confirmation.

- [ ] **Step 2: Implement structured timeline rendering**

Render text, reasoning summaries, command/file-change status, and failures as distinct accessible items. Do not render raw unknown JSON. Auto-scroll only when the user is already near the bottom; preserve manual reading position.

- [ ] **Step 3: Implement composer and task controls**

Use `turn.start` when no active turn exists and `turn.steer` when the Host-owned turn is active. Disable send while offline or read-only. The Stop button opens a confirmation dialog before enqueuing `turn.interrupt`.

- [ ] **Step 4: Implement approval cards**

Render only decisions present in the protocol: allow once, allow for this session, reject, and cancel. Once submitted or expired, make the card inert and request an authoritative snapshot.

- [ ] **Step 5: Verify and commit**

Commit: `feat(web): add remote Codex console controls`

---

### Task 9: Make the app installable and safely useful offline

**Files:**

- Create: `apps/web/src/app/manifest.ts`
- Create: `apps/web/src/app/offline/page.tsx`
- Create: `apps/web/src/components/service-worker-register.tsx`
- Create: `apps/web/src/components/install-prompt.tsx`
- Create: `apps/web/public/sw.js`
- Create: `apps/web/public/icons/icon-192.png`
- Create: `apps/web/public/icons/icon-512.png`
- Create: `apps/web/public/icons/icon-maskable-512.png`
- Create: `apps/web/src/features/pwa/offline-status.ts`
- Create: `apps/web/src/features/pwa/offline-status.test.ts`

**Interfaces:**

- Produces: installable standalone PWA with static offline fallback.
- Consumes: non-sensitive status metadata only.

- [ ] **Step 1: Write manifest and offline-policy tests**

Assert standalone display, 192/512/maskable icons, Chinese name, theme colors, static offline fallback, and a denylist preventing cache writes for Supabase, Auth, Realtime, API routes, encrypted envelopes, and thread pages.

- [ ] **Step 2: Implement the service worker**

Cache only versioned static assets, icons, and `/offline`. Use network-only handling for Supabase and authenticated routes. On navigation failure, show `/offline`, which reads only the last Host online/task status from IndexedDB and cannot create commands.

- [ ] **Step 3: Implement install guidance**

Show Android Chrome installation instructions only when the app is not already running in standalone mode. Do not block normal browser use when installation is unavailable.

- [ ] **Step 4: Verify and commit**

Commit: `feat(web): add installable offline PWA shell`

---

### Task 10: Run browser and module acceptance

**Files:**

- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/auth.spec.ts`
- Create: `apps/web/e2e/mobile-console.spec.ts`
- Create: `apps/web/e2e/pwa.spec.ts`
- Create: `apps/web/e2e/helpers/local-supabase.ts`
- Modify: `package.json`
- Modify: `README.md` if present; otherwise create `apps/web/README.md`

**Interfaces:**

- Produces: repeatable local acceptance commands without committed credentials.

- [ ] **Step 1: Add safe local test setup**

The helper must fail closed unless Supabase URL, Mailpit URL, and database host are loopback addresses. It may obtain local test credentials in memory from Supabase CLI output, but must never print or write them. It creates the test Auth user through the local Admin API and reads the OTP from local Mailpit only.

- [ ] **Step 2: Add responsive browser tests**

Test 360×800, 390×844, and 1280×800. Assert no horizontal overflow, 44 px touch targets, visible focus, composer visibility with mobile keyboard-sized viewport, dark/light themes, online/offline state, approval dialog, stop confirmation, manifest, icons, and service-worker registration.

- [ ] **Step 3: Run the complete local gate**

Run:

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
git status --short
```

Expected: every command passes, except any pre-existing formatting debt must be reported separately and must not be expanded by this module.

- [ ] **Step 4: Inspect security-sensitive build output**

Search `.next/static` for `service_role`, `sb_secret_`, test email addresses, Windows paths, and private JWK fields. Expected: no matches. Confirm all Realtime subscriptions use `private: true` and all commands use the reliable queue.

- [ ] **Step 5: Final commit and checkpoint 3C handoff**

```powershell
git add apps/web apps/host packages/protocol supabase package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "feat(web): complete Android PWA remote console"
```

Do not create a Vercel project, deploy a Preview, push a branch, open a PR, or merge `main` without separate authorization. Report checkpoint 3C using the seven-item module delivery format and wait for user acceptance.

## Acceptance Boundary

Module 3 is accepted locally when:

- email OTP login works against local Supabase/Mailpit;
- the browser stores a non-exportable private key in IndexedDB and pairs through the one-time code;
- encrypted commands traverse the reliable queue and the Host runner invokes the mocked and real local Codex adapter paths;
- thread list/read/start/resume, turn start/steer/interrupt, stream events, and approvals render correctly;
- offline mode cannot enqueue commands and caches no sensitive content;
- 360 px and 390 px browser tests have no horizontal overflow;
- all local code, database, build, and browser checks pass.

Hosted Supabase RLS/Realtime, Vercel Preview, Android mobile-data latency, lock-screen notifications, and real Windows installer acceptance remain explicit later gates.
