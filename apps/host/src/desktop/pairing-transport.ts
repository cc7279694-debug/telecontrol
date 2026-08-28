import type { PairingRequest, PairingTransport } from "./pairing-controller.js";

type PairingTransportClient = {
  createPairingRequest: () => Promise<PairingRequest>;
};

export function createSupabasePairingTransport({
  transport,
  getHostId,
  isSessionReady,
}: {
  transport: PairingTransportClient;
  getHostId: () => string | null;
  isSessionReady: () => boolean;
}): PairingTransport {
  return {
    isReady: () => isSessionReady() && getHostId() !== null,
    createPairingRequest: async () => {
      const hostId = getHostId();
      if (!hostId || !isSessionReady()) {
        throw new Error("Pairing transport is unavailable");
      }
      return transport.createPairingRequest();
    },
  };
}
