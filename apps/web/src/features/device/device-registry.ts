import { generateP256KeyPair } from "@codex-remote/protocol";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceIdentity, DeviceIdentityStore } from "./device-key-store";

interface DeviceRow {
  id: string;
  public_key: string;
  revoked_at: string | null;
}

type Claims = { sub?: unknown; session_id?: unknown };

export class DeviceRegistry {
  constructor(
    private readonly client: SupabaseClient,
    private readonly store: DeviceIdentityStore,
    private readonly generateKeyPair = generateP256KeyPair,
  ) {}

  async ensureRegistered(): Promise<DeviceIdentity> {
    const { ownerId, sessionId } = await this.getVerifiedSession();
    const existing = await this.store.load(ownerId);

    if (existing) {
      const response = await this.client
        .from("devices")
        .update({
          auth_session_id: sessionId,
          last_online_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.deviceId)
        .eq("owner_id", ownerId)
        .select("id,public_key,revoked_at")
        .maybeSingle<DeviceRow>();

      if (response.error) {
        throw new Error("设备会话更新失败，请重新登录");
      }
      if (response.data && response.data.revoked_at === null) {
        return existing;
      }
      await this.store.clear(ownerId);
    }

    const keyPair = await this.generateKeyPair();
    const response = await this.client
      .from("devices")
      .insert({
        owner_id: ownerId,
        auth_session_id: sessionId,
        name: "Android 浏览器",
        public_key: JSON.stringify(keyPair.publicKey),
        last_online_at: new Date().toISOString(),
        notifications_enabled: false,
      })
      .select("id,public_key,revoked_at")
      .single<DeviceRow>();

    if (response.error || !response.data || response.data.revoked_at !== null) {
      throw new Error("设备注册失败，请稍后重试");
    }

    const identity: DeviceIdentity = {
      ownerId,
      deviceId: response.data.id,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    };
    await this.store.save(identity);
    return identity;
  }

  async refreshSession(): Promise<DeviceIdentity | null> {
    const { ownerId, sessionId } = await this.getVerifiedSession();
    const existing = await this.store.load(ownerId);
    if (!existing) {
      return null;
    }

    const response = await this.client
      .from("devices")
      .update({
        auth_session_id: sessionId,
        last_online_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.deviceId)
      .eq("owner_id", ownerId)
      .select("id,public_key,revoked_at")
      .maybeSingle<DeviceRow>();

    if (response.error) {
      throw new Error("设备会话更新失败，请重新登录");
    }
    if (response.data && response.data.revoked_at === null) {
      return existing;
    }

    await this.store.clear(ownerId);
    return null;
  }

  async rebindSession(): Promise<DeviceIdentity> {
    return this.ensureRegistered();
  }

  private async getVerifiedSession(): Promise<{
    ownerId: string;
    sessionId: string;
  }> {
    const response = await this.client.auth.getClaims();
    const claims = response.data?.claims as Claims | undefined;
    if (
      response.error ||
      typeof claims?.sub !== "string" ||
      typeof claims.session_id !== "string"
    ) {
      throw new Error("登录会话无效，请重新登录");
    }
    return { ownerId: claims.sub, sessionId: claims.session_id };
  }
}
