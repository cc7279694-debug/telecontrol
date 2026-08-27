import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceAuthorizerError,
  createWorkspaceAuthorizer,
  type WorkspaceDirectorySystem,
} from "./workspace-authorizer.js";

const firstWorkspace = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Remote project",
  path: "C:\\Users\\demo\\Projects\\remote-project",
};

function createFixture() {
  const canonicalPaths = new Map<string, string>([
    [firstWorkspace.path, firstWorkspace.path],
    [
      "C:\\Users\\demo\\Projects\\another",
      "C:\\Users\\demo\\Projects\\another",
    ],
    [
      "C:\\Users\\demo\\Projects\\file.txt",
      "C:\\Users\\demo\\Projects\\file.txt",
    ],
    ["C:\\Links\\project", "D:\\Outside\\project"],
  ]);
  const directories = new Set(canonicalPaths.values());
  directories.delete("C:\\Users\\demo\\Projects\\file.txt");
  const system: WorkspaceDirectorySystem = {
    realpath: vi.fn(async (directoryPath: string) => {
      const canonicalPath = canonicalPaths.get(directoryPath);
      if (!canonicalPath) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return canonicalPath;
    }),
    stat: vi.fn(async (directoryPath: string) => ({
      isDirectory: () => directories.has(directoryPath),
    })),
  };
  let workspaces = [firstWorkspace];
  const save = vi.fn(async (next: typeof workspaces) => {
    workspaces = next;
  });
  const authorizer = createWorkspaceAuthorizer({
    initialWorkspaces: workspaces,
    save,
    system,
  });
  return { authorizer, directories, save, system };
}

describe("workspace authorizer", () => {
  it("adds a real directory and keeps its generated id when the label changes", async () => {
    const { authorizer } = createFixture();

    const workspace = await authorizer.addDirectory(
      "C:\\Users\\demo\\Projects\\another",
    );
    const renamed = await authorizer.renameWorkspace(
      workspace.id,
      "客户端项目",
    );

    expect(renamed).toEqual({
      ...workspace,
      name: "客户端项目",
    });
    expect(authorizer.list()).toContainEqual(renamed);
  });

  it("rejects nonexistent paths, files, drive roots, and unsafe symlink targets", async () => {
    const { authorizer, system } = createFixture();
    system.stat = vi.fn(async (directoryPath: string) => ({
      isDirectory: () =>
        directoryPath !== "C:\\Users\\demo\\Projects\\file.txt",
    }));

    await expect(authorizer.addDirectory("C:\\missing")).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
    await expect(
      authorizer.addDirectory("C:\\Users\\demo\\Projects\\file.txt"),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_DIRECTORY" });
    await expect(authorizer.addDirectory("C:\\")).rejects.toMatchObject({
      code: "WORKSPACE_DRIVE_ROOT",
    });
    await expect(
      authorizer.addDirectory("C:\\Links\\project"),
    ).rejects.toMatchObject({
      code: "WORKSPACE_UNSAFE_LINK",
    });
  });

  it("rejects duplicate real paths using Windows case-insensitive comparison", async () => {
    const { authorizer, system } = createFixture();
    system.realpath = vi.fn(
      async () => "c:\\USERS\\DEMO\\PROJECTS\\REMOTE-PROJECT\\",
    );
    system.stat = vi.fn(async () => ({ isDirectory: () => true }));

    await expect(
      authorizer.addDirectory("c:\\USERS\\DEMO\\PROJECTS\\REMOTE-PROJECT\\"),
    ).rejects.toMatchObject({ code: "WORKSPACE_DUPLICATE" });
  });

  it("allows removing a missing directory but rejects removal during an active turn", async () => {
    const { authorizer, directories } = createFixture();
    directories.delete(firstWorkspace.path);

    await expect(
      authorizer.removeWorkspace(firstWorkspace.id),
    ).resolves.toBeUndefined();
    expect(authorizer.list()).toEqual([]);

    const fixture = createFixture();
    await expect(
      fixture.authorizer.removeWorkspace(firstWorkspace.id, () => true),
    ).rejects.toMatchObject({ code: "WORKSPACE_IN_USE" });
  });

  it("maps filesystem failures to safe user-facing errors", async () => {
    const { authorizer, system } = createFixture();
    system.realpath = vi.fn(async () => {
      throw new WorkspaceAuthorizerError("WORKSPACE_IO_FAILED");
    });

    await expect(
      authorizer.addDirectory(firstWorkspace.path),
    ).rejects.toMatchObject({
      code: "WORKSPACE_IO_FAILED",
    });
  });
});
