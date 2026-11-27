import { expect, it } from "vite-plus/test";
import { draftPane, draftPaneHandover, type DraftPaneState } from "./DraftPanel.logic.ts";

// witness: apps/web/src/components/zerops/DraftPanel.logic.ts | if (state.invalidated === true) return { kind: "ended" }; → if (false) return { kind: "ended" };
it("MN123: Opening a draft holds one request per act and shows only zcp's answer; an ended draft returns to availability instead of keeping its frame; breaks: a late answer shows an old copy or two openings overlap.", () => {
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
  ).toEqual({ kind: "ended", copy });
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
  expect(draftPane(showing, { type: "invalidate", inFlight: false })).toEqual({ kind: "ended" });
  expect(draftPane(opening, { type: "invalidate", inFlight: false })).toEqual({ kind: "ended" });
  const invalidated = draftPane(opening, { type: "invalidate", inFlight: true });
  expect(invalidated).toEqual({ kind: "opening", copy, invalidated: true });
  expect(draftPane(invalidated, { type: "invalidate", inFlight: false })).toBe(invalidated);
  expect(draftPane(invalidated, { type: "reload", copy })).toBe(invalidated);
  expect(
    draftPane(invalidated, {
      type: "answer",
      answer: { status: "running", url: "https://draft.example" },
    }),
  ).toEqual({ kind: "ended" });
});

// witness: apps/web/src/components/zerops/DraftPanel.logic.ts | return look.kind === "added" ? app[0] : undefined; → return look.kind === "discarded" ? app[0] : undefined;
it("MN134: The pane of a draft that is in the app now becomes Your app, its part's stage, and a draft still open or discarded, or Your app with no address, keeps its pane; breaks: Open draft pressed after the add says the draft is in the app instead of opening the app", () => {
  const stage = { service: "appstage", url: "https://appstage.example" };
  const copy = { kind: "service", hostname: "appdev", branch: "feature" } as const;
  expect(draftPaneHandover({ kind: "added" }, [stage])).toEqual(stage);
  expect(draftPaneHandover({ kind: "added" }, [])).toBeUndefined();
  expect(draftPaneHandover({ kind: "discarded" }, [stage])).toBeUndefined();
  expect(draftPaneHandover({ kind: "openable", copy }, [stage])).toBeUndefined();
});
