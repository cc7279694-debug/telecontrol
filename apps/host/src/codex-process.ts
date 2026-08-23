import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { JsonRpcClient, type LineChannel } from "./json-rpc-client.js";

export interface CodexAppServerLaunchSpec {
  command: string;
  args: string[];
}

export function getCodexAppServerLaunchSpec(
  env: NodeJS.ProcessEnv = process.env,
): CodexAppServerLaunchSpec {
  const configuredPath = env.CODEX_CLI_PATH?.trim();
  const isWindows = env.OS === "Windows_NT" || process.platform === "win32";
  return {
    command: configuredPath || (isWindows ? "codex.cmd" : "codex"),
    args: ["app-server"],
  };
}

export interface StdioChildProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
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
}

export function createCodexAppServerProcess(
  env: NodeJS.ProcessEnv = process.env,
): CodexAppServerProcess {
  const spec = getCodexAppServerLaunchSpec(env);
  const isWindowsScript =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.command);
  const command = isWindowsScript ? env.ComSpec || "cmd.exe" : spec.command;
  const args = isWindowsScript
    ? ["/d", "/c", spec.command, ...spec.args]
    : spec.args;
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  } satisfies SpawnOptions) as StdioChildProcess;
  const channel = new StdioLineChannel(child);
  return {
    child,
    channel,
    client: new JsonRpcClient(channel),
  };
}
