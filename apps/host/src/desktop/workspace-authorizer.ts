import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HostConfig } from "./config-store.js";

export type AuthorizedWorkspace = HostConfig["workspaces"][number];

export type WorkspaceDirectorySystem = {
  realpath: (directoryPath: string) => Promise<string>;
  stat: (directoryPath: string) => Promise<{ isDirectory: () => boolean }>;
};

export type WorkspaceAuthorizerErrorCode =
  | "WORKSPACE_INVALID_PATH"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_NOT_DIRECTORY"
  | "WORKSPACE_DRIVE_ROOT"
  | "WORKSPACE_UNSAFE_LINK"
  | "WORKSPACE_DUPLICATE"
  | "WORKSPACE_NOT_FOUND_IN_CONFIG"
  | "WORKSPACE_IN_USE"
  | "WORKSPACE_IO_FAILED";

const messages: Record<WorkspaceAuthorizerErrorCode, string> = {
  WORKSPACE_INVALID_PATH: "项目目录路径无效",
  WORKSPACE_NOT_FOUND: "项目目录不存在或无法访问",
  WORKSPACE_NOT_DIRECTORY: "请选择文件夹，而不是文件",
  WORKSPACE_DRIVE_ROOT: "不能授权整个磁盘根目录",
  WORKSPACE_UNSAFE_LINK: "项目目录不能通过链接指向其他位置",
  WORKSPACE_DUPLICATE: "这个项目目录已经授权",
  WORKSPACE_NOT_FOUND_IN_CONFIG: "项目目录配置不存在",
  WORKSPACE_IN_USE: "项目正在执行任务，暂时不能移除",
  WORKSPACE_IO_FAILED: "项目目录无法访问，请稍后重试",
};

export class WorkspaceAuthorizerError extends Error {
  constructor(readonly code: WorkspaceAuthorizerErrorCode) {
    super(messages[code]);
    this.name = "WorkspaceAuthorizerError";
  }
}

type WorkspaceAuthorizerOptions = {
  initialWorkspaces?: AuthorizedWorkspace[];
  save: (workspaces: AuthorizedWorkspace[]) => Promise<void>;
  system?: WorkspaceDirectorySystem;
  isWorkspaceInUse?: (workspaceId: string) => boolean;
  idFactory?: () => string;
};

function normalizePath(directoryPath: string) {
  return path.win32.normalize(directoryPath.trim());
}

function comparablePath(directoryPath: string) {
  return normalizePath(directoryPath)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsRoot(directoryPath: string) {
  const normalized = normalizePath(directoryPath);
  return path.win32.parse(normalized).root === normalized;
}

function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAbsoluteWindowsPath(directoryPath: string) {
  return directoryPath.length > 0 && path.win32.isAbsolute(directoryPath);
}

function defaultSystem(): WorkspaceDirectorySystem {
  return { realpath, stat };
}

export function createWorkspaceAuthorizer({
  initialWorkspaces = [],
  save,
  system = defaultSystem(),
  isWorkspaceInUse = () => false,
  idFactory = randomUUID,
}: WorkspaceAuthorizerOptions) {
  let workspaces = [...initialWorkspaces];

  function list() {
    return workspaces.map((workspace) => ({ ...workspace }));
  }

  async function addDirectory(inputPath: string) {
    const selectedPath = inputPath.trim();
    if (!isAbsoluteWindowsPath(selectedPath) || selectedPath.includes("\0")) {
      throw new WorkspaceAuthorizerError("WORKSPACE_INVALID_PATH");
    }
    if (isWindowsRoot(selectedPath)) {
      throw new WorkspaceAuthorizerError("WORKSPACE_DRIVE_ROOT");
    }

    let canonicalPath: string;
    try {
      canonicalPath = normalizePath(await system.realpath(selectedPath));
    } catch (error) {
      if (error instanceof WorkspaceAuthorizerError) throw error;
      throw new WorkspaceAuthorizerError(
        isMissing(error) ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_IO_FAILED",
      );
    }

    if (comparablePath(canonicalPath) !== comparablePath(selectedPath)) {
      throw new WorkspaceAuthorizerError("WORKSPACE_UNSAFE_LINK");
    }

    try {
      const details = await system.stat(canonicalPath);
      if (!details.isDirectory()) {
        throw new WorkspaceAuthorizerError("WORKSPACE_NOT_DIRECTORY");
      }
    } catch (error) {
      if (error instanceof WorkspaceAuthorizerError) throw error;
      throw new WorkspaceAuthorizerError(
        isMissing(error) ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_IO_FAILED",
      );
    }

    if (
      workspaces.some(
        (workspace) =>
          comparablePath(workspace.path) === comparablePath(canonicalPath),
      )
    ) {
      throw new WorkspaceAuthorizerError("WORKSPACE_DUPLICATE");
    }

    const workspace: AuthorizedWorkspace = {
      id: idFactory(),
      name: path.win32.basename(canonicalPath) || canonicalPath,
      path: canonicalPath,
    };
    const next = [...workspaces, workspace];
    await save(next.map((entry) => ({ ...entry })));
    workspaces = next;
    return { ...workspace };
  }

  async function renameWorkspace(workspaceId: string, name: string) {
    const trimmedName = name.trim();
    const index = workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (index < 0 || trimmedName.length === 0 || trimmedName.length > 120) {
      throw new WorkspaceAuthorizerError("WORKSPACE_NOT_FOUND_IN_CONFIG");
    }
    const next = workspaces.map((workspace, currentIndex) =>
      currentIndex === index ? { ...workspace, name: trimmedName } : workspace,
    );
    await save(next.map((entry) => ({ ...entry })));
    workspaces = next;
    return { ...next[index]! };
  }

  async function removeWorkspace(
    workspaceId: string,
    activeTurnCheck: () => boolean = () => isWorkspaceInUse(workspaceId),
  ) {
    const index = workspaces.findIndex(
      (workspace) => workspace.id === workspaceId,
    );
    if (index < 0) {
      throw new WorkspaceAuthorizerError("WORKSPACE_NOT_FOUND_IN_CONFIG");
    }
    if (activeTurnCheck()) {
      throw new WorkspaceAuthorizerError("WORKSPACE_IN_USE");
    }
    const next = workspaces.filter((workspace) => workspace.id !== workspaceId);
    await save(next.map((entry) => ({ ...entry })));
    workspaces = next;
  }

  return { addDirectory, list, removeWorkspace, renameWorkspace };
}
