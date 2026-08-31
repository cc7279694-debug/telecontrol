export type WorkspaceChoiceResult = {
  ok: boolean;
  message: string;
};

export type WorkspaceDirectorySelection = {
  canceled: boolean;
  filePaths: string[];
};

/**
 * Keeps the local folder picker responsive even when cloud registration fails.
 * Registration still happens before the directory is persisted for remote use.
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

  if (!hasRegisteredHost()) {
    const registration = await registerHost();
    if (!registration.ok) return registration;
  }

  return addDirectory(directory);
}
