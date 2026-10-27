import { describe, expect, it } from "vite-plus/test";

import { hqVerdictScope, type HqVerdict } from "../families/hqVerdict.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { hqVerdict } from "./hqVerdict.ts";

const ORG = "org-example";
const scope = hqVerdictScope(ORG);
const apply = (state: AccountState, ...inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const answer = (verdict: HqVerdict, version = 1): AccountInput => ({
  kind: "baseline-commit",
  scope,
  generation: 0,
  via: "zerops-read",
  members: [ORG],
  rows: [
    { family: "hqVerdict", id: ORG, value: { verdict }, revision: { kind: "zerops", version } },
  ],
});
const official = apply(emptyAccount, answer("official"));
const fault = (outcome: "transient" | "definitive-refusal"): AccountInput => ({
  kind: "stream",
  key: linkKeys.zerops(ORG),
  now: 0,
  event: { kind: "fault", jitter: 0, fault: { outcome, message: "Unavailable" } },
});

describe("hqVerdict", () => {
  it.each([
    { name: "nothing proved yet", state: emptyAccount, verdict: "pending" },
    ...(["pending", "official", "none", "unreadable"] as const).map((verdict) => ({
      name: `the source answered ${verdict}`,
      state: apply(emptyAccount, answer(verdict)),
      verdict,
    })),
    {
      name: "transport outage retains the answer",
      state: apply(official, fault("transient")),
      verdict: "official",
    },
    {
      name: "refusal does not delete the answer",
      state: apply(official, fault("definitive-refusal")),
      verdict: "official",
    },
    {
      name: "partial coverage preserves the previous answer",
      state: apply(official, {
        kind: "baseline-commit",
        scope,
        generation: 0,
        via: "zerops-read",
        members: [],
        rows: [],
        partial: true,
      }),
      verdict: "official",
    },
    {
      name: "unverified access retains the nonsensitive HQ verdict",
      state: apply(official, {
        kind: "access",
        family: "hqVerdict",
        id: ORG,
        access: "unverified",
      }),
      verdict: "official",
    },
    {
      name: "denied access purges the answer",
      state: apply(official, { kind: "access", family: "hqVerdict", id: ORG, access: "denied" }),
      verdict: "pending",
    },
    {
      name: "an older answer cannot replace the newer one",
      state: apply(emptyAccount, answer("official", 2), answer("none", 1)),
      verdict: "official",
    },
  ])("$name", ({ state, verdict }) => {
    expect(hqVerdict.derive(readsOfState(state), ORG)).toBe(verdict);
  });

  it("does not carry the answer into another organization", () => {
    expect(hqVerdict.derive(readsOfState(official), "org-other")).toBe("pending");
  });
});
