import { describe, expect, it } from "vitest";
import { remoteCommandSchema } from "./commands.js";

describe("remote commands", () => {
  it("accepts a turn command that addresses a workspace by id", () => {
    expect(
      remoteCommandSchema.parse({
        type: "turn.start",
        workspaceId: "workbench",
        threadId: "thread-1",
        text: "检查项目状态",
      }),
    ).toEqual({
      type: "turn.start",
      workspaceId: "workbench",
      threadId: "thread-1",
      text: "检查项目状态",
    });
  });

  it("rejects a command that tries to submit a local path", () => {
    expect(() =>
      remoteCommandSchema.parse({
        type: "thread.list",
        workspaceId: "workbench",
        cwd: "C:\\Users\\private",
      }),
    ).toThrow();
  });

  it("rejects unknown command types", () => {
    expect(() => remoteCommandSchema.parse({ type: "shell.exec" })).toThrow();
  });
});
