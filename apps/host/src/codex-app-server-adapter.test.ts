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

  it("reads the official thread response without adding unsupported parameters", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const resultPromise = adapter.readThread({
      workspaceId: "workbench",
      threadId: "thread-1",
    });
    expect(JSON.parse(channel.writes[0])).toEqual({
      id: 1,
      method: "thread/read",
      params: { threadId: "thread-1", includeTurns: true },
    });
    channel.push({ id: 1, result: { thread: { id: "thread-1" } } });

    await expect(resultPromise).resolves.toEqual({ id: "thread-1" });
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
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [workspace.path],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        input: [{ type: "text", text: "检查项目状态", text_elements: [] }],
      },
    });
    channel.push({ id: 1, result: { turn: { id: "turn-1" } } });

    await expect(resultPromise).resolves.toEqual({ id: "turn-1" });
  });

  it("lists the available models and sends selected reasoning settings", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const modelsPromise = adapter.listModels();
    expect(JSON.parse(channel.writes[0])).toEqual({
      id: 1,
      method: "model/list",
      params: { includeHidden: false },
    });
    channel.push({
      id: 1,
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "通用模型",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "平衡" },
            ],
          },
        ],
      },
    });
    await expect(modelsPromise).resolves.toHaveLength(1);

    const turnPromise = adapter.startTurn({
      threadId: "thread-1",
      workspaceId: "workbench",
      text: "继续检查",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(JSON.parse(channel.writes[1])).toMatchObject({
      method: "turn/start",
      params: { model: "gpt-5.5", effort: "high" },
    });
    channel.push({ id: 2, result: { turn: { id: "turn-2" } } });
    await expect(turnPromise).resolves.toEqual({ id: "turn-2" });
  });

  it("uses the official thread policy fields for new and resumed threads", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const startPromise = adapter.startThread({ workspaceId: "workbench" });
    expect(JSON.parse(channel.writes[0])).toMatchObject({
      method: "thread/start",
      params: {
        cwd: workspace.path,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
    });
    channel.push({ id: 1, result: { thread: { id: "thread-1" } } });
    await expect(startPromise).resolves.toEqual({ id: "thread-1" });

    const resumePromise = adapter.resumeThread({
      workspaceId: "workbench",
      threadId: "thread-1",
    });
    expect(JSON.parse(channel.writes[1])).toMatchObject({
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        cwd: workspace.path,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      },
    });
    channel.push({ id: 2, result: { thread: { id: "thread-1" } } });
    await expect(resumePromise).resolves.toEqual({ id: "thread-1" });
  });

  it("uses expectedTurnId and complete text input when steering a turn", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const steerPromise = adapter.steerTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      workspaceId: "workbench",
      text: "继续检查",
    });
    expect(JSON.parse(channel.writes[0])).toEqual({
      id: 1,
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        input: [{ type: "text", text: "继续检查", text_elements: [] }],
      },
    });
    channel.push({ id: 1, result: {} });
    await expect(steerPromise).resolves.toBeUndefined();
  });

  it("keeps an approval request pending until the remote decision arrives", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });
    const approvalRequests: number[] = [];
    adapter.onApprovalRequest((request) => {
      approvalRequests.push(request.id as number);
    });

    channel.push({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(approvalRequests).toEqual([99]);
    expect(channel.writes).toHaveLength(0);

    await adapter.resolveApproval({ requestId: 99, decision: "accept" });
    expect(JSON.parse(channel.writes[0])).toEqual({
      id: 99,
      result: { decision: "accept" },
    });
  });

  it("initializes with the official nullable capabilities field", async () => {
    const channel = new FakeLineChannel();
    const adapter = new CodexAppServerAdapter(new JsonRpcClient(channel), {
      authorizedWorkspaces: [workspace],
    });

    const initializePromise = adapter.initialize();
    expect(JSON.parse(channel.writes[0])).toMatchObject({
      method: "initialize",
      params: {
        capabilities: null,
      },
    });
    channel.push({ id: 1, result: {} });
    await expect(initializePromise).resolves.toEqual({});
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
