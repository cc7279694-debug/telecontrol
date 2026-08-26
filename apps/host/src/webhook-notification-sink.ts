import type {
  HostNotificationMetadata,
  HostNotificationSink,
} from "./remote-command-runner.js";

export type { HostNotificationMetadata };

export interface WebhookNotificationSinkOptions {
  endpoint: string;
  accessToken: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function createWebhookNotificationSink(
  options: WebhookNotificationSinkOptions,
): HostNotificationSink {
  const endpoint = validateEndpoint(options.endpoint);
  const accessToken = options.accessToken.trim();
  if (!accessToken) throw new Error("通知访问令牌不能为空");
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("通知超时时间无效");
  }

  return {
    async notify(metadata) {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(metadata),
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) throw new Error("通知服务请求超时");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(`通知服务返回 ${response.status}`);
      }
    },
  };
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("通知地址无效");
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("通知地址必须使用 HTTPS");
  }
  return url.toString();
}
