import {
  asSupabaseTransportClient,
  SupabaseTransport,
} from "../supabase-transport.js";

export function createAuthenticatedSupabaseTransport(
  session: { accessToken: string },
  clientFactory: (accessToken: string) => unknown,
) {
  return new SupabaseTransport(
    asSupabaseTransportClient(clientFactory(session.accessToken)),
  );
}
