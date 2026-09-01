import type { SupabaseClient } from "@supabase/supabase-js";
import { DeviceRegistry } from "../device/device-registry";
import type {
  DeviceIdentity,
  DeviceIdentityStore,
} from "../device/device-key-store";

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

interface DeviceSessionRefresher {
  refreshSession(): Promise<DeviceIdentity | null>;
}

export class PairedHostRegistry {
  constructor(
    private readonly client: SupabaseClient,
    private readonly deviceStore: DeviceIdentityStore,
    private readonly deviceSessionRefresher: DeviceSessionRefresher = new DeviceRegistry(
      client,
      deviceStore,
    ),
  ) {}

  async load(): Promise<PairedHostRecord | null> {
    const identity = await this.deviceSessionRefresher.refreshSession();
    if (!identity) {
      return null;
    }
    const ownerId = identity.ownerId;

    const linkResponse = await this.client
      .from("host_device_links")
      .select("host_id,device_id,revoked_at")
      .eq("owner_id", ownerId)
      .eq("device_id", identity.deviceId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
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
}
