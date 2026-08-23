begin;

select plan(9);

select has_table('public', 'hosts');
select has_table('private', 'pairing_requests');

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
      and p.proconfig @> array['search_path=']
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
  has_table_privilege('authenticated', 'public.remote_commands', 'UPDATE'),
  'the host lease transition has the required column grant'
);

select * from finish();
rollback;
