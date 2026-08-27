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
              <button
                type="button"
                className="secondary-button"
                onClick={() => onRemove(workspace.id)}
                disabled={disabled}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
