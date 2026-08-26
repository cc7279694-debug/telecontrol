import { describe, expect, it, vi } from "vitest";
import {
  createWebhookNotificationSink,
  type HostNotificationMetadata,
} from "./webhook-notification-sink.js";

describe("webhook notification sink", () => {
  it("posts only safe event metadata with the Host access token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sink = createWebhookNotificationSink({
      endpoint: "https://remote.example.test/api/push/notify",
      accessToken: "access-token-for-test",
      fetcher,
    });
    const metadata: HostNotificationMetadata = {
      hostId: "host-1",
      kind: "approval",
      eventId: "message-1",
    };

    await sink.notify(metadata);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://remote.example.test/api/push/notify");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer access-token-for-test",
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual(metadata);
    expect(JSON.stringify(init?.body)).not.toContain("secret");
  });

  it("allows loopback HTTP for local development and rejects public HTTP", () => {
    expect(() =>
      createWebhookNotificationSink({
        endpoint: "http://127.0.0.1:3000/api/push/notify",
        accessToken: "token",
      }),
    ).not.toThrow();
    expect(() =>
      createWebhookNotificationSink({
        endpoint: "http://remote.example.test/api/push/notify",
        accessToken: "token",
      }),
    ).toThrow("通知地址必须使用 HTTPS");
  });

  it("does not expose or retry a failed notification request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const sink = createWebhookNotificationSink({
      endpoint: "https://remote.example.test/api/push/notify",
      accessToken: "token",
      fetcher,
    });

    await expect(
      sink.notify({ hostId: "host-1", kind: "failed", eventId: "message-1" }),
    ).rejects.toThrow("通知服务返回 503");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled notification request after the configured timeout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const sink = createWebhookNotificationSink({
      endpoint: "https://remote.example.test/api/push/notify",
      accessToken: "token",
      fetcher,
      timeoutMs: 5,
    });

    await expect(
      sink.notify({ hostId: "host-1", kind: "completed", eventId: "event-1" }),
    ).rejects.toThrow("通知服务请求超时");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
