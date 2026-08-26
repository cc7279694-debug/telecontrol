-- The service role is used only by the Windows host and local acceptance
-- fixtures. Keep browser access protected by the existing RLS policies.
grant usage on schema private to service_role;
grant all on public.hosts, public.devices, public.host_device_links,
  public.remote_commands, public.audit_events to service_role;
grant all on private.pairing_requests, private.push_subscriptions to service_role;
