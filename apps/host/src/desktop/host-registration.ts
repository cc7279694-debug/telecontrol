export type HostRegistrationRuntimeSession = {
  ownerId: string;
  authSessionId: string | null;
  accessToken: string;
};

export function resolveHostRegistrationSession({
  signedIn,
  runtimeSession,
}: {
  signedIn: boolean;
  snapshotOwnerId: string | null;
  snapshotAuthSessionId: string | null;
  runtimeSession: HostRegistrationRuntimeSession | null;
}) {
  if (!signedIn || !runtimeSession?.authSessionId) return null;
  return {
    ownerId: runtimeSession.ownerId,
    authSessionId: runtimeSession.authSessionId,
    accessToken: runtimeSession.accessToken,
  };
}
