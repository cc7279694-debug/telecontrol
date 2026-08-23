import { describe, expect, it } from "vitest";
import { JsonRpcClient, type LineChannel } from "./json-rpc-client.js";

class FakeLineChannel implements LineChannel {
  readonly writes: string[] = [];
  private handler: ((line: string) => void) | undefined;

  write(line: string): void {
    this.writes.push(line);
  }

  onLine(handler: (line: string) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  push(message: unknown): void {
    this.handler?.(JSON.stringify(message));
  }
}

describe("JsonRpcClient", () => {
  it("correlates requests and responses", async () => {
    const channel = new FakeLineChannel();
    const client = new JsonRpcClient(channel);

    const resultPromise = client.request("thread/list", { limit: 10 });
    expect(JSON.parse(channel.writes[0])).toMatchObject({
      id: 1,
      method: "thread/list",
      params: { limit: 10 },
    });

    channel.push({ id: 1, result: { data: [] } });
    await expect(resultPromise).resolves.toEqual({ data: [] });
  });

  it("performs initialize and sends the initialized notification", async () => {
    const channel = new FakeLineChannel();
    const client = new JsonRpcClient(channel);

    const resultPromise = client.initialize({
      name: "codex_remote_host",
      title: "Codex Remote Host",
      version: "0.1.0",
    });
    channel.push({ id: 1, result: { userAgent: "codex" } });

    await expect(resultPromise).resolves.toEqual({ userAgent: "codex" });
    expect(JSON.parse(channel.writes[1])).toEqual({
      method: "initialized",
      params: {},
    });
  });

  it("responds to server requests through the registered handler", async () => {
    const channel = new FakeLineChannel();
    const client = new JsonRpcClient(channel);
    client.onServerRequest(async (request) => ({
      decision:
        request.method === "item/commandExecution/requestApproval"
          ? "accept"
          : "decline",
    }));

    channel.push({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { command: "dir" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(JSON.parse(channel.writes[0])).toEqual({
      id: 99,
      result: { decision: "accept" },
    });
  });

  it("waits when a server request handler returns no response", async () => {
    const channel = new FakeLineChannel();
    const client = new JsonRpcClient(channel);
    client.onServerRequest(async () => undefined);

    channel.push({ id: 100, method: "item/commandExecution/requestApproval" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(channel.writes).toHaveLength(0);
  });
});
