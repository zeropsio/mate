import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendTerminalContextsToPrompt,
  buildTerminalContextPreviewTitle,
  buildTerminalContextBlock,
  countInlineTerminalContextPlaceholders,
  deriveDisplayedUserMessageState,
  ensureInlineTerminalContextPlaceholders,
  extractTrailingTerminalContexts,
  filterTerminalContextsWithText,
  formatInlineTerminalContextLabel,
  formatTerminalContextLabel,
  hasTerminalContextText,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  isTerminalContextExpired,
  materializeInlineTerminalContextPrompt,
  removeInlineTerminalContextPlaceholder,
  replaceMentionWithInlineContextPlaceholder,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "./terminalContext";

function makeContext(overrides?: Partial<TerminalContextDraft>): TerminalContextDraft {
  return {
    id: "context-1",
    threadId: ThreadId.make("thread-1"),
    terminalId: "default",
    terminalLabel: "Terminal 1",
    lineStart: 12,
    lineEnd: 13,
    text: "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
    ...overrides,
  };
}

function makeDataContext(overrides?: Partial<TerminalContextDraft>): TerminalContextDraft {
  return makeContext({
    id: "context-data-1",
    kind: "data",
    token: "db.public.orders",
    terminalId: "data:db · public.orders",
    terminalLabel: "db · public.orders",
    lineStart: 1,
    lineEnd: 2,
    text: "## db (postgresql@16) · public.orders\n- id: integer (pk)",
    ...overrides,
  });
}

