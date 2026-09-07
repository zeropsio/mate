import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingTerminalContextChip } from "./ComposerPendingTerminalContexts";

describe("ComposerPendingTerminalContextChip", () => {
  it("renders expired terminal contexts with error styling", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingTerminalContextChip
        context={{
          id: "ctx-expired",
          threadId: ThreadId.make("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 2,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T18:42:05.449Z",
        }}
      />,
    );

    expect(markup).toContain('data-terminal-context-expired="true"');
    expect(markup).toContain("border-destructive/35");
    expect(markup).toContain("Terminal 1 lines 2-4");
  });

  it("renders a data context with the database icon, its label alone and no line range", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingTerminalContextChip
        context={{
          id: "ctx-data",
          threadId: ThreadId.make("thread-1"),
          kind: "data",
          token: "db.public.orders",
          terminalId: "data:db · public.orders",
          terminalLabel: "db · public.orders",
          lineStart: 1,
          lineEnd: 2,
          text: "## db (postgresql@16) · public.orders",
          createdAt: "2026-03-17T18:42:05.449Z",
        }}
      />,
    );

    expect(markup).toContain("db · public.orders");
    expect(markup).not.toContain("lines 1-2");
    expect(markup).toContain("lucide-database");
  });
});
