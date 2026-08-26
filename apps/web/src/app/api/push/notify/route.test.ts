import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const hostQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return {
    getUser: vi.fn(),
    createBearerSupabaseClient: vi.fn(),
    createAdminSupabaseClient: vi.fn(),
    sendPushNotificationToOwner: vi.fn(),
    hostQuery,
    admin: { from: vi.fn(() => hostQuery) },
  };
});

vi.mock("../../../../lib/supabase/server", () => ({
  createBearerSupabaseClient: mocks.createBearerSupabaseClient,
}));
vi.mock("../../../../lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("../../../../features/notifications/push-server", () => ({
  sendPushNotificationToOwner: mocks.sendPushNotificationToOwner,
}));

import { POST } from "./route";

describe("POST /api/push/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBearerSupabaseClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.createAdminSupabaseClient.mockReturnValue(mocks.admin);
    mocks.hostQuery.select.mockReturnValue(mocks.hostQuery);
    mocks.hostQuery.eq.mockReturnValue(mocks.hostQuery);
    mocks.hostQuery.is.mockReturnValue(mocks.hostQuery);
    mocks.hostQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.sendPushNotificationToOwner.mockResolvedValue({
      sent: 1,
      removed: 0,
      configured: true,
    });
  });

  it("rejects requests without a bearer token", async () => {
    const response = await POST(
      new Request("http://localhost/api/push/notify", {
        method: "POST",
        body: JSON.stringify({
          hostId: "host-1",
          kind: "completed",
          eventId: "event-1",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects a missing or revoked host owned by another account", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "owner-1" } },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/push/notify", {
        method: "POST",
        headers: { authorization: "Bearer valid-access-token" },
        body: JSON.stringify({
          hostId: "host-1",
          kind: "completed",
          eventId: "event-1",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.hostQuery.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(mocks.hostQuery.is).toHaveBeenCalledWith("revoked_at", null);
    expect(mocks.sendPushNotificationToOwner).not.toHaveBeenCalled();
  });

  it("sends a generic notification after verifying the host owner", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "owner-1" } },
      error: null,
    });
    mocks.hostQuery.maybeSingle.mockResolvedValue({
      data: { id: "host-1" },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/push/notify", {
        method: "POST",
        headers: { authorization: "Bearer valid-access-token" },
        body: JSON.stringify({
          hostId: "host-1",
          kind: "completed",
          eventId: "event-1",
          prompt: "C:\\Users\\secret\\prompt.txt",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendPushNotificationToOwner).toHaveBeenCalledWith({
      ownerId: "owner-1",
      notification: {
        kind: "completed",
        title: "Codex Remote 任务完成",
        body: "远程任务已完成",
        data: { hostId: "host-1", eventId: "event-1" },
      },
    });
    expect(
      JSON.stringify(mocks.sendPushNotificationToOwner.mock.calls[0]),
    ).not.toContain("secret");
  });

  it("rejects event metadata that is not opaque", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "owner-1" } },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/push/notify", {
        method: "POST",
        headers: { authorization: "Bearer valid-access-token" },
        body: JSON.stringify({
          hostId: "host-1",
          kind: "completed",
          eventId: "C:\\Users\\secret\\prompt.txt",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.admin.from).not.toHaveBeenCalled();
  });
});
