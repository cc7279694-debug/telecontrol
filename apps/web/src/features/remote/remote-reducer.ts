import type {
  HostSnapshot,
  RemoteEvent,
  RemoteThreadSnapshot,
  RemoteThreadSummary,
} from "@codex-remote/protocol";

export interface RemoteState {
  hostSnapshot: HostSnapshot | null;
  threadSummaries: RemoteThreadSummary[];
  threadSnapshots: Record<string, RemoteThreadSnapshot>;
  streams: Record<string, { sequence: number; text: string }>;
  turnStatuses: Record<string, string>;
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
      return {
        ...state,
        streams: {
          ...state.streams,
          [key]: {
            sequence: action.event.sequence,
            text: `${previous?.text ?? ""}${action.event.delta}`,
          },
        },
      };
    }
    case "turn.status":
      return {
        ...state,
        lastTurnStatus: action.event.status,
        turnStatuses: {
          ...state.turnStatuses,
          [`${action.event.threadId}:${action.event.turnId}`]:
            action.event.status,
        },
      };
    case "error":
      return { ...state, error: action.event.message };
  }
}
