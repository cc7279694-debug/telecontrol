import React, { useState } from "react";
import type { DesktopState } from "../desktop/contract.js";

type WorkspacesScreenProps = {
  workspaces: DesktopState["workspaces"];
  disabled: boolean;
  onChoose: () => void;
  onRemove: (workspaceId: string) => void;
};

export function WorkspacesScreen({
  workspaces,
  disabled,
  onChoose,
  onRemove,
}: WorkspacesScreenProps) {
  const [confirmingWorkspaceId, setConfirmingWorkspaceId] = useState<
    string | null
  >(null);

  return (
    <section className="feature-card" aria-labelledby="workspaces-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本机授权</p>
          <h2 id="workspaces-title">项目目录</h2>
        </div>
        <button type="button" onClick={onChoose} disabled={disabled}>
          添加项目
        </button>
      </div>
      {workspaces.length === 0 ? (
        <p className="detail">还没有授权项目，请先添加一个项目文件夹。</p>
      ) : (
        <ul className="workspace-list">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <div>
                <strong>{workspace.name}</strong>
                <span>{workspace.path}</span>
              </div>
              {confirmingWorkspaceId === workspace.id ? (
                <div className="workspace-actions">
                  <span className="workspace-confirmation">
                    确定移除“{workspace.name}”？
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setConfirmingWorkspaceId(null);
                      onRemove(workspace.id);
                    }}
                    disabled={disabled}
                  >
                    确认移除
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirmingWorkspaceId(null)}
                    disabled={disabled}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirmingWorkspaceId(workspace.id)}
                  disabled={disabled}
                >
                  移除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
