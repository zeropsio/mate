import { describe, expect, it } from "vite-plus/test";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";

describe("userMessageTerminalContexts", () => {
  it("builds plain inline terminal text labels", () => {
    expect(
      buildInlineTerminalContextText([
        { header: "Terminal 1 lines 12-13", kind: "terminal" as const },
        { header: "Terminal 2 line 4", kind: "terminal" as const },
      ]),
    ).toBe("@terminal-1:12-13 @terminal-2:4");
  });

  it("formats individual inline terminal labels compactly", () => {
    expect(
      formatInlineTerminalContextLabel({ header: "Terminal 1 lines 12-13", kind: "terminal" }),
    ).toBe("@terminal-1:12-13");
    expect(
      formatInlineTerminalContextLabel({ header: "Terminal 2 line 4", kind: "terminal" }),
    ).toBe("@terminal-2:4");
  });

  it("detects inline terminal labels embedded in user message text", () => {
    expect(
      textContainsInlineTerminalContextLabels("yo @terminal-1:12-13 whats up", [
        { header: "Terminal 1 lines 12-13", kind: "terminal" as const },
      ]),
    ).toBe(true);
    expect(
      textContainsInlineTerminalContextLabels("yo whats up", [
        { header: "Terminal 1 lines 12-13", kind: "terminal" as const },
      ]),
    ).toBe(false);
  });

  it("uses a data context's own mention token as its inline label", () => {
    const dataContext = {
      header: "db · public.orders",
      kind: "data" as const,
      token: "db.public.orders",
    };
    expect(formatInlineTerminalContextLabel(dataContext)).toBe("@db.public.orders");
    expect(
      textContainsInlineTerminalContextLabels("explain @db.public.orders please", [dataContext]),
    ).toBe(true);
  });
});
