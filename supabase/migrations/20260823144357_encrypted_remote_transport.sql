-- Codex Remote MVP: encrypted relay metadata and reliable command queue.
-- No prompt, code, command, path, plaintext, or model output is stored here.

create schema if not exists private;

create table public.hosts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  public_key text not null check (char_length(public_key) between 1 and 4096),
  version text not null check (char_length(version) between 1 and 50),
  protocol_version integer not null default 1 check (protocol_version = 1),
  last_online_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  public_key text not null check (char_length(public_key) between 1 and 4096),
  last_online_at timestamptz,
  notifications_enabled boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.host_device_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  host_id uuid not null references public.hosts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (host_id, device_id)
);

create table public.remote_commands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  host_id uuid not null references public.hosts (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  message_id uuid not null,
  protocol_version integer not null default 1 check (protocol_version = 1),
  kind text not null check (
    kind in (
      'host.snapshot', 'thread.list', 'thread.read', 'thread.start',
      'thread.resume', 'turn.start', 'turn.steer', 'turn.interrupt',
      'approval.respond'
    )
  ),
  nonce text not null check (char_length(nonce) between 1 and 256),
  ciphertext text not null check (char_length(ciphertext) between 1 and 1048576),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'queued' check (
    status in ('queued', 'leased', 'completed', 'failed', 'expired')
  ),
  lease_owner text,
  lease_expires_at timestamptz,
  expires_at timestamptz not null,
  result_nonce text,
  result_ciphertext text,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (host_id, idempotency_key)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  host_id uuid references public.hosts (id) on delete set null,
  device_id uuid references public.devices (id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  result text not null check (result in ('accepted', 'rejected', 'failed')),
  created_at timestamptz not null default now()
);

create table private.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  host_id uuid not null references public.hosts (id) on delete cascade,
  code_hash text not null check (char_length(code_hash) between 1 and 256),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 512),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, endpoint)
);

create index hosts_owner_id_idx on public.hosts (owner_id);
create index devices_owner_id_idx on public.devices (owner_id);
create index links_owner_id_idx on public.host_device_links (owner_id);
create index commands_host_status_idx on public.remote_commands (host_id, status, created_at);
create index commands_expires_at_idx on public.remote_commands (expires_at);
create index audit_events_owner_created_idx on public.audit_events (owner_id, created_at desc);

alter table public.hosts enable row level security;
alter table public.devices enable row level security;
alter table public.host_device_links enable row level security;
alter table public.remote_commands enable row level security;
alter table public.audit_events enable row level security;
alter table private.pairing_requests enable row level security;
alter table private.push_subscriptions enable row level security;

revoke all on public.hosts, public.devices, public.host_device_links,
  public.remote_commands, public.audit_events from anon, authenticated;
grant select, insert, update, delete on public.hosts, public.devices,
  public.host_device_links to authenticated;
grant select, insert, update on public.remote_commands to authenticated;
grant select, insert on public.audit_events to authenticated;
revoke all on all tables in schema private from anon, authenticated;

create policy hosts_owner_select on public.hosts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy hosts_owner_insert on public.hosts
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy hosts_owner_update on public.hosts
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy hosts_owner_delete on public.hosts
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy devices_owner_select on public.devices
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy devices_owner_insert on public.devices
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy devices_owner_update on public.devices
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy devices_owner_delete on public.devices
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy links_owner_select on public.host_device_links
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy links_owner_insert on public.host_device_links
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.hosts h
      where h.id = host_id and h.owner_id = (select auth.uid()) and h.revoked_at is null
    )
    and exists (
      select 1 from public.devices d
      where d.id = device_id and d.owner_id = (select auth.uid()) and d.revoked_at is null
    )
  );
create policy links_owner_update on public.host_device_links
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy links_owner_delete on public.host_device_links
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy commands_owner_select on public.remote_commands
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy commands_owner_insert on public.remote_commands
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.host_device_links l
      where l.owner_id = (select auth.uid())
        and l.host_id = public.remote_commands.host_id
        and l.device_id = public.remote_commands.device_id
        and l.revoked_at is null
    )
  );
create policy commands_owner_update on public.remote_commands
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy audit_owner_select on public.audit_events
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy audit_owner_insert on public.audit_events
  for insert to authenticated with check ((select auth.uid()) = owner_id);

create or replace function public.claim_remote_command(
  p_host_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 30
)
returns setof public.remote_commands
language plpgsql
set search_path = public
as $$
begin
  return query
  with candidate as (
    select c.id
    from public.remote_commands c
    where c.host_id = p_host_id
      and c.expires_at > now()
      and (
        c.status = 'queued'
        or (c.status = 'leased' and c.lease_expires_at < now())
      )
    order by c.created_at
    for update skip locked
    limit 1
  )
  update public.remote_commands c
  set status = 'leased',
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(c.started_at, now())
  where c.id = (select candidate.id from candidate)
  returning c.*;
end;
$$;

revoke all on function public.claim_remote_command(uuid, text, integer) from public, anon;
grant execute on function public.claim_remote_command(uuid, text, integer) to authenticated;

-- Realtime keeps ownership policies in realtime.messages. The dashboard/project
-- setting must also disable public channel access; this migration never changes
-- the locked realtime schema itself.
create policy "authenticated host members can receive private broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.hosts h
    join public.host_device_links l on l.host_id = h.id
    where (select realtime.topic()) = 'host:' || h.id::text
      and h.owner_id = (select auth.uid())
      and l.owner_id = (select auth.uid())
      and l.revoked_at is null
  )
);

create policy "authenticated host members can send private broadcasts"
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and exists (
    select 1
    from public.hosts h
    join public.host_device_links l on l.host_id = h.id
    where (select realtime.topic()) = 'host:' || h.id::text
      and h.owner_id = (select auth.uid())
      and l.owner_id = (select auth.uid())
      and l.revoked_at is null
  )
);
