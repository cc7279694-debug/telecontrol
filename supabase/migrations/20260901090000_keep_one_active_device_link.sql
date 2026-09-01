-- A device represents one mobile client session. Re-pairing that device should
-- retire older Host links before creating the new active link.
with ranked_active_links as (
  select
    id,
    row_number() over (
      partition by owner_id, device_id
      order by created_at desc, id desc
    ) as link_rank
  from public.host_device_links
  where revoked_at is null
)
update public.host_device_links as links
set revoked_at = now()
from ranked_active_links
where links.id = ranked_active_links.id
  and ranked_active_links.link_rank > 1;

create unique index if not exists host_device_links_one_active_device_idx
  on public.host_device_links (owner_id, device_id)
  where revoked_at is null;

create or replace function public.consume_pairing_request(
  p_host_id uuid,
  p_code_hash text,
  p_device_id uuid
)
returns public.host_device_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pairing_id uuid;
  linked_host_device public.host_device_links;
begin
  if auth.uid() is null
     or p_code_hash is null
     or p_code_hash !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Invalid pairing request';
  end if;

  if not exists (
    select 1
    from public.devices d
    where d.id = p_device_id
      and d.owner_id = auth.uid()
      and d.auth_session_id = (select auth.jwt() ->> 'session_id')
      and d.revoked_at is null
  ) then
    raise exception 'Device session is not authorized';
  end if;

  select pr.id into pairing_id
  from private.pairing_requests pr
  join public.hosts h on h.id = pr.host_id
  where pr.host_id = p_host_id
    and pr.owner_id = auth.uid()
    and pr.code_hash = p_code_hash
    and pr.consumed_at is null
    and pr.expires_at > now()
    and h.revoked_at is null
  order by pr.created_at desc
  limit 1
  for update of pr;

  if pairing_id is null then
    raise exception 'Pairing request is invalid or expired';
  end if;

  update public.host_device_links
  set revoked_at = now()
  where owner_id = auth.uid()
    and device_id = p_device_id
    and revoked_at is null;

  update public.host_device_links
  set revoked_at = null, created_at = now()
  where owner_id = auth.uid()
    and host_id = p_host_id
    and device_id = p_device_id
  returning * into linked_host_device;

  if not found then
    insert into public.host_device_links (owner_id, host_id, device_id)
    values (auth.uid(), p_host_id, p_device_id)
    returning * into linked_host_device;
  end if;

  update private.pairing_requests
  set consumed_at = now(), consumed_by_device_id = p_device_id
  where id = pairing_id;

  return linked_host_device;
exception
  when unique_violation then
    raise exception 'Device is already linked to this host';
end;
$$;

grant execute on function public.consume_pairing_request(uuid, text, uuid)
  to authenticated;
