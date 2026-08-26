import type {
  ThreadSnapshot,
  ThreadSummary,
} from "./codex-app-server-adapter.js";
import type {
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "./json-rpc-client.js";
import type {
  HostSnapshot,
  RemoteThreadSnapshot,
  RemoteThreadSummary,
  RemoteTimelineItem,
} from "@codex-remote/protocol";

type UnknownRecord = Record<string, unknown>;

export interface ThreadMappingOptions {
  workspaceId: string;
  readOnly: boolean;
}

export interface ApprovalDisplay {
  requestId: string | number;
  threadId: string;
  turnId: string;
  method: string;
  display: { title: string };
  allowedDecisions: ["accept", "acceptForSession", "decline", "cancel"];
}

export class CodexEventMapper {
  hostSnapshot(input: {
    hostId: string;
    name: string;
    workspaces: Array<{ id: string; name: string }>;
    online: boolean;
  }): HostSnapshot {
    return {
      ...input,
      observedAt: new Date().toISOString(),
    };
  }

  threadSummary(
    raw: ThreadSummary,
    options: ThreadMappingOptions,
  ): RemoteThreadSummary {
    const record = asRecord(raw);
    const state = normalizeState(record);
    const id =
      stringValue(record.id) ?? stringValue(record.threadId) ?? "unknown";
    const known = id !== "unknown" && state !== "unknown";
    return {
      id,
      workspaceId: options.workspaceId,
      title:
        stringValue(record.title) ?? stringValue(record.name) ?? "未命名会话",
      updatedAt: dateValue(record.updatedAt) ?? new Date().toISOString(),
      state,
      readOnly: options.readOnly || !known,
    };
  }

  threadSnapshot(
    raw: ThreadSnapshot,
    options: ThreadMappingOptions,
  ): RemoteThreadSnapshot {
    const record = asRecord(raw);
    const summary = this.threadSummary(raw, options);
    const activeTurnId = stringValue(record.activeTurnId);
    return {
      id: summary.id,
      workspaceId: options.workspaceId,
      title: summary.title,
      state: summary.state,
      readOnly: summary.readOnly,
      ...(activeTurnId ? { activeTurnId } : {}),
      items: this.timelineItems(record),
    };
  }

  approvalRequest(request: JsonRpcServerRequest): ApprovalDisplay | null {
    const params = asRecord(request.params);
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    if (!threadId || !turnId) {
      return null;
    }
    return {
      requestId: request.id,
      threadId,
      turnId,
      method: request.method,
      display: { title: "需要确认操作" },
      allowedDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    };
  }

  streamDelta(notification: JsonRpcNotification): {
    threadId: string;
    turnId: string;
    delta: string;
  } | null {
    const params = asRecord(notification.params);
    const delta = stringValue(params.delta) ?? stringValue(params.text);
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    if (!delta || !threadId || !turnId) {
      return null;
    }
    return { threadId, turnId, delta };
  }

  turnStatus(notification: JsonRpcNotification): {
    threadId: string;
    turnId: string;
    status: "queued" | "inProgress" | "completed" | "failed" | "interrupted";
  } | null {
    const params = asRecord(notification.params);
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    const rawStatus = stringValue(params.status);
    const status = normalizeTurnStatus(rawStatus);
    if (!threadId || !turnId || !status) {
      return null;
    }
    return { threadId, turnId, status };
  }

  private timelineItems(record: UnknownRecord): RemoteTimelineItem[] {
    const rawItems = Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.turns)
        ? record.turns.flatMap((turn) => {
            const turnRecord = asRecord(turn);
            return Array.isArray(turnRecord.items) ? turnRecord.items : [];
          })
        : [];
    return rawItems.flatMap((item, index) => {
      const itemRecord = asRecord(item);
      const text =
        stringValue(itemRecord.text) ?? stringValue(itemRecord.content);
      if (!text) {
        return [];
      }
      const rawKind =
        stringValue(itemRecord.kind) ?? stringValue(itemRecord.type);
      const kind =
        rawKind === "reasoning" ||
        rawKind === "command" ||
        rawKind === "fileChange"
          ? rawKind
          : "text";
      const role =
        rawKind === "tool" || rawKind === "command" ? "tool" : "assistant";
      return [
        {
          id: stringValue(itemRecord.id) ?? `item-${index}`,
          role,
          kind,
          text,
          status: "completed",
        } satisfies RemoteTimelineItem,
      ];
    });
  }
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateValue(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function normalizeState(record: UnknownRecord): "idle" | "running" | "unknown" {
  const value = stringValue(record.state) ?? stringValue(record.status);
  if (!value) {
    return "unknown";
  }
  if (["running", "in_progress", "inProgress", "active"].includes(value)) {
    return "running";
  }
  if (["idle", "completed", "complete", "done", "stopped"].includes(value)) {
    return "idle";
  }
  return "unknown";
}

function normalizeTurnStatus(
  value: string | undefined,
): "queued" | "inProgress" | "completed" | "failed" | "interrupted" | null {
  if (
    value === "queued" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  ) {
    return value;
  }
  if (
    value === "running" ||
    value === "in_progress" ||
    value === "inProgress"
  ) {
    return "inProgress";
  }
  return null;
}
