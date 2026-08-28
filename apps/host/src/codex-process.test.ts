import { describe, expect, it } from "vitest";
import { getCodexAppServerLaunchSpec } from "./codex-process.js";

describe("Codex app-server process", () => {
  it("uses the configured standalone CLI and stdio app-server mode", () => {
    expect(getCodexAppServerLaunchSpec("C:\\Tools\\codex.exe")).toEqual({
      command: "C:\\Tools\\codex.exe",
      args: ["app-server"],
    });
  });

  it("does not invent a global CLI path", () => {
    expect(getCodexAppServerLaunchSpec("C:\\Tools\\codex.exe").command).toBe(
      "C:\\Tools\\codex.exe",
    );
  });
});
