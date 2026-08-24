import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("./20260823144357_encrypted_remote_transport.sql", import.meta.url),
  "utf8",
);
const sessionMigration = readFileSync(
  new URL("./20260824020757_add_web_device_session.sql", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };

describe("encrypted remote transport migration contract", () => {
  it("binds database access to the Supabase Auth session", () => {
    expect(migration).toContain("auth_session_id text not null");
    expect(migration).toContain("private.has_active_client_session");
    expect(migration).toContain("auth.jwt() ->> 'session_id'");
  });

  it("does not automatically retry leased commands", () => {
    expect(migration).toContain("and c.status = 'queued'");
    expect(migration).not.toContain(
      "c.status = 'leased' and c.lease_expires_at < now()",
    );
    expect(migration).toContain(
      "create or replace function public.complete_remote_command",
    );
    expect(migration).not.toContain("create policy commands_owner_update");
    expect(migration).not.toContain(
      "grant select, insert, update on public.remote_commands",
    );
  });

  it("provides guarded pairing functions without exposing private tables", () => {
    expect(migration).toContain(
      "create or replace function public.create_pairing_request",
    );
    expect(migration).toContain(
      "create or replace function public.consume_pairing_request",
    );
    expect(migration).toContain(
      "revoke all on all tables in schema private from anon, authenticated",
    );
    expect(migration).toContain("and h.revoked_at is null");
    expect(migration).toContain("and d.revoked_at is null");
    expect(migration).toContain(
      "grant usage on schema private to authenticated",
    );
  });

  it("enforces the remote command state machine in the database", () => {
    expect(migration).toContain(
      "create or replace function private.enforce_remote_command_transition",
    );
    expect(migration).toContain(
      "create trigger remote_commands_enforce_transition",
    );
    expect(migration).toContain("Invalid command status transition");
  });

  it("keeps high-privilege functions out of the public API surface", () => {
    expect(migration).toContain(
      "create or replace function private.has_active_client_session",
    );
    expect(migration).toContain("set search_path = ''");
    expect(migration).not.toMatch(
      /create or replace function public\.[\s\S]*?security definer/,
    );
  });

  it("provides the executable Supabase database test entry point", () => {
    expect(packageJson.scripts?.["test:db"]).toBe("supabase test db --local");
  });

  it("preserves authenticated envelope metadata and narrows device updates", () => {
    expect(sessionMigration).toContain(
      "alter table public.remote_commands add column sent_at timestamptz",
    );
    expect(sessionMigration).toContain(
      "grant update (\n  auth_session_id, last_online_at, notifications_enabled, updated_at",
    );
    expect(sessionMigration).toContain("revoked_at is null");
    expect(sessionMigration).toContain(
      "auth_session_id = (select auth.jwt() ->> 'session_id')",
    );
  });
});
