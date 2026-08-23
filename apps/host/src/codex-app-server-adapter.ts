import type {
  JsonRpcClient,
  JsonRpcNotification,
  JsonRpcServerRequest,
  RpcId,
} from "./json-rpc-client.js";
import type {
  CodexApprovalPolicy,
  CodexCommandExecutionApprovalDecision,
  CodexThreadReadResponse,
  CodexThreadResumeResponse,
  CodexThreadSandbox,
  CodexThreadStartResponse,
  CodexTurnStartResponse,
  CodexUserTextInput,
  CodexWorkspaceWriteSandboxPolicy,
} from "./codex-schema.generated.js";

export interface AuthorizedWorkspace {
  id: string;
  path: string;
}

export interface CodexAppServerAdapterOptions {
  authorizedWorkspaces: AuthorizedWorkspace[];
}

export interface ListThreadsInput {
  workspaceId: string;
  limit?: number;
  cursor?: string;
}

export interface ReadThreadInput {
  threadId: string;
  workspaceId: string;
}

export interface StartThreadInput {
  workspaceId: string;
}

export interface StartTurnInput {
  threadId: string;
  workspaceId: string;
  text: string;
}

export interface SteerTurnInput extends StartTurnInput {
  turnId: string;
}

export interface InterruptTurnInput {
  threadId: string;
  turnId: string;
}

export interface ApprovalResponse {
  requestId: RpcId;
  decision: CodexCommandExecutionApprovalDecision;
}

export type ThreadSummary = Record<string, unknown>;

export type ThreadSnapshot = Record<string, unknown>;

export interface TurnHandle {
  id: string;
}

export type ApprovalRequestHandler = (
  request: JsonRpcServerRequest,
) => Promise<void> | void;

interface ThreadListResult {
  data?: ThreadSummary[];
}

const approvalRequestMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

export class CodexAppServerAdapter {
  private readonly pendingApprovalRequests = new Set<RpcId>();

  constructor(
    private readonly client: JsonRpcClient,
    private readonly options: CodexAppServerAdapterOptions,
  ) {}

  initialize(): Promise<unknown> {
    return this.client.initialize({
      name: "codex_remote_host",
      title: "Codex Remote Host",
      version: "0.1.0",
    });
  }

  async listThreads(input: ListThreadsInput): Promise<ThreadSummary[]> {
    const workspace = this.workspaceFor(input.workspaceId);
    return this.client
      .request<ThreadListResult>("thread/list", {
        limit: input.limit ?? 25,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        cwd: workspace.path,
      })
      .then((result) => result.data ?? []);
  }

  async readThread(input: ReadThreadInput): Promise<ThreadSnapshot> {
    this.workspaceFor(input.workspaceId);
    return this.client
      .request<CodexThreadReadResponse>("thread/read", {
        threadId: input.threadId,
        includeTurns: true,
      })
      .then((result) => result.thread);
  }

  async startThread(input: StartThreadInput): Promise<ThreadSnapshot> {
    const workspace = this.workspaceFor(input.workspaceId);
    return this.client
      .request<CodexThreadStartResponse>("thread/start", {
        cwd: workspace.path,
        approvalPolicy: this.approvalPolicy(),
        sandbox: this.threadSandbox(),
      })
      .then((result) => result.thread);
  }

  async resumeThread(input: ReadThreadInput): Promise<ThreadSnapshot> {
    const workspace = this.workspaceFor(input.workspaceId);
    return this.client
      .request<CodexThreadResumeResponse>("thread/resume", {
        threadId: input.threadId,
        cwd: workspace.path,
        approvalPolicy: this.approvalPolicy(),
        sandbox: this.threadSandbox(),
      })
      .then((result) => result.thread);
  }

  async startTurn(input: StartTurnInput): Promise<TurnHandle> {
    const workspace = this.workspaceFor(input.workspaceId);
    return this.client
      .request<CodexTurnStartResponse>("turn/start", {
        threadId: input.threadId,
        input: [this.textInput(input.text)],
        cwd: workspace.path,
        ...this.executionPolicy(workspace),
      })
      .then((result) => {
        return { id: result.turn.id };
      });
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    this.workspaceFor(input.workspaceId);
    return this.client
      .request("turn/steer", {
        threadId: input.threadId,
        expectedTurnId: input.turnId,
        input: [this.textInput(input.text)],
      })
      .then(() => undefined);
  }

  interruptTurn(input: InterruptTurnInput): Promise<void> {
    return this.client
      .request("turn/interrupt", {
        threadId: input.threadId,
        turnId: input.turnId,
      })
      .then(() => undefined);
  }

  async resolveApproval(input: ApprovalResponse): Promise<void> {
    if (!this.pendingApprovalRequests.delete(input.requestId)) {
      throw new Error("Approval request is not pending");
    }
    this.client.respondToServerRequest(input.requestId, {
      decision: input.decision,
    });
  }

  onApprovalRequest(handler: ApprovalRequestHandler): () => void {
    return this.client.onServerRequest(async (request) => {
      if (!approvalRequestMethods.has(request.method)) {
        return undefined;
      }
      this.pendingApprovalRequests.add(request.id);
      await handler(request);
      return undefined;
    });
  }

  onNotification(
    handler: (notification: JsonRpcNotification) => void,
  ): () => void {
    return this.client.onNotification(handler);
  }

  private workspaceFor(workspaceId: string): AuthorizedWorkspace {
    const workspace = this.options.authorizedWorkspaces.find(
      (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) {
      throw new Error("Workspace is not authorized");
    }
    return workspace;
  }

  private executionPolicy(workspace: AuthorizedWorkspace): {
    approvalPolicy: CodexApprovalPolicy;
    sandboxPolicy: CodexWorkspaceWriteSandboxPolicy;
  } {
    return {
      approvalPolicy: this.approvalPolicy(),
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [workspace.path],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    };
  }

  private approvalPolicy(): "on-request" {
    return "on-request";
  }

  private threadSandbox(): CodexThreadSandbox {
    return "workspace-write";
  }

  private textInput(text: string): CodexUserTextInput {
    return { type: "text", text, text_elements: [] };
  }
}
