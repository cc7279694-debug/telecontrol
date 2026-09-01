import type {
  HostSnapshot,
  RemoteEvent,
  RemoteThreadSnapshot,
  RemoteTimelineItem,
  RemoteThreadSummary,
} from "@codex-remote/protocol";

const STREAM_ITEM_PREFIX = "remote-stream:";
const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted"]);

export interface RemoteState {
  hostSnapshot: HostSnapshot | null;
  threadSummaries: RemoteThreadSummary[];
  threadSnapshots: Record<string, RemoteThreadSnapshot>;
  streams: Record<string, { sequence: number; text: string }>;
  turnStatuses: Record<string, string>;
  pendingApprovals: Record<
    string,
    Extract<RemoteEvent, { type: "approval.request" }>
  >;
  commandReceipts: Record<
    string,
    Extract<RemoteEvent, { type: "command.receipt" }>
  >;
  lastTurnStatus: string | null;
  online: boolean;
  observedAt: string | null;
  needsSnapshot: boolean;
  error: string | null;
}

export const initialRemoteState: RemoteState = {
  hostSnapshot: null,
  threadSummaries: [],
  threadSnapshots: {},
  streams: {},
  turnStatuses: {},
  pendingApprovals: {},
  commandReceipts: {},
  lastTurnStatus: null,
  online: false,
  observedAt: null,
  needsSnapshot: false,
  error: null,
};

export type RemoteAction =
  | { type: "noop" }
  | { type: "connected"; observedAt: string }
  | {
      type: "host.presence";
      event: Extract<RemoteEvent, { type: "host.presence" }>;
    }
  | {
      type: "host.snapshot.result";
      event: Extract<RemoteEvent, { type: "host.snapshot.result" }>;
    }
  | {
      type: "thread.list.result";
      event: Extract<RemoteEvent, { type: "thread.list.result" }>;
    }
  | {
      type: "thread.snapshot";
      event: Extract<RemoteEvent, { type: "thread.snapshot" }>;
    }
  | {
      type: "stream.delta";
      event: Extract<RemoteEvent, { type: "stream.delta" }>;
    }
  | {
      type: "turn.status";
      event: Extract<RemoteEvent, { type: "turn.status" }>;
    }
  | {
      type: "approval.request";
      event: Extract<RemoteEvent, { type: "approval.request" }>;
    }
  | {
      type: "command.receipt";
      event: Extract<RemoteEvent, { type: "command.receipt" }>;
    }
  | { type: "error"; event: Extract<RemoteEvent, { type: "error" }> };

