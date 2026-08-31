import { describe, expect, it } from "vitest";
import { createConfigStore, type HostConfig } from "./config-store.js";

const config: HostConfig = {
  schemaVersion: 1,
  host: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "我的 Windows",
    publicKey: "host-public-key",
    protocolVersion: 1,
  },
  workspaces: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Remote project",
      path: "C:\\Users\\demo\\Projects\\remote-project",
    },
  ],
  openAtLogin: false,
  installedVersion: "0.1.0",
  doctorSummary: null,
};

class MemoryConfigFileSystem {
  readonly files = new Map<string, string>();
  readonly writes: Array<{ path: string; data: string }> = [];
  readonly renames: Array<{ from: string; to: string }> = [];
  failWrite = false;

  async readFile(filePath: string) {
    const data = this.files.get(filePath);
    if (data === undefined) {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return data;
  }

  async writeFile(filePath: string, data: string) {
    if (this.failWrite) throw new Error("interrupted temp write");
    this.writes.push({ path: filePath, data });
    this.files.set(filePath, data);
  }

  async rename(from: string, to: string) {
    const data = this.files.get(from);
    if (data === undefined) throw new Error("temporary file missing");
    this.files.set(to, data);
    this.files.delete(from);
    this.renames.push({ from, to });
  }

  async unlink(filePath: string) {
    this.files.delete(filePath);
  }
}

function createStore(fileSystem: MemoryConfigFileSystem) {
  return createConfigStore({
    filePath: "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\config.v1.json",
    fileSystem,
  });
}

describe("config store", () => {
  it("writes and reads a strict versioned configuration atomically", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);

    await store.write(config);
    await expect(store.read()).resolves.toEqual(config);
    expect(fileSystem.writes[0]?.data).toContain('"schemaVersion": 1');
    expect(fileSystem.renames).toHaveLength(1);
    expect(fileSystem.renames[0]?.to).toContain("config.v1.json");
  });

  it("stores authorized workspaces before the Host has registered", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);
    const localOnlyConfig: HostConfig = {
      ...config,
      host: null,
      workspaces: [],
    };

    await store.write(localOnlyConfig);

    await expect(store.read()).resolves.toEqual(localOnlyConfig);
  });

  it("returns null for a missing config and preserves the last valid file after a failed replace", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);

    await expect(store.read()).resolves.toBeNull();
    await store.write(config);
    fileSystem.failWrite = true;

    await expect(
      store.write({ ...config, openAtLogin: true }),
    ).rejects.toThrow();
    await expect(store.read()).resolves.toEqual(config);
  });

  it("rejects future versions and malformed workspace paths", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);

    fileSystem.files.set(
      "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\config.v1.json",
      JSON.stringify({ ...config, schemaVersion: 2 }),
    );
    await expect(store.read()).rejects.toMatchObject({
      code: "UNSUPPORTED_CONFIG_VERSION",
    });

    await expect(
      store.write({
        ...config,
        workspaces: [{ ...config.workspaces[0]!, path: "relative-project" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });

    fileSystem.files.set(
      "C:\\Users\\demo\\AppData\\Roaming\\Codex Remote\\config.v1.json",
      "{ malformed json",
    );
    await expect(store.read()).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });

  it("rejects duplicate workspace IDs and normalized paths", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);
    const secondWorkspace = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Another project",
      path: "C:\\Users\\demo\\Projects\\remote-project\\",
    };

    await expect(
      store.write({
        ...config,
        workspaces: [
          config.workspaces[0]!,
          { ...secondWorkspace, id: config.workspaces[0]!.id },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(
      store.write({
        ...config,
        workspaces: [config.workspaces[0]!, secondWorkspace],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("rejects sensitive fields instead of persisting them", async () => {
    const fileSystem = new MemoryConfigFileSystem();
    const store = createStore(fileSystem);

    await expect(
      store.write({ ...config, accessToken: "secret-token" } as HostConfig),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(
      store.write({
        ...config,
        doctorSummary: "raw diagnostic output",
      } as unknown as HostConfig),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    expect(fileSystem.writes).toHaveLength(0);
  });
});
