import React from "react";
import type { WorkspaceSummary } from "@codex-remote/protocol";

export function WorkspaceSwitcher({
  workspaces,
  value,
  onChange,
}: {
  workspaces: WorkspaceSummary[];
  value: string;
  onChange: (workspaceId: string) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
      授权项目
      <select
        aria-label="授权项目"
        className="mt-2 min-h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-zinc-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-zinc-950/60 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}
