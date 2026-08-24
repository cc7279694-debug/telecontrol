import {
  generateP256KeyPair,
  type DeviceKeyPair,
} from "@codex-remote/protocol";
import {
  RemoteCommandRunner,
  type RemoteCommandAdapter,
  type RemoteCommandRunnerOptions,
  type RemoteRunnerTransport,
} from "../remote-command-runner.js";
import type {
  PairingRequest,
  TransportContext,
} from "../supabase-transport.js";

export interface LocalHarnessTransport extends RemoteRunnerTransport {
  connect(context: TransportContext): Promise<void>;
  disconnect(): Promise<void>;
  createPairingRequest(): Promise<PairingRequest>;
}

export interface LocalRemoteHostHarnessOptions {
  supabaseUrl: string;
  transport: LocalHarnessTransport;
  adapter: RemoteCommandAdapter;
  context: TransportContext;
  runner: Omit<RemoteCommandRunnerOptions, "hostPrivateKey">;
  registerHost: (input: {
    hostId: string;
    publicKey: JsonWebKey;
  }) => Promise<void>;
  log?: (message: string) => void;
}

export interface LocalRemoteHostHarness {
  keyPair: DeviceKeyPair;
  runner: RemoteCommandRunner;
  pairing: PairingRequest;
  stop(): Promise<void>;
}

export function assertLoopbackSupabaseUrl(value: string): void {
  const hostname = new URL(value).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("本地开发 Host 只允许连接回环地址");
  }
}

export async function createLocalRemoteHostHarness(
  options: LocalRemoteHostHarnessOptions,
): Promise<LocalRemoteHostHarness> {
  assertLoopbackSupabaseUrl(options.supabaseUrl);
  const keyPair = await generateP256KeyPair();
  await options.registerHost({
    hostId: options.context.hostId,
    publicKey: keyPair.publicKey,
  });
  await options.transport.connect(options.context);
  const pairing = await options.transport.createPairingRequest();
  options.log?.(`本地配对码（5分钟有效）：${pairing.code}`);

  const runner = new RemoteCommandRunner(options.transport, options.adapter, {
    ...options.runner,
    hostPrivateKey: keyPair.privateKey,
  });
  runner.start();

  return {
    keyPair,
    runner,
    pairing,
    async stop() {
      runner.stop();
      await options.transport.disconnect();
    },
  };
}
