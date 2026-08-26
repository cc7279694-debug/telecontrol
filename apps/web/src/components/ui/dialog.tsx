import React from "react";
import { cn } from "../../lib/utils";

export function Dialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/35 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

export function DialogContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-modal="true"
      className={cn(
        "w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl",
        className,
      )}
      role="dialog"
      {...props}
    />
  );
}
