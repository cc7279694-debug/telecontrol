import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface DeviceIdentity {
  ownerId: string;
  deviceId: string;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

interface StoredDeviceIdentity extends DeviceIdentity {
  createdAt: string;
}

interface DeviceDatabase extends DBSchema {
  identities: {
    key: string;
    value: StoredDeviceIdentity;
  };
}

const DATABASE_NAME = "codex-remote-device";
const STORE_NAME = "identities";

export class DeviceIdentityStore {
  private database: Promise<IDBPDatabase<DeviceDatabase>> | undefined;

  async load(ownerId: string): Promise<DeviceIdentity | null> {
    const value = await (await this.getDatabase()).get(STORE_NAME, ownerId);
    return value ? toIdentity(value) : null;
  }

  async save(identity: DeviceIdentity): Promise<void> {
    await (
      await this.getDatabase()
    ).put(
      STORE_NAME,
      { ...identity, createdAt: new Date().toISOString() },
      identity.ownerId,
    );
  }

  async clear(ownerId: string): Promise<void> {
    await (await this.getDatabase()).delete(STORE_NAME, ownerId);
  }

  private getDatabase(): Promise<IDBPDatabase<DeviceDatabase>> {
    if (typeof indexedDB === "undefined") {
      throw new Error("设备存储仅可在浏览器中使用");
    }
    this.database ??= openDB<DeviceDatabase>(DATABASE_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      },
    });
    return this.database;
  }
}

function toIdentity(value: StoredDeviceIdentity): DeviceIdentity {
  return {
    ownerId: value.ownerId,
    deviceId: value.deviceId,
    privateKey: value.privateKey,
    publicKey: value.publicKey,
  };
}
