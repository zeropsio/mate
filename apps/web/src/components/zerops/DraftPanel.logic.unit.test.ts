import { expect, it } from "vite-plus/test";
import { draftPane, type DraftPaneState } from "./DraftPanel.logic.ts";

// witness: apps/web/src/components/zerops/DraftPanel.logic.ts | event.answer.reason === "draft ended" → false
it("MN+1: Opening a draft holds one request per act and shows only zcp's answer; an ended draft returns to availability instead of keeping its frame.", () => {
  const copy = { kind: "service", hostname: "appdev", branch: "feature" } as const;
  const idle: DraftPaneState = { kind: "idle" };
  const opening = draftPane(idle, { type: "mount", copy });
  expect(opening).toEqual({ kind: "opening", copy });
  expect(draftPane(opening, { type: "mount", copy })).toBe(opening);
  expect(draftPane(opening, { type: "reload", copy })).toBe(opening);
  expect(
    draftPane(opening, {
      type: "answer",
      answer: { status: "running", url: "https://draft.example" },
    }),
  ).toEqual({ kind: "showing", copy, url: "https://draft.example" });
  expect(
    draftPane(opening, { type: "answer", answer: { status: "failed", reason: "draft ended" } }),
  ).toEqual({ kind: "ended" });
  const failed = draftPane(opening, {
    type: "answer",
    answer: { status: "failed", reason: "no preview server is declared for this draft" },
  });
  expect(failed).toEqual({
    kind: "failed",
    copy,
    reason: "no preview server is declared for this draft",
  });
  expect(draftPane(failed, { type: "retry", copy })).toEqual({ kind: "opening", copy });
  const showing = draftPane(opening, {
    type: "answer",
    answer: { status: "running", url: "https://draft.example" },
  });
  expect(draftPane(showing, { type: "invalidate" })).toEqual({ kind: "ended" });
});
