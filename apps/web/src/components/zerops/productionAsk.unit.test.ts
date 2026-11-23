import type { HqOperationStanding } from "@t3tools/client-runtime/data";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import { expect, it } from "vite-plus/test";
import type { ProposalDecision } from "~/zerops/proposalRecord";
import { serviceCreateEffect, serviceCreateView } from "./proposal/productionAsk.logic.ts";

const HASH = "ab".repeat(32);
const at = "2026-11-23T10:00:00.000Z";
const creating = (...services: ReadonlyArray<string>): ReleaseServicePlan => ({
  hash: HASH,
  operations: [
    ...services.map((service) => ({
      kind: "create" as const,
      service,
      settings: { hostname: service, type: "postgresql@18" },
      cost: "Adds one billed service.",
    })),
    { kind: "deploy" as const, service: "app", sha: "1a".repeat(20) },
  ],
  vault: { state: "known", gaps: [] },
});
const viewOf = (input: {
  readonly decision?: ProposalDecision;
  readonly allowed?: boolean;
  readonly effect?: HqOperationStanding;
}) =>
  serviceCreateView({
    services: ["db"],
    plan: { kind: "ready", plan: creating("db") },
    permission: { allowed: input.allowed ?? true },
    decision: input.decision,
    decisionKnown: true,
    sending: false,
    effect: input.effect ?? { kind: "none" },
    liveTag: undefined,
    by: null,
    at: null,
  });
const running: ProposalDecision = { state: "running", at };

// witness: apps/web/src/components/zerops/proposal/productionAsk.logic.ts | if (input.sending || running) return working; → if (input.sending) return working;
it("MN35: A production-services proposal HQ is carrying out reads as being created in every tab and for every viewer; breaks: the approver's second tab says Zerops did not create it while HQ imports, and a colleague reads it as someone else's to answer", () => {
  const cases = [
    ["may release", true],
    ["may not release", false],
  ] as const;
  for (const [viewer, allowed] of cases)
    expect({ viewer, state: viewOf({ decision: running, allowed }).state.kind }).toEqual({
      viewer,
      state: "working",
    });
});

// witness: apps/web/src/components/zerops/proposal/productionAsk.logic.ts | resume: input.effect.yours → resume: true
it("MN36: A creation waiting for its approver's Zerops sign-in offers Continue to that person only; breaks: a colleague presses Continue and HQ refuses it", () => {
  const waiting = (yours: boolean): HqOperationStanding => ({
    kind: "waiting",
    id: "op-1",
    continueBy: "dana",
    yours,
  });
  const cases = [
    ["its approver", true, true],
    ["a colleague", false, false],
  ] as const;
  for (const [viewer, yours, resume] of cases) {
    const view = viewOf({ decision: running, effect: waiting(yours) });
    expect({ viewer, state: view.state.kind, resume: view.resume }).toEqual({
      viewer,
      state: "working",
      resume,
    });
  }
});

// witness: apps/web/src/components/zerops/proposal/productionAsk.logic.ts | askedCreations(plan, services).operations.map((operation) => operation.service) → services.map((service) => service)
it("MN37: Approving a production-services proposal names to HQ only the asked services its plan still creates, under that plan's hash; breaks: HQ refuses the whole approval because one asked service already exists", () => {
  expect(serviceCreateEffect(creating("db"), ["db", "cache"])).toEqual({
    kind: "service.create",
    hostnames: ["db"],
    planHash: HASH,
  });
  expect(serviceCreateEffect(creating(), ["db", "cache"])).toBeUndefined();
});
