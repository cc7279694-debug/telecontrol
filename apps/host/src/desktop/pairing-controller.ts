type PairingRequest = {
  pairingId: string;
  code: string;
  expiresAt: string;
};

export type PairingDisplay = {
  code: string;
  expiresAt: string;
};

export type PairingActionResult = {
  ok: boolean;
  message: string;
  pairing: PairingDisplay | null;
};

export type PairingControllerErrorCode = "PAIRING_NOT_READY";

export class PairingControllerError extends Error {
  constructor(readonly code: PairingControllerErrorCode) {
    super(code);
    this.name = "PairingControllerError";
  }
}

type PairingControllerOptions = {
  isSignedIn: () => boolean;
  isHostActive: () => boolean;
  isTransportReady: () => boolean;
  createPairingRequest: () => Promise<PairingRequest>;
  now?: () => number;
};

export function createPairingController({
  isSignedIn,
  isHostActive,
  isTransportReady,
  createPairingRequest,
  now = Date.now,
}: PairingControllerOptions) {
  let pairing: PairingDisplay | null = null;
  let pending = false;

  function getSnapshot() {
    if (pairing && Date.parse(pairing.expiresAt) <= now()) {
      pairing = null;
    }
    return pairing ? { ...pairing } : null;
  }

  async function create(): Promise<PairingActionResult> {
    if (pending) {
      return { ok: false, message: "配对码正在生成，请稍候", pairing: null };
    }
    if (!isSignedIn()) {
      return { ok: false, message: "请先登录 Host", pairing: null };
    }
    if (!isHostActive()) {
      return { ok: false, message: "Host 当前不可用", pairing: null };
    }
    if (!isTransportReady()) {
      return { ok: false, message: "安全连接尚未就绪", pairing: null };
    }

    pending = true;
    try {
      const request = await createPairingRequest();
      pairing = { code: request.code, expiresAt: request.expiresAt };
      return { ok: true, message: "配对码已生成", pairing: getSnapshot() };
    } catch {
      pairing = null;
      return {
        ok: false,
        message: "配对码生成失败，请稍后重试",
        pairing: null,
      };
    } finally {
      pending = false;
    }
  }

  return { create, getSnapshot };
}