export function remoteReducer(
  state: RemoteState,
  action: RemoteAction,
): RemoteState {
  switch (action.type) {
    case "noop":
      return state;
    case "connected":
      return {
        ...state,
        online: true,
        observedAt: action.observedAt,
        error: null,
      };
    case "host.presence":
      return {
        ...state,
        online: action.event.online,
        observedAt: action.event.observedAt,
      };
    case "host.snapshot.result":
      return {
        ...state,
        hostSnapshot: action.event.snapshot,
        online: action.event.snapshot.online,
        observedAt: action.event.snapshot.observedAt,
        needsSnapshot: false,
        error: null,
      };
    case "thread.list.result":
      return { ...state, threadSummaries: action.event.threads, error: null };
    case "thread.snapshot":
      return {
        ...state,
        threadSnapshots: {
          ...state.threadSnapshots,
          [action.event.snapshot.id]: action.event.snapshot,
        },
        error: null,
      };
    case "stream.delta": {
      const key = `${action.event.threadId}:${action.event.turnId}`;
      const previous = state.streams[key];
      if (previous && action.event.sequence > previous.sequence + 1) {
        return { ...state, needsSnapshot: true };
      }
      if (previous && action.event.sequence <= previous.sequence) {
        return state;
      }
      const text = `${previous?.text ?? ""}${action.event.delta}`;
      const knownStatus = state.turnStatuses[key];
      const streamItem = {
        id: `${STREAM_ITEM_PREFIX}${action.event.turnId}`,
        role: "assistant" as const,
        kind: "text" as const,
        text,
        status: timelineStatus(knownStatus),
      } satisfies RemoteTimelineItem;
      const currentSnapshot = state.threadSnapshots[action.event.threadId];
      const existingStreamItem = currentSnapshot?.items.some(
        (item) => item.id === streamItem.id,
      );
      const nextSnapshot = currentSnapshot
        ? {
            ...currentSnapshot,
            ...(TERMINAL_TURN_STATUSES.has(knownStatus)
              ? {}
              : {
                  state: "running" as const,
                  activeTurnId: action.event.turnId,
                }),
            items: existingStreamItem
              ? currentSnapshot.items.map((item) =>
                  item.id === streamItem.id ? streamItem : item,
                )
              : [...currentSnapshot.items, streamItem],
          }
        : undefined;
      return {
        ...state,
        streams: {
          ...state.streams,
          [key]: {
            sequence: action.event.sequence,
            text,
          },
        },
        ...(nextSnapshot
          ? {
              threadSnapshots: {
                ...state.threadSnapshots,
                [action.event.threadId]: nextSnapshot,
              },
            }
          : {}),
      };
    }
    case "turn.status": {
      const turnKey = `${action.event.threadId}:${action.event.turnId}`;
      const pendingApprovals =
        action.event.status === "completed" ||
        action.event.status === "failed" ||
        action.event.status === "interrupted"
          ? Object.fromEntries(
              Object.entries(state.pendingApprovals).filter(
                ([, approval]) =>
                  approval.threadId !== action.event.threadId ||
                  approval.turnId !== action.event.turnId,
              ),
            )
          : state.pendingApprovals;
      const currentSnapshot = state.threadSnapshots[action.event.threadId];
      const nextSnapshot = currentSnapshot
        ? updateSnapshotForTurnStatus(currentSnapshot, action.event)
        : undefined;
      return {
        ...state,
        lastTurnStatus: action.event.status,
        turnStatuses: {
          ...state.turnStatuses,
          [turnKey]: action.event.status,
        },
        pendingApprovals,
        ...(nextSnapshot
          ? {
              threadSnapshots: {
                ...state.threadSnapshots,
                [action.event.threadId]: nextSnapshot,
              },
            }
          : {}),
      };
    }
    case "approval.request":
      return {
        ...state,
        pendingApprovals: {
          ...state.pendingApprovals,
          [String(action.event.requestId)]: action.event,
        },
      };
    case "command.receipt":
      return {
        ...state,
        commandReceipts: {
          ...state.commandReceipts,
          [action.event.messageId]: action.event,
        },
      };
    case "error":
      return { ...state, error: action.event.message };
  }
}

function updateSnapshotForTurnStatus(
  snapshot: RemoteThreadSnapshot,
  event: Extract<RemoteEvent, { type: "turn.status" }>,
): RemoteThreadSnapshot {
  const streamItemId = `${STREAM_ITEM_PREFIX}${event.turnId}`;
  const items = snapshot.items.map((item) =>
    item.id === streamItemId
      ? { ...item, status: timelineStatus(event.status) }
      : item,
  );

  if (event.status === "queued" || event.status === "inProgress") {
    return {
      ...snapshot,
      state: "running",
      activeTurnId: event.turnId,
      items,
    };
  }

  const nextSnapshot = {
    ...snapshot,
    state: "idle" as const,
    items,
  };
  if (nextSnapshot.activeTurnId === event.turnId) {
    delete nextSnapshot.activeTurnId;
  }
  return nextSnapshot;
}

function timelineStatus(
  status: string | undefined,
): NonNullable<RemoteTimelineItem["status"]> {
  if (
    status === "completed" ||
    status === "failed" ||
    status === "interrupted"
  ) {
    return status;
  }
  return "inProgress";
}
