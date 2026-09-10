import { describe, expect, it } from "vite-plus/test";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import {
  appendTerminalContextsToPrompt,
  deriveDisplayedUserMessageState,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
} from "~/lib/terminalContext";

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

  it("resolves a data token that also names a workspace path as the data context, not a file mention", () => {
    // `db` is both this project's data service and a folder in the workspace.
    // The sent message carries `@db`; the block names it, so the chip wins and
    // the bare mention never reaches the markdown renderer as a file link.
    const sent = appendTerminalContextsToPrompt(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, [
      {
        kind: "data",
        token: "db",
        terminalId: "data:db",
        terminalLabel: "db",
        lineStart: 1,
        lineEnd: 2,
        text: "## db (postgresql@16)\n- public.orders",
      },
    ]);
    const state = deriveDisplayedUserMessageState(sent);

    expect(state.visibleText).toBe("@db");
    expect(state.contexts[0]).toMatchObject({ kind: "data", token: "db" });
    expect(formatInlineTerminalContextLabel(state.contexts[0]!)).toBe("@db");
    expect(textContainsInlineTerminalContextLabels(state.visibleText, state.contexts)).toBe(true);
  });
});
