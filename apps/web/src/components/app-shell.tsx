import React from "react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({
  children,
  action = true,
}: {
  children: React.ReactNode;
  action?: boolean;
}) {
  return (
    <main className="min-h-dvh px-4 pb-8 pt-4 sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex min-h-11 items-center justify-between gap-3">
          <Link
            className="rounded-lg text-sm font-bold tracking-tight text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            href="/hosts"
          >
            Codex Remote
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {action ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
                href="/pair"
              >
                添加电脑
              </Link>
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
