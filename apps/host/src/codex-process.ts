import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { JsonRpcClient, type LineChannel } from "./json-rpc-client.js";

export interface CodexAppServerLaunchSpec {
  command: string;
  args: string[];
}

export function getCodexAppServerLaunchSpec(
  executablePath: string,
): CodexAppServerLaunchSpec {
  return {
    command: executablePath,
    args: ["app-server"],
  };
}

export interface StdioChildProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
  once: (
    event: "exit" | "error",
    listener: (...args: unknown[]) => void,
  ) => unknown;
  removeListener: (
    event: "exit" | "error",
    listener: (...args: unknown[]) => void,
  ) => unknown;
}

export class StdioLineChannel implements LineChannel {
  private readonly handlers = new Set<(line: string) => void>();
  private readonly reader: Interface;

  constructor(private readonly child: StdioChildProcess) {
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => {
      for (const handler of this.handlers) {
        handler(line);
      }
    });
  }

  write(line: string): void {
    this.child.stdin.write(line);
  }

  onLine(handler: (line: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.reader.close();
    this.child.kill();
  }
}

export interface CodexAppServerProcess {
  child: StdioChildProcess;
  channel: StdioLineChannel;
  client: JsonRpcClient;
  close: () => void;
  onExit: (
    handler: (code: number | null, signal: string | null) => void,
  ) => () => void;
  onError: (handler: (error: Error) => void) => () => void;
}

export function createCodexAppServerProcess(
  executablePath: string,
  env: NodeJS.ProcessEnv = process.env,
): CodexAppServerProcess {
  const spec = getCodexAppServerLaunchSpec(executablePath);
  const child = spawn(spec.command, spec.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...env },
  } satisfies SpawnOptions) as StdioChildProcess;
  child.stderr.on("data", () => undefined);
  const channel = new StdioLineChannel(child);
  const client = new JsonRpcClient(channel);
  let closed = false;
  return {
    child,
    channel,
    client,
    close: () => {
      if (closed) return;
      closed = true;
      client.close();
    },
    onExit: (handler) => {
      const listener = (...args: unknown[]) => {
        handler(
          typeof args[0] === "number" ? args[0] : null,
          typeof args[1] === "string" ? args[1] : null,
        );
      };
      child.once("exit", listener);
      return () => child.removeListener("exit", listener);
    },
    onError: (handler) => {
      const listener = (...args: unknown[]) => {
        handler(
          args[0] instanceof Error ? args[0] : new Error("Codex 进程启动失败"),
        );
      };
      child.once("error", listener);
      return () => child.removeListener("error", listener);
    },
  };
}
