import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const subscriptionsQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    returns: vi.fn(),
  };
  const deletionQuery = {
    delete: vi.fn(),
    eq: vi.fn(),
  };
  return {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
    getPushConfig: vi.fn(),
    schema: vi.fn(),
    privateFrom: vi.fn(),
    subscriptionsQuery,
    deletionQuery,
    admin: { schema: vi.fn() },
  };
});

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mocks.setVapidDetails,
    sendNotification: mocks.sendNotification,
  },
}));
vi.mock("../../lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => mocks.admin,
}));
vi.mock("./push-config", () => ({
  getPushConfig: mocks.getPushConfig,
}));

import {
  isExpiredSubscription,
  sendPushNotificationToOwner,
} from "./push-server";

describe("push server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPushConfig.mockReturnValue({
      subject: "mailto:test@example.com",
      publicKey: "public-key",
      privateKey: "private-key",
    });
    mocks.admin.schema.mockReturnValue({ from: mocks.privateFrom });
    mocks.privateFrom
      .mockReturnValueOnce(mocks.subscriptionsQuery)
      .mockReturnValueOnce(mocks.deletionQuery)
      .mockReturnValueOnce(mocks.deletionQuery);
    mocks.subscriptionsQuery.select.mockReturnValue(mocks.subscriptionsQuery);
    mocks.subscriptionsQuery.eq.mockReturnValue(mocks.subscriptionsQuery);
    mocks.subscriptionsQuery.returns.mockResolvedValue({
      data: [
        {
          id: "subscription-404",
          endpoint: "https://push.example.test/404",
          p256dh: "public-key-1",
          auth: "auth-1",
        },
        {
          id: "subscription-410",
          endpoint: "https://push.example.test/410",
          p256dh: "public-key-2",
          auth: "auth-2",
        },
        {
          id: "subscription-ok",
          endpoint: "https://push.example.test/ok",
          p256dh: "public-key-3",
          auth: "auth-3",
        },
      ],
      error: null,
    });
    mocks.deletionQuery.delete.mockReturnValue(mocks.deletionQuery);
    mocks.deletionQuery.eq.mockResolvedValue({ error: null });
    mocks.sendNotification
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockResolvedValueOnce(undefined);
  });

  it("cleans up both 404 and 410 subscriptions while delivering valid ones", async () => {
    const result = await sendPushNotificationToOwner({
      ownerId: "owner-1",
      notification: {
        kind: "completed",
        title: "Codex Remote 任务完成",
        body: "远程任务已完成",
        data: { hostId: "host-1", eventId: "event-1" },
      },
    });

    expect(result).toEqual({ sent: 1, removed: 2, configured: true });
    expect(mocks.deletionQuery.eq).toHaveBeenNthCalledWith(
      1,
      "id",
      "subscription-404",
    );
    expect(mocks.deletionQuery.eq).toHaveBeenNthCalledWith(
      2,
      "id",
      "subscription-410",
    );
  });

  it("recognizes only expired subscription status codes", () => {
    expect(isExpiredSubscription({ statusCode: 404 })).toBe(true);
    expect(isExpiredSubscription({ statusCode: 410 })).toBe(true);
    expect(isExpiredSubscription({ statusCode: 500 })).toBe(false);
  });
});
