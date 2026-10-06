import { describe, expect, it } from "vite-plus/test";

import { hqAppsScope, hqPressesScope, placementsScope } from "../families/hqNavigation.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { environmentSetup } from "./environmentSetup.ts";

const ORG = "org";
const apps = hqAppsScope(ORG);
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
const environment = {
  projectId: "stage",
  tier: "stage",
  name: "stage",
  sources: ["main"],
  order: 1,
  keyHeld: false,
  keyInvalid: false,
  jobs: [],
  release: null,
  birth: null,
  can: { keep_deploy_token: { allow: true } },
} as const;
const app = (environments: unknown): Row =>
  ({
    family: "hqApp",
    id: "shop",
    revision,
    value: {
      id: "shop",
      name: "Shop",
      can: {},
      contents: { empty: false, deletingProjectIds: [] },
      projectIds: ["stage"],
      births: [],
      changes: [],
      environments,
    },
  }) as Row;
const apply = (state: AccountState, input: AccountInput) => reduceAccount(state, input).state;
const deliver = (
  rows: ReadonlyArray<Row>,
): Extract<AccountInput, { readonly kind: "hq-delivery" }> => ({
  kind: "hq-delivery",
  reset: false,
  scopes: [apps, placementsScope(ORG), hqPressesScope(ORG)].map((scope) => ({
    scope,
    generation: 1,
  })),
  rows,
  removals: [],
});
const project = liveProjects(ORG, [{ id: "stage", name: "Stage" }]).reduce(apply, emptyAccount);
const scopes = [apps, placementsScope(ORG), hqPressesScope(ORG)];
let connected = apply(project, {
  kind: "stream",
  key: linkKeys.hq(ORG),
  now: 0,
  event: { kind: "demand", demanded: true },
});
for (const key of scopes) {
  for (const event of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    { kind: "handshake" },
  ] as const)
    connected = apply(connected, { kind: "stream", key, now: 0, event });
}
for (const event of [{ kind: "handshake" }, { kind: "baseline-committed" }] as const)
  connected = apply(connected, { kind: "stream", key: linkKeys.hq(ORG), now: 0, event });
const delivered = apply(
  connected,
  deliver([
    app([environment]),
    {
      family: "placement",
      id: "stage",
      revision,
      value: {
        projectId: "stage",
        appId: "shop",
        name: "Stage",
        kind: "stage",
        mate: null,
        person: {
          role: "DEVELOPER",
          mayWrite: false,
          mine: false,
          ownerUserId: null,
          waitsOnViewer: false,
          unseen: null,
        },
        signedInNow: {},
        everSignedIn: {},
      },
    } as Row,
  ]),
);

let placed = apply(delivered, {
  kind: "hq-ready",
  scopes: scopes.map((scope) => ({ scope, generation: 1 })),
});
for (const key of scopes)
  placed = apply(placed, {
    kind: "stream",
    key,
    now: 0,
    event: { kind: "baseline-committed" },
  });

const of = (state: AccountState) =>
  environmentSetup.derive(readsOfState(state), { orgId: ORG, projectIds: ["stage"] });

describe("environmentSetup", () => {
  it.each([
    {
      name: "a key still missing",
      state: placed,
      expected: [{ groupId: "shop", projectId: "stage", tier: "stage", finish: false }],
    },
    { name: "unread navigation", state: project, expected: [] },
    {
      name: "refused environments",
      state: apply(
        placed,
        deliver([{ ...app({ refused: "read_change" }), revision: { ...revision, revision: 2 } }]),
      ),
      expected: [],
    },
    {
      name: "a partial navigation reset",
      state: apply(placed, { ...deliver([]), reset: true }),
      expected: [{ groupId: "shop", projectId: "stage", tier: "stage", finish: false }],
    },
    {
      name: "an attached, keyed environment",
      state: apply(
        placed,
        deliver([
          { ...app([{ ...environment, keyHeld: true }]), revision: { ...revision, revision: 2 } },
        ]),
      ),
      expected: [],
    },
    {
      name: "a creation HQ still holds",
      state: apply(
        placed,
        deliver([
          {
            family: "hqPress",
            id: "stage",
            revision,
            value: { kind: "stage", appId: "shop", heldForMs: 0, until: "2000-01-01T00:00:00Z" },
          },
        ]),
      ),
      expected: [],
    },
  ])("reads $name", ({ state, expected }) => expect(of(state)).toEqual(expected));

  it.each([true, false])("preserves HQ's finish offer: %s", (allow) => {
    const previous = readsOfState(placed).fact("placement", "stage");
    if (previous.kind !== "known") throw new Error("Missing stage placement");
    const state = apply(
      placed,
      deliver([
        {
          family: "placement",
          id: "stage",
          revision: { ...revision, revision: 2 },
          value: {
            ...previous.value,
            can: { finish: allow ? { allow: true } : { allow: false, reason: "read_only" } },
          },
        },
      ]),
    );
    expect(of(state)[0]?.finish).toBe(allow);
  });

  it("does not offer keeping a key while HQ cannot verify its offer", () => {
    const outage = apply(placed, {
      kind: "stream",
      key: apps,
      now: 1,
      event: {
        kind: "fault",
        fault: { outcome: "transient", message: "HQ unavailable" },
        jitter: 0,
      },
    });
    expect(of(outage)).toEqual([]);
  });
});
