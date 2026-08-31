import React from "react";
import { cn } from "../../lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold",
        tone === "neutral" &&
          "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        tone === "success" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
        tone === "warning" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300",
        tone === "danger" &&
          "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300",
        className,
      )}
      {...props}
    />
  );
}
