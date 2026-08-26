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
    <label className="block text-sm font-medium text-zinc-700">
      授权项目
      <select
        aria-label="授权项目"
        className="mt-2 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-300"
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
