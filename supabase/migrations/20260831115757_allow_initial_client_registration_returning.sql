-- The first Host/Device registration uses INSERT ... RETURNING through the
-- Supabase Data API. The original SELECT policies only allowed rows when the
-- owner already had an active client session, so the first registration was
-- inserted but the returned row was rejected by RLS with 42501.
--
-- Keep the existing session guard and add a direct match for the current
-- authenticated session. This permits a client to read its own newly-created
-- row while keeping other owners and other sessions excluded.

drop policy if exists hosts_owner_select on public.hosts;
create policy hosts_owner_select on public.hosts
  for select to authenticated
  using (
    (
      owner_id = (select auth.uid())
      and auth_session_id = (select auth.jwt() ->> 'session_id')
      and revoked_at is null
    )
    or (select private.has_active_client_session(owner_id))
  );

drop policy if exists devices_owner_select on public.devices;
create policy devices_owner_select on public.devices
  for select to authenticated
  using (
    (
      owner_id = (select auth.uid())
      and auth_session_id = (select auth.jwt() ->> 'session_id')
      and revoked_at is null
    )
    or (select private.has_active_client_session(owner_id))
  );
