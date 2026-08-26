-- A pairing request must remain visible to the UPDATE policy while the
-- consume RPC changes consumed_at from NULL to a timestamp. The RPC itself
-- still filters for an unconsumed, unexpired request before locking it.
alter policy pairing_requests_owner_select on private.pairing_requests
using (
  owner_id = (select auth.uid())
  and (select private.has_active_client_session(owner_id))
);
