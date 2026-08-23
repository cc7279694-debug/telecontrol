export type RpcId = string | number;

export interface LineChannel {
  write(line: string): void;
  onLine(handler: (line: string) => void): () => void;
  close?(): void;
}

export interface JsonRpcServerRequest {
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface JsonRpcError {
  code?: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  id: RpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export type ServerRequestHandler = (
  request: JsonRpcServerRequest,
) => Promise<unknown | undefined> | unknown | undefined;

export type NotificationHandler = (notification: JsonRpcNotification) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class JsonRpcClient {
  private nextRequestId = 1;
  private readonly pending = new Map<RpcId, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private serverRequestHandler: ServerRequestHandler | undefined;
  private readonly disposeLineHandler: () => void;

  constructor(private readonly channel: LineChannel) {
    this.disposeLineHandler = channel.onLine((line) => this.handleLine(line));
  }

  request<TResult = unknown>(
    method: string,
    params: unknown = {},
  ): Promise<TResult> {
    const id = this.nextRequestId++;
    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });

    this.write({ id, method, params });
    return promise;
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ method, params });
  }

  async initialize(clientInfo: {
    name: string;
    title: string;
    version: string;
  }): Promise<unknown> {
    const result = await this.request("initialize", {
      clientInfo,
      capabilities: null,
    });
    this.notify("initialized", {});
    return result;
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = undefined;
      }
    };
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  respondToServerRequest(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  close(reason = new Error("JSON-RPC connection closed")): void {
    this.disposeLineHandler();
    this.channel.close?.();
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private write(message: unknown): void {
    this.channel.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof message.method === "string" && "id" in message) {
      void this.handleServerRequest({
        id: message.id as RpcId,
        method: message.method,
        params: message.params,
      });
      return;
    }

    if ("id" in message) {
      this.handleResponse(message as unknown as JsonRpcResponse);
      return;
    }

    if (typeof message.method === "string") {
      const notification = {
        method: message.method,
        params: message.params,
      };
      for (const handler of this.notificationHandlers) {
        handler(notification);
      }
    }
  }

  private async handleServerRequest(
    request: JsonRpcServerRequest,
  ): Promise<void> {
    try {
      if (!this.serverRequestHandler) {
        throw new Error(`No handler registered for ${request.method}`);
      }
      const result = await this.serverRequestHandler(request);
      if (result !== undefined) {
        this.respondToServerRequest(request.id, result);
      }
    } catch (error) {
      this.write({
        id: request.id,
        error: {
          code: -32603,
          message:
            error instanceof Error
              ? error.message
              : "Unknown server request error",
        },
      });
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }
}
