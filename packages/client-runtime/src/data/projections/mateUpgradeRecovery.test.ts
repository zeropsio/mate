import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { mateUpgradeRecovery } from "./mateUpgradeRecovery.ts";
import { describe, expect, it } from "vite-plus/test";
import { upgradeRecoveryFromEvidence } from "./mateUpgradeRecovery.ts";
const accepted = { stage: "accepted", operationId: "restart" } as const;
const old = "0.10.0";
const current = "0.12.0";

describe("upgrade restart evidence", () => {
  it("an old ready descriptor cannot complete a restart whose return is not proved", () => {
    expect(
      upgradeRecoveryFromEvidence({
        progress: accepted,
        verdict: { level: "ready" },
        serverVersion: current,
        returned: false,
      }),
    ).toEqual({ state: "waiting" });
  });
  it("an overdue restart remains unresolved and a later owner reading can complete it", () => {
    expect(
      upgradeRecoveryFromEvidence({
        progress: accepted,
        verdict: { level: "restarting", by: "you", overdue: true },
        serverVersion: old,
        returned: false,
      }),
    ).toMatchObject({ state: "unresolved" });
    expect(
      upgradeRecoveryFromEvidence({
        progress: accepted,
        verdict: { level: "ready" },
        serverVersion: current,
        returned: true,
      }),
    ).toEqual({ state: "ready" });
  });
  it("the returned incompatible descriptor is a source-proved failure", () => {
    expect(
      upgradeRecoveryFromEvidence({
        progress: accepted,
        verdict: { level: "ready" },
        serverVersion: old,
        returned: true,
      }),
    ).toMatchObject({ state: "failed", reason: expect.stringContaining("incompatible") });
  });
  it("a lost acceptance answer is unresolved even if a compatible server already answers", () => {
    expect(
      upgradeRecoveryFromEvidence({
        progress: { stage: "uncertain", next: "ask-owner-again" },
        verdict: { level: "ready" },
        serverVersion: current,
        returned: true,
      }),
    ).toMatchObject({ state: "unresolved" });
  });
  it("an owner refusal and terminal failure keep their own words", () => {
    for (const progress of [
      { stage: "refused", reason: "Not allowed" },
      { stage: "done", operationId: "restart", outcome: "failed", reason: "Not allowed" },
    ] as const)
      expect(
        upgradeRecoveryFromEvidence({
          progress,
          verdict: { level: "ready" },
          serverVersion: current,
          returned: true,
        }),
      ).toEqual({ state: "failed", reason: "Not allowed" });
  });
});

it("the account projection completes only after the accepted restart's boot reference changes", () => {
  const scope = mateLinkScope("p");
  let state = emptyAccount;
  const apply = (input: AccountInput) => {
    state = reduceAccount(state, input).state;
  };
  apply({
    kind: "operation-recorded",
    requestId: "r",
    intent: { kind: "mate-restart", orgId: "org", projectId: "p", serviceId: "s", way: "restart" },
  });
  apply({
    kind: "operation-receipt",
    receipt: {
      requestId: "r",
      operationId: "restart",
      executor: "zerops",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    },
  });
  apply({ kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } });
  apply({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  const source = (initAt: string, sequence: number) =>
    apply({
      kind: "rows",
      scope,
      generation: 1,
      method: "push",
      via: "mate-direct",
      rows: [
        {
          family: "mateLink",
          id: "p:s",
          revision: { kind: "mate-link", sequence },
          value: {
            key: "p:s",
            projectId: "p",
            orgId: "org",
            origin: "https://mate.example",
            shown: true,
            watched: true,
            environment: { record: null, credential: { kind: "none" } },
            container: {
              ...initialContainer(),
              state: { level: "ready" },
              reading: {
                sentAt: { mono: 0, wall: 0 },
                reading: { kind: "ready", initAt, descriptor: { serverVersion: current } },
              },
            },
          } as unknown as MateLinkValue,
        },
      ],
    });
  const key = { requestId: "r", targetKey: "p:s", previousInitAt: "before" };
  source("before", 1);
  expect(mateUpgradeRecovery.derive(readsOfState(state), key)).toEqual({ state: "waiting" });
  source("after", 2);
  expect(mateUpgradeRecovery.derive(readsOfState(state), key)).toEqual({ state: "ready" });
});
