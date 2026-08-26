"use client";

import React, { createContext, useContext, useEffect, useReducer } from "react";
import type { RemoteEvent } from "@codex-remote/protocol";
import {
  initialRemoteState,
  remoteReducer,
  type RemoteAction,
  type RemoteState,
} from "./remote-reducer";
import type { RemoteClient } from "./remote-client";

interface RemoteContextValue {
  state: RemoteState;
  client: RemoteClient;
}

const RemoteContext = createContext<RemoteContextValue | null>(null);

export interface RemoteProviderProps {
  client: RemoteClient;
  hostId: string;
  deviceId: string;
  children: React.ReactNode;
}

export function RemoteProvider({
  client,
  hostId,
  deviceId,
  children,
}: RemoteProviderProps) {
  const [state, dispatch] = useReducer(remoteReducer, initialRemoteState);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = client.subscribe((event) => {
      if (!disposed) {
        dispatch(eventToAction(event));
      }
    });

    void client
      .connect({ hostId, deviceId })
      .then(async () => {
        if (!disposed) {
          dispatch({ type: "connected", observedAt: new Date().toISOString() });
          await client.requestSnapshot();
        }
      })
      .catch(() => {
        if (!disposed) {
          dispatch({
            type: "error",
            event: {
              type: "error",
              requestMessageId: crypto.randomUUID(),
              code: "connect_failed",
              message: "连接电脑失败，请重试",
            },
          });
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
      void client.disconnect();
    };
  }, [client, deviceId, hostId]);

  return (
    <RemoteContext.Provider value={{ state, client }}>
      {children}
    </RemoteContext.Provider>
  );
}

export function useRemote(): RemoteContextValue {
  const context = useContext(RemoteContext);
  if (!context) {
    throw new Error("useRemote 必须在 RemoteProvider 内使用");
  }
  return context;
}

function eventToAction(event: RemoteEvent): RemoteAction {
  switch (event.type) {
    case "host.presence":
      return { type: "host.presence", event };
    case "host.snapshot.result":
      return { type: "host.snapshot.result", event };
    case "thread.list.result":
      return { type: "thread.list.result", event };
    case "thread.snapshot":
      return { type: "thread.snapshot", event };
    case "stream.delta":
      return { type: "stream.delta", event };
    case "turn.status":
      return { type: "turn.status", event };
    case "approval.request":
      return { type: "approval.request", event };
    case "command.receipt":
      return { type: "command.receipt", event };
    case "error":
      return { type: "error", event };
  }
}
