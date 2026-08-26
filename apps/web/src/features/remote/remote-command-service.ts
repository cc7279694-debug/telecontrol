import type {
  RemoteCommand,
  RemoteEvent,
} from "@codex-remote/protocol";
import type { EnqueueOptions, RemoteClient } from "./remote-client";

export interface WaitForEventOptions extends EnqueueOptions {
  timeoutMs?: number;
}

export async function enqueueAndWaitForEvent<T extends RemoteEvent>(
  client: RemoteClient,
  command: RemoteCommand,
  accepts: (event: RemoteEvent) => event is T,
  options: WaitForEventOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let requestMessageId: string | undefined;
    let earlyEvent: T | undefined;
    let unsubscribe: () => void = () => undefined;
    const { timeoutMs = 10_000, ...enqueueOptions } = options;
    const timer = setTimeout(() => {
      finishReject(new Error("电脑响应超时，请重试"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    const finishResolve = (event: T) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(event);
    };
    const finishReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error("电脑响应失败"));
    };

    unsubscribe = client.subscribe((event) => {
      if (!accepts(event)) {
        return;
      }
      if (!requestMessageId) {
        earlyEvent = event;
        return;
      }
      if (eventMessageId(event) === requestMessageId) {
        finishResolve(event);
      }
    });

    void client
      .enqueue(command, enqueueOptions)
      .then((receipt) => {
        requestMessageId = receipt.messageId;
        if (
          earlyEvent &&
          eventMessageId(earlyEvent) === requestMessageId
        ) {
          finishResolve(earlyEvent);
        }
      })
      .catch(finishReject);
  });
}

function eventMessageId(event: RemoteEvent): string | undefined {
  if ("requestMessageId" in event) {
    return event.requestMessageId;
  }
  if (event.type === "command.receipt") {
    return event.messageId;
  }
  return undefined;
}
