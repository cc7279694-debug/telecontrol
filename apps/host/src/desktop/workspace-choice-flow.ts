export type WorkspaceChoiceResult = {
  ok: boolean;
  message: string;
};

export type WorkspaceDirectorySelection = {
  canceled: boolean;
  filePaths: string[];
};

/**
 * Keeps a local project selection from being lost when cloud registration fails.
 * The local authorization is useful on its own, while remote control stays
 * unavailable until the Host can register successfully.
 */
export async function runWorkspaceChoice({
  showDirectoryDialog,
  hasRegisteredHost,
  registerHost,
  addDirectory,
}: {
  showDirectoryDialog: () => Promise<WorkspaceDirectorySelection>;
  hasRegisteredHost: () => boolean;
  registerHost: () => Promise<WorkspaceChoiceResult>;
  addDirectory: (directory: string) => Promise<WorkspaceChoiceResult>;
}): Promise<WorkspaceChoiceResult> {
  const selected = await showDirectoryDialog();
  const directory = selected.filePaths[0];
  if (selected.canceled || !directory) {
    return { ok: false, message: "已取消添加项目" };
  }

  const added = await addDirectory(directory);
  if (!added.ok) return added;

  if (!hasRegisteredHost()) {
    const registration = await registerHost();
    if (!registration.ok) {
      return {
        ok: true,
        message: "项目已添加，但 Host 尚未连接，远程控制暂不可用",
      };
    }
  }

  return added;
}
