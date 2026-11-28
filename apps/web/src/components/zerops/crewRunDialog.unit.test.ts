import type { CrewRun } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { crewDraftShown, crewRunDraft, crewStartBlocker } from "./crew/CrewRunDialog.logic";

const lastRun = (budgetUsd: number | "unlimited") =>
  ({
    options: {
      budgetUsd,
      timeLimitHours: 2,
      stopAtUsagePercent: 80,
      landing: "lead",
      devGrant: false,
      leadMayStart: true,
    },
  }) as CrewRun;

// witness: apps/web/src/components/zerops/crew/CrewRunDialog.logic.ts | return spendBlocked && !budgetPicked ? { ...draft, budget: "unlimited", budgetText: "" } : draft; → return draft;
it("MN141: The crew's run dialog starts a crew that can't keep a budget on No limit, the one spend choice that starts it, even when it learns so after it opened, until the person picks a spend, and while Start can't start it says why beside it: the crew not read yet, no spend chosen, a budget this crew can't keep, or an amount or hours not typed; breaks: Start sits disabled with nothing saying what to press", () => {
  const first = crewRunDraft(null, true);
  const blocked = crewDraftShown(crewRunDraft(lastRun(5), true), true, false);
  expect([
    crewDraftShown(first, true, false).budget,
    blocked.budget,
    crewDraftShown({ ...first, budget: "amount", budgetText: "5" }, true, true).budget,
    crewStartBlocker(blocked, true, true),
    crewStartBlocker(first, false, true),
    crewStartBlocker({ ...blocked, budget: "amount", budgetText: "5" }, true, true),
    crewStartBlocker({ ...first, budget: "amount", budgetText: "" }, false, true),
    crewStartBlocker({ ...blocked, time: "amount", timeText: "" }, true, true),
    crewStartBlocker(blocked, true, false),
  ]).toEqual([
    "unlimited",
    "unlimited",
    "amount",
    null,
    "Choose how much it may spend, or No limit.",
    "This crew can't keep a budget: choose No limit.",
    "Type how much it may spend, or choose No limit.",
    "Type how many hours it may work, or choose No limit.",
    "Reading the crew…",
  ]);
});
