import type { PairedHostRecord } from "./paired-host-registry";

export type RemoteSessionState =
  | { status: "loading" }
  | { status: "unpaired" }
  | { status: "connecting"; host: PairedHostRecord }
  | { status: "ready"; host: PairedHostRecord }
  | { status: "offline"; host: PairedHostRecord; message: string }
  | { status: "error"; message: string };

export const initialRemoteSessionState: RemoteSessionState = {
  status: "loading",
};

export type RemoteSessionAction =
  | { type: "pair.missing" }
  | { type: "pair.found"; host: PairedHostRecord }
  | { type: "session.retry" }
  | { type: "connection.ready" }
  | { type: "connection.offline"; message: string }
  | { type: "session.error"; message: string };

export function remoteSessionReducer(
  state: RemoteSessionState,
  action: RemoteSessionAction,
): RemoteSessionState {
  switch (action.type) {
    case "pair.missing":
      return { status: "unpaired" };
    case "pair.found":
      return { status: "connecting", host: action.host };
    case "session.retry":
      return { status: "loading" };
    case "connection.ready":
      return state.status === "connecting"
        ? { status: "ready", host: state.host }
        : state;
    case "connection.offline":
      return state.status === "connecting" || state.status === "ready"
        ? { status: "offline", host: state.host, message: action.message }
        : state;
    case "session.error":
      return { status: "error", message: action.message };
  }
}
