"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase/browser";
import { DeviceIdentityStore } from "../device/device-key-store";
import {
  BrowserRemoteClient,
  type RemoteClient,
} from "../remote/remote-client";
import { RemoteProvider } from "../remote/remote-client-context";
import {
  initialRemoteSessionState,
  remoteSessionReducer,
  type RemoteSessionState,
} from "./remote-session-state";
import {
  PairedHostRegistry,
  type PairedHostRecord,
} from "./paired-host-registry";

interface RemoteSessionContextValue {
  state: RemoteSessionState;
}

export interface RemoteSessionDependencies {
  loadPair: () => Promise<PairedHostRecord | null>;
  createClient: () => RemoteClient;
}

export interface RemoteSessionProviderProps {
  children: React.ReactNode;
  dependencies?: RemoteSessionDependencies;
}

const RemoteSessionContext = createContext<RemoteSessionContextValue | null>(
  null,
);

export function RemoteSessionProvider({
  children,
  dependencies,
}: RemoteSessionProviderProps) {
  const resolvedDependencies = useMemo<RemoteSessionDependencies>(() => {
    if (dependencies) {
      return dependencies;
    }
    const supabase = createBrowserSupabaseClient();
    const deviceStore = new DeviceIdentityStore();
    const registry = new PairedHostRegistry(supabase, deviceStore);
    return {
      loadPair: () => registry.load(),
      createClient: () =>
        new BrowserRemoteClient(supabase as never, deviceStore),
    };
  }, [dependencies]);
  const [state, dispatch] = useReducer(
    remoteSessionReducer,
    initialRemoteSessionState,
  );

  useEffect(() => {
    let disposed = false;
    void resolvedDependencies
      .loadPair()
      .then((host) => {
        if (!disposed) {
          dispatch(
            host ? { type: "pair.found", host } : { type: "pair.missing" },
          );
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          dispatch({
            type: "session.error",
            message:
              error instanceof Error ? error.message : "电脑配对状态读取失败",
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [resolvedDependencies]);

  const host = "host" in state ? state.host : null;
  const client = useMemo(
    () => (host ? resolvedDependencies.createClient() : null),
    [host, resolvedDependencies],
  );
  const handleConnectionState = useCallback(
    (
      connection:
        | { status: "connecting" }
        | { status: "ready" }
        | { status: "offline"; message: string }
        | { status: "error"; message: string },
    ) => {
      if (connection.status === "ready") {
        dispatch({ type: "connection.ready" });
      } else if (connection.status === "offline") {
        dispatch({ type: "connection.offline", message: connection.message });
      } else if (connection.status === "error") {
        dispatch({ type: "session.error", message: connection.message });
      }
    },
    [],
  );

  return (
    <RemoteSessionContext.Provider value={{ state }}>
      {host && client ? (
        <RemoteProvider
          client={client}
          hostId={host.hostId}
          deviceId={host.deviceId}
          onConnectionStateChange={handleConnectionState}
        >
          {children}
        </RemoteProvider>
      ) : (
        children
      )}
    </RemoteSessionContext.Provider>
  );
}

export function useRemoteSession(): RemoteSessionContextValue {
  const context = useContext(RemoteSessionContext);
  if (!context) {
    throw new Error("useRemoteSession 必须在 RemoteSessionProvider 内使用");
  }
  return context;
}
