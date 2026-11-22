import { expect, it } from "vite-plus/test";
import type { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";
import { AtomRegistry } from "effect/reactivity";

import type { DetailDemand } from "../demand.ts";
import { hqAccessOperationFamily } from "../families/hqAccessOperation.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { scopeOf } from "../families/spec.ts";
import type { ScopeKey } from "../model.ts";
import type { AccountInput } from "../reducer.ts";
import { makeAccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { rereadOnAccessChangeEnds } from "./accessChangeEnds.ts";

const ORG = "org";
const ACCESS = scopeOf(hqAccessOperationFamily, ORG);
const at = "2026-11-22T10:00:00.000Z";
const stream = (key: ScopeKey, event: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event,
});
const change = (
  id: string,
  userId: string | undefined,
  failure?: { step: "grants"; code: string; at: string },
): HqAccessOperation => ({
  id,
  change: { kind: "projects", ...(userId === undefined ? {} : { userId }) },
  operation: {
    kind: "access",
    phase: "grants_requested",
    at,
    acceptedAt: at,
    ...(failure === undefined ? {} : { failure }),
  },
});
let delivered = 0;
const keys = (rows: ReadonlyArray<HqAccessOperation>, removals: ReadonlyArray<string> = []) => {
  delivered += 1;
  const revision = { kind: "hq", incarnation: "i", revision: delivered } as const;
  return {
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: ACCESS, generation: 1 }],
    reset: false,
    rows: rows.map((value) => ({ family: "hqAccessOperation", id: value.id, value, revision })),
    removals: removals.map((id) => ({ family: "hqAccessOperation", id })),
  } as AccountInput;
};

// witness: packages/client-runtime/src/data/operations/accessChangeEnds.ts | is.stopped && seen.get(id)?.stopped !== true → is.stopped && seen.get(id)?.stopped === false
it("OP+1: Each of the viewer's access changes that stops running — its key gone, or stopped on a failure, even one first seen stopped — reads the changed person's grants again once, whatever screen is open; one for an address with no account reads none; breaks: the team shows a person's old project access after HQ changed it", () => {
  const store = makeAccountStore(AtomRegistry.make());
  for (const input of [
    stream(ACCESS, { kind: "demand", demanded: true }),
    stream(ACCESS, { kind: "attempt" }),
    stream(membersScope(ORG), { kind: "demand", demanded: true }),
    stream(membersScope(ORG), { kind: "attempt" }),
    { kind: "baseline-begin", scope: membersScope(ORG), generation: 1 },
    {
      kind: "baseline-commit",
      scope: membersScope(ORG),
      generation: 1,
      via: "zerops-read",
      members: [ORG],
      rows: [
        {
          family: "organizationMembers",
          id: ORG,
          value: [
            { id: "cu-jan", userId: "jan", user: { id: "jan" } },
            { id: "cu-eva", user: { id: "eva" } },
            { id: "cu-new" },
          ],
          revision: { kind: "zerops", version: null },
        },
      ],
    },
  ] as ReadonlyArray<AccountInput>)
    store.dispatch(input);
  const read: string[] = [];
  const stop = rereadOnAccessChangeEnds({
    store,
    orgId: ORG,
    revalidate: (demand: DetailDemand) => read.push(`${demand.family}:${demand.ownerId}`),
  });
  const failure = { step: "grants", code: "token_expired", at } as const;

  store.dispatch(keys([change("op-jan", "jan"), change("op-new", undefined)]));
  expect(read).toEqual([]);
  // HQ ended Jan's change: its key leaves.
  store.dispatch(keys([], ["op-jan"]));
  expect(read).toEqual(["memberProjectRoles:cu-jan"]);
  // A change first seen stopped, and the invitation to an address without an account leaving.
  store.dispatch(keys([change("op-eva", "eva", failure)], ["op-new"]));
  expect(read).toEqual(["memberProjectRoles:cu-jan", "memberProjectRoles:cu-eva"]);
  // Deleting a stopped change ends nothing again.
  store.dispatch(keys([], ["op-eva"]));
  // A running change that stops on a failure, Continue, and its end: each stop reads once.
  store.dispatch(keys([change("op-jan-2", "jan")]));
  store.dispatch(keys([change("op-jan-2", "jan", failure)]));
  store.dispatch(keys([change("op-jan-2", "jan")]));
  store.dispatch(keys([], ["op-jan-2"]));
  expect(read).toEqual([
    "memberProjectRoles:cu-jan",
    "memberProjectRoles:cu-eva",
    "memberProjectRoles:cu-jan",
    "memberProjectRoles:cu-jan",
  ]);
  stop();
  store.dispatch(keys([change("op-eva-2", "eva", failure)]));
  expect(read).toHaveLength(4);
});
