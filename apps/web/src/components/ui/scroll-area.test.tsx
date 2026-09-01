// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea", () => {
  it("forwards its DOM ref", () => {
    const ref = React.createRef<HTMLDivElement>();

    render(<ScrollArea ref={ref} data-testid="scroll-area" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
