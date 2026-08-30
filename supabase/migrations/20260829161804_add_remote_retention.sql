-- Keep encrypted command payloads and audit metadata within their documented
-- retention windows. The scheduler is the only caller of this helper.
create extension if not exists pg_cron with schema extensions;

create or replace function private.cleanup_remote_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from public.remote_commands
  where (
    completed_at is not null
    and completed_at < now() - interval '24 hours'
  ) or (
    completed_at is null
    and expires_at < now() - interval '24 hours'
  );

  delete from public.audit_events
  where created_at < now() - interval '30 days';

  delete from private.pairing_requests
  where expires_at < now();
end;
$function$;

revoke all on function private.cleanup_remote_retention()
from public, anon, authenticated, service_role;

create or replace function private.ensure_remote_retention_job()
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'codex-remote-retention-hourly'
      and username = current_user
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'codex-remote-retention-hourly',
    '17 * * * *',
    $$select private.cleanup_remote_retention();$$
  );
end;
$function$;

revoke all on function private.ensure_remote_retention_job()
from public, anon, authenticated, service_role;

select private.ensure_remote_retention_job();
