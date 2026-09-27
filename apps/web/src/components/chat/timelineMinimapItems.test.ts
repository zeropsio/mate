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

  // A run's messages sent into it stand on the page before its line: the
  // message that started it takes what the run came to, and each one sent
  // into it is a quiet dot (the opener lost its mark to the last of them).
  it("marks each message with what its run came to, how long it ran and whether it was an aside", () => {
    const source = rows([
      ["user", "Deploy it"],
      ["user", "btw the footer"],
      ["assistant", "Stage is live, footer fixed."],
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
      waitedMs: 0,
      waitingSince: null,
      note: "Stage is live.",
      fallback: null,
      summary: null,
      worked: true,
      noteCount: 1,
      hasLog: true,
      open: false,
    });
    const withLines: MessagesTimelineRow[] = [
      { ...source[0]!, aside: false } as MessagesTimelineRow,
      { ...(source[1] as Extract<MessagesTimelineRow, { kind: "message" }>), aside: true },
      line(0, "produced", 75),
      source[2]!,
      source[3]!,
    ];
    expect(
      deriveTimelineMinimapItems(withLines).map(({ tone, weight, aside, note, assistantText }) => ({
        tone,
        weight,
        aside,
        note,
        assistantText,
      })),
    ).toEqual([
      {
        tone: "produced",
        weight: 2,
        aside: false,
        note: "Stage is live.",
        assistantText: "Stage is live, footer fixed.",
      },
      { tone: "quiet", weight: 0, aside: true, note: null, assistantText: null },
      { tone: "quiet", weight: 0, aside: false, note: null, assistantText: null },
    ]);
  });
});
