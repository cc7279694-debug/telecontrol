import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("./20260823144357_encrypted_remote_transport.sql", import.meta.url),
  "utf8",
);

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
  });
});
