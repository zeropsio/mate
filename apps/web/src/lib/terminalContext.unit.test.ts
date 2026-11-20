import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { filterTerminalContextsWithText, type TerminalContextDraft } from "./terminalContext.ts";

function draft(id: string, text: string): TerminalContextDraft {
  return {
    id,
    threadId: ThreadId.make("thread-1"),
    createdAt: "2026-01-01T00:00:00.000Z",
    terminalId: "terminal-1",
    terminalLabel: "Terminal 1",
    lineStart: 1,
    lineEnd: 2,
    text,
  };
}

// witness: apps/web/src/lib/terminalContext.ts | return normalizeTerminalContextText(context.text).length > 0; → return context.text.length > 0;
it("WL1: A terminal context whose captured text is gone, nothing but line breaks left, is not sent; one that still holds text is sent, in its order", () => {
  const sent = filterTerminalContextsWithText([
    draft("breaks", "\n\r\n"),
    draft("status", "git status\nOn branch main"),
    draft("empty", ""),
    draft("log", "git log -1"),
  ]);
  expect(sent.map((context) => context.id)).toEqual(["status", "log"]);
});
