import { describe, expect, it } from "vitest";
import { getCodexAppServerLaunchSpec } from "./codex-process.js";

describe("Codex app-server process", () => {
  it("uses the configured standalone CLI and stdio app-server mode", () => {
    expect(
      getCodexAppServerLaunchSpec({
        CODEX_CLI_PATH: "C:\\Tools\\codex.cmd",
        OS: "Windows_NT",
      }),
    ).toEqual({
      command: "C:\\Tools\\codex.cmd",
      args: ["app-server"],
    });
  });

  it("defaults to the platform CLI when no path is configured", () => {
    expect(getCodexAppServerLaunchSpec({ OS: "Windows_NT" })).toEqual({
      command: "codex.cmd",
      args: ["app-server"],
    });
  });
});
