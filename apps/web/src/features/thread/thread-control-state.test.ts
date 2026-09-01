import { describe, expect, it } from "vitest";
import { isThreadComposerDisabled } from "./thread-control-state";

describe("isThreadComposerDisabled", () => {
  it("keeps an idle historical task writable", () => {
    expect(
      isThreadComposerDisabled({
        online: true,
        pending: false,
        readOnly: true,
        state: "idle",
      }),
    ).toBe(false);
  });

  it("keeps a running external task read-only", () => {
    expect(
      isThreadComposerDisabled({
        online: true,
        pending: false,
        readOnly: true,
        state: "running",
      }),
    ).toBe(true);
  });

  it("disables while offline or processing", () => {
    expect(
      isThreadComposerDisabled({
        online: false,
        pending: false,
        readOnly: false,
        state: "idle",
      }),
    ).toBe(true);
    expect(
      isThreadComposerDisabled({
        online: true,
        pending: true,
        readOnly: false,
        state: "idle",
      }),
    ).toBe(true);
  });
});
