import { expect, it } from "vite-plus/test";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { proposalOperationOf } from "./proposalEffect.ts";

const ORG = "org";
const AT = "2026-11-23T10:00:00.000Z";
const effect = (id: string): HqOperation => ({
  id,
  kind: "proposal_effect",
  phase: "effect_requested",
  at: AT,
  acceptedAt: AT,
  failure: { step: "zerops", code: "zerops_not_answering", at: AT, origin: "hq" },
  continueBy: "u-maker",
  offers: ["continue", "end"],
});
const placement = (projectId: string, kind: string, operation: HqOperation): Row => ({
  family: "placement",
  id: projectId,
  revision: { kind: "hq", incarnation: "i", revision: 1 },
  value: {
    projectId,
    appId: "app",
    name: projectId,
    kind,
    mate: null,
    person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
    signedInNow: {},
    everSignedIn: {},
    operation,
  } as never,
});

// witness: packages/client-runtime/src/data/projections/proposalEffect.ts | if (operation?.kind === PROPOSAL_EFFECT && operation.id === operationId) → if (operation?.kind === PROPOSAL_EFFECT)
it("PJ+3: An approval's card reads the operation HQ names as that proposal's own, on whichever project navigation shows it, and never another proposal's operation open on its project; breaks: End on one card ends a different approval, or a creation waiting on production has no Check again or End.", () => {
  const scope = placementsScope(ORG);
  const stream = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, event: StreamEvent) =>
    ({ kind: "stream", key, now: 0, event }) satisfies AccountInput;
  const scopes = [{ scope, generation: 1 }];
  const inputs: ReadonlyArray<AccountInput> = [
    stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
    stream(scope, { kind: "demand", demanded: true }),
    stream(scope, { kind: "attempt" }),
    stream(scope, { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
    {
      kind: "delivery",
      via: "hq-stream",
      scopes,
      reset: true,
      rows: [
        placement("p-home", "mate", effect("op-other")),
        placement("p-production", "production", effect("op-own")),
      ],
      removals: [],
    },
    { kind: "hq-ready", scopes },
    stream(scope, { kind: "baseline-committed" }),
  ];
  const state = inputs.reduce((next, input) => reduceAccount(next, input).state, emptyAccount);
  const read = (operationId: string) =>
    proposalOperationOf.derive(readsOfState(state), { orgId: ORG, operationId });
  expect(read("op-own")?.projectId).toBe("p-production");
  expect(read("op-own")?.operation.id).toBe("op-own");
  expect(read("op-gone")).toBeUndefined();
});
