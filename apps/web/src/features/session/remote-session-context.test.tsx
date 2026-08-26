// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { HostSnapshot } from "@codex-remote/protocol";
import type { RemoteClient } from "../remote/remote-client";
import type { PairedHostRecord } from "./paired-host-registry";
import {
  RemoteSessionProvider,
  useRemoteSession,
  type RemoteSessionDependencies,
} from "./remote-session-context";

const host: PairedHostRecord = {
  hostId: "host-1",
  hostName: "开发电脑",
  deviceId: "device-1",
  protocolVersion: 1,
};

const snapshot: HostSnapshot = {
  hostId: "host-1",
  name: "开发电脑",
  online: true,
  observedAt: new Date().toISOString(),
  workspaces: [{ id: "workspace-1", name: "项目" }],
};

function Probe() {
  const { state } = useRemoteSession();
  return <output>{state.status}</output>;
}

function createClient(snapshotResult = snapshot) {
  const client = {
    subscribe: vi.fn(() => () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    requestSnapshotAndWait: vi.fn(async () => snapshotResult),
    enqueue: vi.fn(),
    getPresence: vi.fn(),
  } as unknown as RemoteClient;
  return client;
}

function createDependencies(
  pair: PairedHostRecord | null,
  client: RemoteClient,
): RemoteSessionDependencies {
  return {
    loadPair: vi.fn(async () => pair),
    createClient: vi.fn(() => client),
  };
}

describe("RemoteSessionProvider", () => {
  it("shows unpaired when no active Host link exists", async () => {
    const dependencies = createDependencies(null, createClient());
    const view = render(
      <RemoteSessionProvider dependencies={dependencies}>
        <Probe />
      </RemoteSessionProvider>,
    );

    await waitFor(() => expect(view.getByText("unpaired")).toBeTruthy());
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("connects once and becomes ready only after an online snapshot", async () => {
    const client = createClient();
    const dependencies = createDependencies(host, client);
    const view = render(
      <RemoteSessionProvider dependencies={dependencies}>
        <Probe />
      </RemoteSessionProvider>,
    );

    await waitFor(() => expect(view.getByText("ready")).toBeTruthy());
    expect(client.connect).toHaveBeenCalledWith({
      hostId: "host-1",
      deviceId: "device-1",
    });
    expect(client.requestSnapshotAndWait).toHaveBeenCalledTimes(1);
  });

  it("shows offline when the Host snapshot says the computer is offline", async () => {
    const client = createClient({ ...snapshot, online: false });
    const dependencies = createDependencies(host, client);
    const view = render(
      <RemoteSessionProvider dependencies={dependencies}>
        <Probe />
      </RemoteSessionProvider>,
    );

    await waitFor(() => expect(view.getByText("offline")).toBeTruthy());
  });
});
