import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { deriveTimelineMinimapItems, resolveTimelineMinimapPreview } from "./timelineMinimapItems";
import type { ChatMessage } from "../../types";

function rows(
  entries: ReadonlyArray<readonly ["user" | "assistant", string]>,
): MessagesTimelineRow[] {
  const messages: ChatMessage[] = entries.map(([role, text], index) => ({
    id: MessageId.make(`message-${index}`),
    role,
    text,
    streaming: false,
    turnId: null,
    createdAt: new Date(index * 1000).toISOString(),
    updatedAt: new Date(index * 1000).toISOString(),
  }));
  return messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
    receipt: null,
    aside: false,
    imageOnly: false,
    showAssistantMeta: false,
  }));
}

describe("timeline minimap previews", () => {
  it("previews the last assistant response before the next prompt and retains jump targets", () => {
    const source = rows([
      ["user", "  Inspect\n this  "],
      ["assistant", "Working"],
      ["assistant", " Done\t now "],
      ["user", "Next"],
      ["assistant", "Second answer"],
    ]);
    const items = deriveTimelineMinimapItems(source);
    expect(items).toHaveLength(2);
    expect(resolveTimelineMinimapPreview(items[0]!)).toEqual({
      ...items[0],
      userText: "Inspect this",
      assistantText: "Done now",
    });
    expect(source[items[0]!.rowIndex]!.id).toBe(items[0]!.id);
    expect(resolveTimelineMinimapPreview(items[1]!)?.assistantText).toBe("Second answer");
    expect(items[0]?.assistantText).toBe(" Done\t now ");
  });

  it("handles an unanswered prompt, empty responses, and a closed preview", () => {
    const items = deriveTimelineMinimapItems(
      rows([
        ["user", "First"],
        ["assistant", " \n\t"],
        ["user", "Next"],
      ]),
    );
    expect(items.map((item) => resolveTimelineMinimapPreview(item)?.assistantText)).toEqual([
      null,
      null,
    ]);
    expect(resolveTimelineMinimapPreview(null)).toBeNull();
  });

  it("shows fresh streaming text without changing the jump target", () => {
    const first = deriveTimelineMinimapItems(
      rows([
        ["user", "Explain"],
        ["assistant", "First"],
      ]),
    )[0]!;
    const next = { ...first, assistantText: "First\n second" };
    expect(resolveTimelineMinimapPreview(next)).toEqual({
      ...first,
      assistantText: "First second",
    });
    expect(resolveTimelineMinimapPreview(first)?.assistantText).toBe("First");
  });

  it("marks each message with what its stretch came to, how long it ran and whether it was an aside", () => {
    const source = rows([
      ["user", "Deploy it"],
      ["user", "btw the footer"],
      ["user", "Next"],
    ]);
    const line = (after: number, face: string, minutes: number) => ({
      kind: "work-line" as const,
      id: `work-line:${after}`,
      createdAt: source[after]!.createdAt,
      stretchKey: `msg:${source[after]!.id}`,
      turnId: null,
      live: false,
      face: face as "produced",
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(minutes * 60_000).toISOString(),
      note: "Stage is live.",
      fallback: null,
      noteCount: 1,
      activity: null,
      liveNote: null,
      hasLog: true,
      open: false,
    });
    const withLines: MessagesTimelineRow[] = [
      { ...source[0]!, aside: false } as MessagesTimelineRow,
      line(0, "produced", 75),
      { ...(source[1] as Extract<MessagesTimelineRow, { kind: "message" }>), aside: true },
      line(1, "failed", 4),
      source[2]!,
    ];
    expect(
      deriveTimelineMinimapItems(withLines).map(({ tone, weight, aside, note }) => ({
        tone,
        weight,
        aside,
        note,
      })),
    ).toEqual([
      { tone: "produced", weight: 2, aside: false, note: "Stage is live." },
      { tone: "failed", weight: 0, aside: true, note: "Stage is live." },
      { tone: "quiet", weight: 0, aside: false, note: null },
    ]);
  });
});
