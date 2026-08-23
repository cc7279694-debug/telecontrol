-- Keep the existing migration safe for environments that already applied it.
-- Public RPCs run as the caller and rely on RLS plus narrow column grants.

alter function private.has_active_client_session(uuid)
  set search_path = '';

alter function public.claim_remote_command(uuid, text, integer)
  security invoker;
alter function public.claim_remote_command(uuid, text, integer)
  set search_path = '';

alter function public.complete_remote_command(
  uuid, uuid, text, text, text, text, text
)
  security invoker;
alter function public.complete_remote_command(
  uuid, uuid, text, text, text, text, text
)
  set search_path = '';

alter function public.create_pairing_request(uuid, text, timestamptz)
  security invoker;
alter function public.create_pairing_request(uuid, text, timestamptz)
  set search_path = '';

alter function public.consume_pairing_request(uuid, text, uuid)
  security invoker;
alter function public.consume_pairing_request(uuid, text, uuid)
  set search_path = '';

grant update (
  status, lease_owner, lease_expires_at, started_at,
  result_nonce, result_ciphertext, error_code, completed_at
) on public.remote_commands to authenticated;
grant select on private.pairing_requests to authenticated;
grant insert (owner_id, host_id, code_hash, created_session_id, expires_at)
  on private.pairing_requests to authenticated;
grant update (consumed_at, consumed_by_device_id)
  on private.pairing_requests to authenticated;

drop policy if exists commands_host_update on public.remote_commands;
create policy commands_host_update on public.remote_commands
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and status in ('queued', 'leased')
    and exists (
      select 1 from public.hosts h
      where h.id = host_id
        and h.owner_id = (select auth.uid())
        and h.auth_session_id = (select auth.jwt() ->> 'session_id')
        and h.revoked_at is null
    )
    and exists (
      select 1 from public.host_device_links l
      join public.devices d on d.id = l.device_id
      where l.host_id = public.remote_commands.host_id
        and l.device_id = public.remote_commands.device_id
        and l.owner_id = (select auth.uid())
        and l.revoked_at is null
        and d.revoked_at is null
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.hosts h
      where h.id = host_id
        and h.owner_id = (select auth.uid())
        and h.auth_session_id = (select auth.jwt() ->> 'session_id')
        and h.revoked_at is null
    )
    and (
      (
        status = 'leased'
        and lease_owner = (select auth.jwt() ->> 'session_id')
        and lease_expires_at > now()
      )
      or (
        status in ('completed', 'failed', 'expired')
        and lease_owner = (select auth.jwt() ->> 'session_id')
        and completed_at is not null
      )
    )
  );

drop policy if exists pairing_requests_owner_select on private.pairing_requests;
create policy pairing_requests_owner_select on private.pairing_requests
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.has_active_client_session(owner_id))
    and consumed_at is null
    and expires_at > now()
  );

drop policy if exists pairing_requests_owner_insert on private.pairing_requests;
create policy pairing_requests_owner_insert on private.pairing_requests
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and created_session_id = (select auth.jwt() ->> 'session_id')
    and (select private.has_active_client_session(owner_id))
    and exists (
      select 1 from public.hosts h
      where h.id = host_id
        and h.owner_id = (select auth.uid())
        and h.auth_session_id = (select auth.jwt() ->> 'session_id')
        and h.revoked_at is null
    )
  );

drop policy if exists pairing_requests_owner_update on private.pairing_requests;
create policy pairing_requests_owner_update on private.pairing_requests
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select private.has_active_client_session(owner_id))
    and consumed_at is null
    and expires_at > now()
  )
  with check (
    owner_id = (select auth.uid())
    and consumed_at is not null
    and consumed_by_device_id is not null
    and exists (
      select 1 from public.devices d
      where d.id = consumed_by_device_id
        and d.owner_id = (select auth.uid())
        and d.revoked_at is null
    )
  );
