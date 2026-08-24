-- Preserve the immutable envelope header so the Host can authenticate the
-- exact command metadata after the queue row has been claimed.
alter table public.remote_commands add column sent_at timestamptz;
update public.remote_commands
set sent_at = created_at
where sent_at is null;
alter table public.remote_commands alter column sent_at set not null;

-- A browser session may rebind its existing device after OTP verification,
-- but it may not replace the public key or revoke/rename the device.
revoke update on public.devices from authenticated;
grant update (
  auth_session_id, last_online_at, notifications_enabled, updated_at
) on public.devices to authenticated;

drop policy if exists devices_owner_update on public.devices;
create policy devices_owner_update on public.devices
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.has_active_client_session(owner_id))
    and revoked_at is null
  )
  with check (
    owner_id = (select auth.uid())
    and revoked_at is null
    and auth_session_id = (select auth.jwt() ->> 'session_id')
  );
