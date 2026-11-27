import { expect, it } from "vite-plus/test";

import { conversationBegins, historyAbove } from "./timelineHistory.ts";

// witness: packages/client-runtime/src/zerops/timelineHistory.ts | rows.find((row) => row.kind === "message")?.id ?? → rows[0]?.id ??
it("ZV+1: Rows read in above where a conversation began when it was shown, its first message and never a day's seam that moves up with its day, are its history; breaks: earlier turns read in open their cards as if they arrived, drawn over the rows the person reads", () => {
  const shown = [
    { id: "seam:day:2026-11-26", kind: "seam" },
    { id: "ask-50", kind: "message" },
    { id: "record:ask-50", kind: "record" },
    { id: "answer-50", kind: "message" },
  ];
  const withEarlier = [
    { id: "seam:day:2026-11-25", kind: "seam" },
    { id: "ask-48", kind: "message" },
    { id: "record:ask-48", kind: "record" },
    { id: "card-end:ask-48", kind: "card-end" },
    { id: "seam:day:2026-11-26", kind: "seam" },
    { id: "ask-49", kind: "message" },
    { id: "record:ask-49", kind: "record" },
    ...shown.slice(1),
  ];
  expect([...historyAbove(withEarlier, conversationBegins(shown))]).toEqual(
    withEarlier.slice(0, 7).map((row) => row.id),
  );
});
