"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "../../lib/supabase/browser";
import { DeviceIdentityStore } from "../../features/device/device-key-store";
import { DeviceRegistry } from "../../features/device/device-registry";
import { PairingForm } from "../../features/pairing/pairing-form";
import { PairingService } from "../../features/pairing/pairing-service";
import { BrowserRemoteClient } from "../../features/remote/remote-client";

export default function PairPage() {
  const router = useRouter();
  const pairingContext = useMemo(() => {
    const client = createBrowserSupabaseClient();
    const deviceStore = new DeviceIdentityStore();
    const registry = new DeviceRegistry(client, deviceStore);
    const remote = new BrowserRemoteClient(client as never, deviceStore);
    const service = new PairingService(
      client,
      registry,
      async ({ hostId, deviceId }) => {
        await remote.connect({ hostId, deviceId });
        try {
          await remote.requestSnapshot();
        } finally {
          await remote.disconnect();
        }
      },
    );
    return { registry, service };
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-5 py-10">
      <section className="w-full rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-zinc-500">Codex Remote</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          添加 Windows 电脑
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          在 Host 窗口找到电脑 ID 和一次性配对码，输入后建立加密连接。
        </p>
        <div className="mt-6">
          <PairingForm
            consume={async ({ hostId, code }) => {
              const identity = await pairingContext.registry.ensureRegistered();
              return pairingContext.service.consume({
                hostId,
                code,
                deviceId: identity.deviceId,
              });
            }}
            onSuccess={() => router.push("/hosts")}
          />
        </div>
      </section>
    </main>
  );
}
