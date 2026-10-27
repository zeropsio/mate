import { describe, expect, it } from "vite-plus/test";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { appReleaseRows } from "./appReleaseRows.ts";

const key = { orgId: "org", appId: "shop" };
const scope = hqAppDetailScope(key.orgId, key.appId);
const apply = (inputs: ReadonlyArray<AccountInput>, state: AccountState = emptyAccount) =>
  inputs.reduce((s, input) => reduceAccount(s, input).state, state);
const demanded = apply([
  { kind: "stream", key: linkKeys.hq("org"), now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
]);
const read = (state: AccountState) => appReleaseRows.derive(readsOfState(state), key);
const release = {
  tag: "v1.0.0",
  sha: "a".repeat(40),
  entries: [{ service: "api", sha: "b".repeat(40) }],
  at: "2026-10-07T00:00:00Z",
  by: "user",
  reason: null,
  rollbackOf: null,
  state: "approved" as const,
};
function deliver(releases: ReadonlyArray<typeof release>) {
  return apply(
    [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: [{ scope, generation: 1 }],
        reset: true,
        removals: [],
        rows: [
          {
            family: "hqAppDetail",
            id: "shop/releases",
            value: { kind: "releases", value: releases },
            revision: { kind: "hq", incarnation: "i", revision: 1 },
          },
        ],
      },
    ],
    demanded,
  );
}

describe("release source coverage", () => {
  it("an unread app is not an empty release list; an affirmative empty record is", () => {
    expect(read(demanded)).toEqual({ kind: "unread", reason: null });
    expect(read(deliver([]))).toMatchObject({ kind: "known", releases: [] });
  });
  it("known release rows survive transient loss and show the refusal independently", () => {
    const known = deliver([release]);
    const down = apply(
      [
        {
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "transient", message: "HQ is away" },
          },
        },
      ],
      known,
    );
    expect(read(down)).toMatchObject({
      kind: "known",
      releases: [{ tag: "v1.0.0" }],
      live: false,
      reason: "HQ is away",
    });
    const refused = apply(
      [
        {
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "definitive-refusal", message: "No release read" },
          },
        },
      ],
      demanded,
    );
    expect(read(refused)).toEqual({ kind: "unread", reason: "No release read" });
  });
  it("an authoritative no-access removal withholds releases without claiming no releases", () => {
    const removed = apply(
      [
        {
          kind: "delivery",
          via: "hq-stream",
          scopes: [{ scope, generation: 1 }],
          reset: false,
          rows: [],
          removals: [{ family: "hqAppDetail", id: "shop/releases", reason: "no-access" }],
        },
      ],
      deliver([release]),
    );
    expect(read(removed).kind).toBe("unread");
  });
});
