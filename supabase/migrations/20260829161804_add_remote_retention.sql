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

do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'codex-remote-retention-hourly';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'codex-remote-retention-hourly',
    '17 * * * *',
    $$select private.cleanup_remote_retention();$$
  );
end;
$migration$;
