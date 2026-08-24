import { deriveAesSessionKey, hashPairingCode } from "@codex-remote/protocol";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DeviceRegistry } from "../device/device-registry";

interface HostRow {
  id: string;
  name: string;
  public_key: string;
  protocol_version: number;
  revoked_at: string | null;
}

export interface PairingInput {
  hostId: string;
  code: string;
  deviceId: string;
}

export interface PairedHost {
  hostId: string;
  hostName: string;
  deviceId: string;
  protocolVersion: number;
  sessionKey: CryptoKey;
}

export type PairedHook = (result: PairedHost) => Promise<void>;

export class PairingService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly registry: DeviceRegistry,
    private readonly onPaired?: PairedHook,
  ) {}

  async consume(input: PairingInput): Promise<PairedHost> {
    if (!/^\d{6}$/.test(input.code)) {
      throw new Error("请输入6位数字配对码");
    }
    if (!input.hostId.trim() || !input.deviceId.trim()) {
      throw new Error("配对信息不完整");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("当前处于离线状态，请联网后重试");
    }

    const identity = await this.registry.ensureRegistered();
    if (identity.deviceId !== input.deviceId) {
      throw new Error("设备身份已变化，请重新加载页面");
    }

    let response;
    try {
      response = await this.client.rpc("consume_pairing_request", {
        p_host_id: input.hostId,
        p_code_hash: await hashPairingCode(input.code),
        p_device_id: input.deviceId,
      });
    } catch {
      throw new Error("网络连接失败，请稍后重试");
    }
    if (response.error || !response.data) {
      throw mapPairingError(response.error?.message);
    }

    let hostResponse;
    try {
      hostResponse = await this.client
        .from("hosts")
        .select("id,name,public_key,protocol_version,revoked_at")
        .eq("id", input.hostId)
        .maybeSingle<HostRow>();
    } catch {
      throw new Error("网络连接失败，请稍后重试");
    }
    if (
      hostResponse.error ||
      !hostResponse.data ||
      hostResponse.data.revoked_at !== null
    ) {
      throw new Error("电脑不存在或已撤销，请重新配对");
    }

    let hostPublicKey: JsonWebKey;
    try {
      hostPublicKey = JSON.parse(hostResponse.data.public_key) as JsonWebKey;
    } catch {
      throw new Error("电脑密钥无效，请重新配对");
    }

    let sessionKey: CryptoKey;
    try {
      sessionKey = await deriveAesSessionKey(
        identity.privateKey,
        hostPublicKey,
      );
    } catch {
      throw new Error("电脑密钥无效，请重新配对");
    }

    const result: PairedHost = {
      hostId: hostResponse.data.id,
      hostName: hostResponse.data.name,
      deviceId: identity.deviceId,
      protocolVersion: hostResponse.data.protocol_version,
      sessionKey,
    };
    if (this.onPaired) {
      await this.onPaired(result);
    }
    return result;
  }
}

function mapPairingError(message?: string): Error {
  if (message && /invalid|expired/i.test(message)) {
    return new Error("配对码无效或已过期");
  }
  if (message && /already|unique/i.test(message)) {
    return new Error("配对码已使用或设备已配对");
  }
  if (message && /revoked|not authorized/i.test(message)) {
    return new Error("设备或电脑已撤销");
  }
  return new Error("配对失败，请稍后重试");
}
