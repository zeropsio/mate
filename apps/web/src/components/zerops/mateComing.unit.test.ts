import { expect, it } from "vite-plus/test";
import type { SharedBirth } from "@t3tools/client-runtime/data";
import { comingOfBirth, sharedBirthPresentation } from "../../zerops/sharedBirths.ts";
import { comingDeletionStage } from "./ZeropsMateComingPage.logic.ts";

// witness: apps/web/src/zerops/sharedBirths.ts | since: birth.startedAt, → since: undefined,
it("MN20: A Mate's coming line and clock are its HQ birth's from the press to the hello, on every device; breaks: two devices show different clocks or lines for one Mate coming", () => {
  const birth: SharedBirth = {
    id: "birth-1",
    appId: "shop",
    appName: "Shop",
    face: "slate:squircle",
    madeBy: "maker",
    projectId: "project-1",
    importProcessId: null,
    intent: undefined,
    // HQ accepted its operation at 2026-11-21T10:00:00Z.
    startedAt: Date.parse("2026-11-21T10:00:00Z"),
    progress: { phase: "import-accepted", next: { kind: "wait", for: "container" }, reason: null },
    deletes: null,
  };
  // Every device reads this one birth from HQ: its row says the birth's own row line and counts
  // from HQ's acceptance, not from anything of its own.
  expect(comingOfBirth(birth)).toMatchObject({
    kind: "coming",
    line: sharedBirthPresentation(birth).row,
    since: Date.parse("2026-11-21T10:00:00Z"),
  });
});

// witness: apps/web/src/components/zerops/ZeropsMateComingPage.logic.ts | if (deletion.kind === "deleting") return { takesPage: true, action: null }; → if (deletion.kind === "deleting") return { takesPage: false, action: null };
it("MN40: A Mate's deletion takes its coming page while it runs, waits or failed, offering Continue only to the maker it waits for and Delete again after a failure only to a person HQ offers the record; breaks: the page of a Mate being deleted connects and hands over into a project that is going, or offers a press HQ refuses", () => {
  const failure = {
    step: "delete_project",
    code: "zerops_refused",
    at: "2026-11-23T10:00:00Z",
    origin: "zerops",
  };
  const waiting = { kind: "waiting", id: "op-1", continueBy: "ada" } as const;
  const deletions = [
    undefined,
    { kind: "none" },
    { kind: "deleting" },
    { ...waiting, yours: true },
    { ...waiting, yours: false },
    { kind: "failed", failure },
  ] as const;
  const examples = deletions.flatMap((deletion) =>
    [true, false].map((remove) => ({ deletion, remove })),
  );
  expect(examples.map(({ deletion, remove }) => comingDeletionStage(deletion, remove))).toEqual([
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: false, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: "continue-operation" },
    { takesPage: true, action: "continue-operation" },
    { takesPage: true, action: null },
    { takesPage: true, action: null },
    { takesPage: true, action: "delete" },
    { takesPage: true, action: null },
  ]);
});
