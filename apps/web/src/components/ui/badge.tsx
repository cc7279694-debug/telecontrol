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
        "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold",
        tone === "neutral" && "bg-zinc-100 text-zinc-700",
        tone === "success" && "bg-emerald-100 text-emerald-800",
        tone === "warning" && "bg-amber-100 text-amber-900",
        tone === "danger" && "bg-red-100 text-red-800",
        className,
      )}
      {...props}
    />
  );
}
