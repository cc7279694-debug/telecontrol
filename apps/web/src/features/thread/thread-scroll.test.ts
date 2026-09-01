import { describe, expect, it } from "vitest";
import {
  isNearThreadScrollBottom,
  scrollThreadToLatest,
} from "./thread-scroll";

describe("thread scroll helpers", () => {
  it("recognizes when the timeline is still near the latest message", () => {
    expect(
      isNearThreadScrollBottom({
        scrollTop: 800,
        clientHeight: 400,
        scrollHeight: 1240,
      }),
    ).toBe(true);
  });

  it("stops following the latest message after the user scrolls up", () => {
    expect(
      isNearThreadScrollBottom({
        scrollTop: 400,
        clientHeight: 400,
        scrollHeight: 1240,
      }),
    ).toBe(false);
  });

  it("moves the timeline to the latest message", () => {
    const element = { scrollHeight: 1600, scrollTop: 0 };

    scrollThreadToLatest(element);

    expect(element.scrollTop).toBe(1600);
  });
});
