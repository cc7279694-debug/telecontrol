import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { runUnpackedHostSmoke } from "./smoke-unpacked-host.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "codex-smoke-test-"));
  temporaryDirectories.push(root);
  const releaseDir = join(root, "release");
  const unpackedDir = join(releaseDir, "win-unpacked");
  mkdirSync(unpackedDir, { recursive: true });
  const executablePath = join(unpackedDir, "Codex Remote Host.exe");
  writeFileSync(executablePath, "fixture executable");
  return { executablePath, releaseDir, root, unpackedDir };
}

class FakeChild extends EventEmitter {
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

describe("unpacked Host smoke runner", () => {
  it("launches the unpacked Host with package-smoke and resolves on exit 0", async () => {
    const fixture = createFixture();
    const userDataDir = join(fixture.root, "user-data");
    const child = new FakeChild();
    let command = "";
    let args: string[] = [];

    const smoke = runUnpackedHostSmoke({
      releaseDir: fixture.releaseDir,
      userDataDir,
      spawnProcess: (file, childArgs) => {
        command = file;
        args = childArgs;
        setTimeout(() => child.emit("exit", 0, null), 0);
        return child;
      },
    });

    await expect(smoke).resolves.toBeUndefined();
    expect(command).toBe(fixture.executablePath);
    expect(args).toEqual([
      "--hidden",
      "--package-smoke",
      "--user-data-dir",
      userDataDir,
    ]);
    expect(existsSync(userDataDir)).toBe(false);
  });

  it("rejects a crashed Host and terminates a timed-out Host", async () => {
    const fixture = createFixture();
    const userDataDir = join(fixture.root, "user-data");
    const child = new FakeChild();

    const crashed = runUnpackedHostSmoke({
      releaseDir: fixture.releaseDir,
      userDataDir,
      spawnProcess: () => {
        setTimeout(() => child.emit("exit", 1, null), 0);
        return child;
      },
    });
    await expect(crashed).rejects.toThrow();

    const timedOutChild = new FakeChild();
    const timeoutUserDataDir = join(fixture.root, "timeout-user-data");
    const timedOut = runUnpackedHostSmoke({
      releaseDir: fixture.releaseDir,
      userDataDir: timeoutUserDataDir,
      timeoutMs: 5,
      spawnProcess: () => timedOutChild,
    });
    await expect(timedOut).rejects.toThrow();
    expect(timedOutChild.killed).toBe(true);
    expect(existsSync(timeoutUserDataDir)).toBe(false);
  });

  it("rejects an unpacked executable outside the validated release directory", async () => {
    const fixture = createFixture();
    const outsideExecutable = join(fixture.root, "outside.exe");
    writeFileSync(outsideExecutable, "outside");
    rmSync(fixture.executablePath);

    await expect(
      runUnpackedHostSmoke({
        releaseDir: fixture.releaseDir,
        userDataDir: join(fixture.root, "user-data"),
        spawnProcess: () => new FakeChild(),
      }),
    ).rejects.toThrow();
  });
});