describe("terminalContext", () => {
  it("formats terminal labels with line ranges", () => {
    expect(formatTerminalContextLabel(makeContext())).toBe("Terminal 1 lines 12-13");
    expect(
      formatTerminalContextLabel(
        makeContext({
          lineStart: 9,
          lineEnd: 9,
        }),
      ),
    ).toBe("Terminal 1 line 9");
  });

  it("builds a numbered terminal context block", () => {
    expect(buildTerminalContextBlock([makeContext()])).toBe(
      [
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("appends terminal context blocks after prompt text", () => {
    expect(appendTerminalContextsToPrompt("Investigate this", [makeContext()])).toBe(
      [
        "Investigate this",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("replaces inline placeholders with inline terminal labels before appending context blocks", () => {
    expect(
      appendTerminalContextsToPrompt(
        `Investigate ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} carefully`,
        [makeContext()],
      ),
    ).toBe(
      [
        "Investigate @terminal-1:12-13 carefully",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("extracts terminal context blocks from message text", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(extractTrailingTerminalContexts(prompt)).toEqual({
      promptText: "Investigate this",
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
          kind: "terminal",
        },
      ],
    });
  });

  it("derives displayed user message state from terminal context prompts", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Investigate this",
      copyText: prompt,
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
          kind: "terminal",
        },
      ],
    });
  });

  it("preserves prompt text when no trailing terminal context block exists", () => {
    expect(extractTrailingTerminalContexts("No attached context")).toEqual({
      promptText: "No attached context",
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    });
  });

  it("returns null preview title when every context is invalid", () => {
    expect(
      buildTerminalContextPreviewTitle([
        makeContext({
          terminalId: "   ",
        }),
        makeContext({
          id: "context-2",
          text: "\n\n",
        }),
      ]),
    ).toBeNull();
  });

  it("tracks inline terminal context placeholders in prompt text", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(countInlineTerminalContextPlaceholders(`a${placeholder}b${placeholder}`)).toBe(2);
    expect(ensureInlineTerminalContextPlaceholders("Investigate this", 2)).toBe(
      `${placeholder}${placeholder}Investigate this`,
    );
    expect(insertInlineTerminalContextPlaceholder("abc", 1)).toEqual({
      prompt: `a ${placeholder} bc`,
      cursor: 4,
      contextIndex: 0,
    });
    expect(removeInlineTerminalContextPlaceholder(`a${placeholder}b${placeholder}c`, 1)).toEqual({
      prompt: `a${placeholder}bc`,
      cursor: 3,
    });
    expect(stripInlineTerminalContextPlaceholders(`a${placeholder}b`)).toBe("ab");
  });

  it("inserts a placeholder after a file mention when given the expanded prompt cursor", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(insertInlineTerminalContextPlaceholder("Inspect @package.json ", 22)).toEqual({
      prompt: `Inspect @package.json ${placeholder} `,
      cursor: 24,
      contextIndex: 0,
    });
  });

  it("adds a trailing space and consumes an existing trailing space at the insertion point", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(insertInlineTerminalContextPlaceholder("yo whats", 3)).toEqual({
      prompt: `yo ${placeholder} whats`,
      cursor: 5,
      contextIndex: 0,
    });
  });

  it("marks contexts without snapshot text as expired and filters them from sendable contexts", () => {
    const liveContext = makeContext();
    const expiredContext = makeContext({
      id: "context-2",
      text: "",
    });

    expect(hasTerminalContextText(liveContext)).toBe(true);
    expect(isTerminalContextExpired(liveContext)).toBe(false);
    expect(hasTerminalContextText(expiredContext)).toBe(false);
    expect(isTerminalContextExpired(expiredContext)).toBe(true);
    expect(filterTerminalContextsWithText([expiredContext, liveContext])).toEqual([liveContext]);
  });

  it("formats and materializes inline terminal labels from placeholder positions", () => {
    expect(formatInlineTerminalContextLabel(makeContext())).toBe("@terminal-1:12-13");
    expect(
      materializeInlineTerminalContextPrompt(
        `Investigate ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} carefully`,
        [makeContext()],
      ),
    ).toBe("Investigate @terminal-1:12-13 carefully");
  });
  it("labels a data context by name alone, with no line range anywhere", () => {
    const dataContext = makeDataContext();
    expect(formatTerminalContextLabel(dataContext)).toBe("db · public.orders");
    expect(formatInlineTerminalContextLabel(dataContext)).toBe("@db.public.orders");
  });

  it("builds an unnumbered data context block after the terminal block", () => {
    expect(buildTerminalContextBlock([makeDataContext(), makeContext()])).toBe(
      [
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
        "",
        "<data_context>",
        "- db · public.orders (@db.public.orders):",
        "  ## db (postgresql@16) · public.orders",
        "  - id: integer (pk)",
        "</data_context>",
      ].join("\n"),
    );
  });

  it("strips both trailing blocks and lists terminal contexts before data ones", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [
      makeDataContext(),
      makeContext(),
    ]);
    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Investigate this",
      copyText: prompt,
      contextCount: 2,
      previewTitle: [
        "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
        "db · public.orders\n## db (postgresql@16) · public.orders\n- id: integer (pk)",
      ].join("\n\n"),
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
          kind: "terminal",
        },
        {
          header: "db · public.orders",
          body: "## db (postgresql@16) · public.orders\n- id: integer (pk)",
          kind: "data",
          token: "db.public.orders",
        },
      ],
    });
  });

  it("materializes a data placeholder as its mention token", () => {
    expect(
      appendTerminalContextsToPrompt(`Explain ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} please`, [
        makeDataContext(),
      ]),
    ).toBe(
      [
        "Explain @db.public.orders please",
        "",
        "<data_context>",
        "- db · public.orders (@db.public.orders):",
        "  ## db (postgresql@16) · public.orders",
        "  - id: integer (pk)",
        "</data_context>",
      ].join("\n"),
    );
  });

  it("falls back to the slugged label when a data context carries no token", () => {
    expect(
      formatInlineTerminalContextLabel({
        kind: "data",
        terminalLabel: "db · public.orders",
        lineStart: 1,
        lineEnd: 2,
      }),
    ).toBe("@db-·-public.orders");
  });
  it("swaps a typed mention for its inline placeholder in one step, leaving no mention text behind", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(replaceMentionWithInlineContextPlaceholder("look at @db", 8, 11)).toEqual({
      prompt: `look at ${placeholder} `,
      cursor: 10,
      contextIndex: 0,
    });
  });

  it("keeps the text after the mention and counts placeholders before it", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(
      replaceMentionWithInlineContextPlaceholder(`${placeholder} see @db.orders now`, 6, 16),
    ).toEqual({
      prompt: `${placeholder} see ${placeholder} now`,
      cursor: 8,
      contextIndex: 1,
    });
  });
});
