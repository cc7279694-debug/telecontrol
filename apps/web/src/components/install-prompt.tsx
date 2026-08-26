"use client";

import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(
    null,
  );
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone || !installEvent) {
    return null;
  }
  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-3 text-sm shadow-xl">
      <span className="text-zinc-700">安装到手机主屏幕，打开更方便</span>
      <Button
        onClick={() => {
          void installEvent.prompt();
          void installEvent.userChoice.finally(() => setInstallEvent(null));
        }}
      >
        安装
      </Button>
    </div>
  );
}
