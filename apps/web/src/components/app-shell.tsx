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
    <main className="min-h-dvh bg-zinc-100/80 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4 dark:bg-zinc-950 sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-7 flex min-h-11 items-center justify-between gap-3 sm:mb-9">
          <Link
            className="rounded-lg text-base font-bold tracking-tight text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-zinc-100"
            href="/hosts"
          >
            Codex Remote
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {action ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-zinc-950"
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
