begin;

select plan(23);

select ok(
  to_regclass('public.hosts') is not null,
  'hosts'
);
select ok(
  to_regclass('private.pairing_requests') is not null,
  'pairing_requests'
);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated can reach private RPC implementation tables'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'claim_remote_command',
        'complete_remote_command',
        'create_pairing_request',
        'consume_pairing_request'
      )
  ),
  'transport RPCs run as the caller rather than SECURITY DEFINER'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'has_active_client_session'
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ),
  'the private session helper pins an empty search_path'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'remote_commands'
      and policyname = 'commands_host_update'
  ),
  'remote command updates have a host-session RLS policy'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'private'
      and tablename = 'pairing_requests'
      and policyname = 'pairing_requests_owner_update'
  ),
  'pairing completion has a private-table RLS policy'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_remote_command(uuid,text,integer)',
    'execute'
  ),
  'authenticated can execute the claim RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_remote_command(uuid,text,integer)',
    'execute'
  ),
  'anonymous users cannot execute the claim RPC'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'remote_commands'
      and column_name = 'sent_at'
      and is_nullable = 'NO'
      and data_type = 'timestamp with time zone'
  ),
  'remote commands preserve the envelope sent_at metadata'
);

select ok(
  has_column_privilege(
    'authenticated', 'public.devices', 'auth_session_id', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.devices', 'last_online_at', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.devices', 'notifications_enabled', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.devices', 'updated_at', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.devices', 'public_key', 'UPDATE'
  ),
  'browser sessions can update only safe device session columns'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'devices'
      and policyname = 'devices_owner_update'
      and lower(qual) like '%revoked_at is null%'
      and lower(with_check) like '%auth_session_id%'
      and lower(with_check) like '%session_id%'
  ),
  'device rebinding requires an active owner session and an unrevoked device'
);

select ok(
  has_column_privilege(
    'authenticated', 'public.remote_commands', 'status', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.remote_commands', 'lease_owner', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.remote_commands', 'lease_expires_at', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.remote_commands', 'started_at', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.remote_commands', 'completed_at', 'UPDATE'
  ),
  'the host lease transition has the required column grant'
);

select ok(
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname = 'remote_commands'
      and t.tgname = 'remote_commands_enforce_transition'
      and not t.tgisinternal
  ),
  'remote command status transitions are guarded by a trigger'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'enforce_remote_command_transition'
      and p.proconfig @> array['search_path=""']
  ),
  'the command transition trigger pins an empty search_path'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'remote-transport-test@example.test',
  '', now(), '{}'::jsonb, '{}'::jsonb
)
on conflict (id) do nothing;

insert into public.hosts (
  id, owner_id, auth_session_id, name, public_key, version
) values (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'remote-transport-test-session', 'Test Host', 'test-host-key', 'test'
);

insert into public.devices (
  id, owner_id, auth_session_id, name, public_key
) values (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  'remote-transport-test-device-session', 'Test Device', 'test-device-key'
);

insert into public.devices (
  id, owner_id, auth_session_id, name, public_key, revoked_at
) values (
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000001',
  'revoked-device-session', 'Revoked Device', 'revoked-device-key', now()
);

insert into public.host_device_links (owner_id, host_id, device_id)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012'
);

insert into public.remote_commands (
  id, owner_id, host_id, device_id, message_id, kind, nonce,
  ciphertext, idempotency_key, sent_at, expires_at
) values (
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000014', 'turn.start', 'test-nonce',
  'test-ciphertext', 'remote-transport-test-command', now(), now() + interval '5 minutes'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000000001',
    'session_id', 'remote-transport-test-session'
  )::text,
  true
);

select throws_ok(
  $$
    update public.remote_commands
    set status = 'completed',
        lease_owner = 'remote-transport-test-session',
        completed_at = now()
    where id = '00000000-0000-0000-0000-000000000013'
  $$,
  'P0001',
  'Invalid command status transition',
  'a queued command cannot jump directly to a terminal state'
);

select is(
  (select status from public.remote_commands
   where id = '00000000-0000-0000-0000-000000000013'),
  'queued',
  'the rejected command remains queued'
);

select lives_ok(
  $$
    update public.devices
    set auth_session_id = 'remote-transport-test-session',
        last_online_at = now(),
        notifications_enabled = true,
        updated_at = now()
    where id = '00000000-0000-0000-0000-000000000012'
  $$,
  'the active owner can rebind an unrevoked device session'
);

select throws_ok(
  $$
    update public.devices
    set public_key = 'changed-key'
    where id = '00000000-0000-0000-0000-000000000012'
  $$,
  '42501',
  'permission denied for table devices',
  'the browser cannot replace a device public key'
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000000099',
    'session_id', 'other-user-session'
  )::text,
  true
);

select lives_ok(
  $$
    update public.devices
    set notifications_enabled = false
    where id = '00000000-0000-0000-0000-000000000012'
  $$,
  'another owner cannot update the device row'
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000000001',
    'session_id', 'remote-transport-test-session'
  )::text,
  true
);

select is(
  (select notifications_enabled from public.devices
   where id = '00000000-0000-0000-0000-000000000012'),
  true,
  'another owner update is filtered by RLS'
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'role', 'authenticated',
    'sub', '00000000-0000-0000-0000-000000000001',
    'session_id', 'remote-transport-test-session'
  )::text,
  true
);

select lives_ok(
  $$
    update public.devices
    set auth_session_id = 'remote-transport-test-session'
    where id = '00000000-0000-0000-0000-000000000015'
  $$,
  'a revoked device cannot be rebound'
);
select is(
  (select auth_session_id from public.devices
   where id = '00000000-0000-0000-0000-000000000015'),
  'revoked-device-session',
  'a revoked device session remains unchanged'
);

select * from finish();
rollback;
