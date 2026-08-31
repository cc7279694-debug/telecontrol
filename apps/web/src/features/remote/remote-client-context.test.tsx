// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteProvider } from "./remote-client-context";
import type { RemoteClient } from "./remote-client";

describe("RemoteProvider", () => {
  afterEach(cleanup);

  it("keeps the Realtime failure status in the connection error", async () => {
    const client = {
      subscribe: vi.fn(() => () => undefined),
      connect: vi.fn(async () => {
        throw new Error("实时连接失败：TIMED_OUT");
      }),
      disconnect: vi.fn(async () => undefined),
    } as unknown as RemoteClient;
    const onConnectionStateChange = vi.fn();

    render(
      <RemoteProvider
        client={client}
        hostId="host-1"
        deviceId="device-1"
        onConnectionStateChange={onConnectionStateChange}
      >
        <div />
      </RemoteProvider>,
    );

    await waitFor(() =>
      expect(onConnectionStateChange).toHaveBeenCalledWith({
        status: "error",
        message: "实时连接失败：TIMED_OUT",
      }),
    );
  });
});
