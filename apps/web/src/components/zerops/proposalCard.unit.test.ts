import { expect, it } from "vite-plus/test";
import { proposalCardStage } from "./proposal/proposal.logic.ts";

const at = "2026-11-23T10:00:00.000Z";

// witness: apps/web/src/components/zerops/proposal/proposal.logic.ts | input.runningHere || hqCarriesApproval(input.kind) → input.runningHere
it("MN+8: An approval HQ carries out reads running in every tab from the press until HQ records its end, and only a value's approval another tab writes reads unseen; breaks: a second tab says the end of a restart HQ runs was not seen, or a press sent twice", () => {
  const running = { state: "running", at } as const;
  const cases = [
    ["sent, not answered", "service.restart", undefined, false, true, "running"],
    ["restart, another tab", "service.restart", running, false, false, "running"],
    ["message, another tab", "mate.message", running, false, false, "running"],
    ["access, another tab", "access.set", running, false, false, "running"],
    ["value, another tab", "env.set", running, false, false, "unseen"],
    ["value, this tab", "env.set", running, true, false, "running"],
    ["undecided", "domain.add", undefined, false, false, "open"],
    ["ended", "service.stop", { state: "done", at } as const, false, false, "done"],
  ] as const;
  for (const [standing, kind, decision, runningHere, sending, stage] of cases)
    expect({
      standing,
      stage: proposalCardStage({ kind, decision, runningHere, sending }),
    }).toEqual({ standing, stage });
});
