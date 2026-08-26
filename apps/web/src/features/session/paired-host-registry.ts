import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceIdentityStore } from "../device/device-key-store";

interface HostLinkRow {
  host_id: string;
  device_id: string;
  revoked_at: string | null;
}

interface HostRow {
  id: string;
  name: string;
  protocol_version: number;
  revoked_at: string | null;
}

export interface PairedHostRecord {
  hostId: string;
  hostName: string;
  deviceId: string;
  protocolVersion: number;
}

export class PairedHostRegistry {
  constructor(
    private readonly client: SupabaseClient,
    private readonly deviceStore: DeviceIdentityStore,
  ) {}

  async load(): Promise<PairedHostRecord | null> {
    const ownerId = await this.getOwnerId();
    const identity = await this.deviceStore.load(ownerId);
    if (!identity) {
      return null;
    }

    const linkResponse = await this.client
      .from("host_device_links")
      .select("host_id,device_id,revoked_at")
      .eq("owner_id", ownerId)
      .eq("device_id", identity.deviceId)
      .maybeSingle<HostLinkRow>();
    if (linkResponse.error) {
      throw new Error("配对电脑读取失败，请稍后重试");
    }
    const link = linkResponse.data;
    if (!link || link.revoked_at !== null) {
      return null;
    }

    const hostResponse = await this.client
      .from("hosts")
      .select("id,name,protocol_version,revoked_at")
      .eq("owner_id", ownerId)
      .eq("id", link.host_id)
      .maybeSingle<HostRow>();
    if (hostResponse.error) {
      throw new Error("电脑状态读取失败，请稍后重试");
    }
    const host = hostResponse.data;
    if (!host || host.revoked_at !== null) {
      return null;
    }
    if (host.protocol_version !== 1) {
      throw new Error("电脑协议版本不兼容，请更新 Windows Host");
    }

    return {
      hostId: host.id,
      hostName: host.name,
      deviceId: identity.deviceId,
      protocolVersion: host.protocol_version,
    };
  }

  private async getOwnerId(): Promise<string> {
    const response = await this.client.auth.getClaims();
    const claims = response.data?.claims as { sub?: unknown } | undefined;
    if (response.error || typeof claims?.sub !== "string") {
      throw new Error("登录会话无效，请重新登录");
    }
    return claims.sub;
  }
}
