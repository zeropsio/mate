import { expect, it } from "vite-plus/test";
import type { SharedBirth } from "@t3tools/client-runtime/data";
import { comingOfBirth, sharedBirthPresentation } from "../../zerops/sharedBirths.ts";

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
