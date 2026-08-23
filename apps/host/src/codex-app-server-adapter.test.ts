import { describe, expect, it } from "vitest";
import {
  CodexAppServerAdapter,
  type AuthorizedWorkspace,
} from "./codex-app-server-adapter.js";
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

const workspace: AuthorizedWorkspace = {
  id: "workbench",
  path: "E:\\CODEX\\VIBE CODING",
};

describe("CodexAppServerAdapter", () => {
  it("lists threads within an authorized workspace", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const resultPromise = adapter.listThreads({
      workspaceId: "workbench",
      limit: 20,
    });
    expect(JSON.parse(channel.writes[0])).toMatchObject({
      method: "thread/list",
      params: { limit: 20, cwd: workspace.path },
    });
    channel.push({ id: 1, result: { data: [{ id: "thread-1" }] } });

    await expect(resultPromise).resolves.toEqual([{ id: "thread-1" }]);
  });

  it("starts a turn with the restricted workspace policy", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const resultPromise = adapter.startTurn({
      threadId: "thread-1",
      workspaceId: "workbench",
      text: "检查项目状态",
    });
    expect(JSON.parse(channel.writes[0])).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        cwd: workspace.path,
        approvalPolicy: "onRequest",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [workspace.path],
        },
      },
    });
    channel.push({ id: 1, result: { turn: { id: "turn-1" } } });

    await expect(resultPromise).resolves.toEqual({ id: "turn-1" });
  });

  it("rejects workspaces that were not authorized locally", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    await expect(
      adapter.listThreads({ workspaceId: "not-authorized" }),
    ).rejects.toThrow("Workspace is not authorized");
    expect(channel.writes).toHaveLength(0);
  });
});

