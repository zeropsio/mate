import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { seedMembers } from "../__fixtures__/hqProjectPeople.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { hqProjectPeople } from "./hqProjectPeople.ts";

// witness: packages/client-runtime/src/data/projections/hqProjectPeople.ts | ownerOf(read, orgId, person?.ownerUserId) → ownerOf(read, orgId, undefined)
it("PJ12: A Mate a person owns names that person as its owner, with their name and picture from the organization's people", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  seedHqNavigation(store, "org", {
    mates: {},
    structure: {
      apps: [],
      ungrouped: [{ projectId: "jan-mate", name: "jan-mate", mate: { face: "" } }],
    },
    person: { mine: false, ownerUserId: "u-jan", waitsOnViewer: false, unseen: null },
  });
  seedMembers(store, "org", {
    "u-jan": { name: "Jan Novák", avatarUrl: "https://avatars.example/jan.png" },
  });
  expect(registry.get(store.data.project(hqProjectPeople, "org"))["jan-mate"]?.owner).toEqual({
    userId: "u-jan",
    name: "Jan Novák",
    called: "Jan",
    avatarUrl: "https://avatars.example/jan.png",
  });
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/hqProjectPeople.ts | mine: person?.mine, → mine: person?.ownerUserId != null,
it("PJ42: A Mate is the reader's own only where HQ names them its person", () => {
  const ORG = "org";
  const SCOPES: ReadonlyArray<ScopeKey> = [placementsScope(ORG)];
  const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
  const placement = (
    projectId: string,
    fields: { ownerUserId: string | null; waitsOnViewer: boolean; mine?: boolean },
    signedInNow: Record<string, string>,
    everSignedIn: Record<string, string> = signedInNow,
  ): Row => ({
    family: "placement",
    id: projectId,
    revision,
    value: {
      projectId,
      appId: null,
      name: projectId,
      kind: "mate",
      mate: null,
      person: { mine: false, unseen: null, ...fields },
      signedInNow,
      everSignedIn,
    } as never,
  });
  const stream = (
    key: ScopeKey | ReturnType<typeof linkKeys.hq>,
    event: StreamEvent,
  ): AccountInput => ({
    kind: "stream",
    key,
    now: 0,
    event,
  });
  const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
    inputs.reduce((next, input) => reduceAccount(next, input).state, state);
  const generations = SCOPES.map((scope) => ({ scope, generation: 1 }));
  const rows: ReadonlyArray<Row> = [
    placement("ada", { ownerUserId: "u-jan", waitsOnViewer: true }, { "claude-code": "u-jan" }),
    placement("bob", { ownerUserId: "u-eva", waitsOnViewer: false }, {}, { codex: "u-eva" }),
    placement("nobody", { ownerUserId: null, waitsOnViewer: false }, {}),
    placement("ghost", { ownerUserId: "u-ghost", waitsOnViewer: false }, {}),
  ];
  const read = apply(emptyAccount, [
    stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
    ...SCOPES.flatMap((scope) => [
      stream(scope, { kind: "demand", demanded: true }),
      stream(scope, { kind: "attempt" }),
      stream(scope, { kind: "handshake" }),
    ]),
    stream(linkKeys.hq(ORG), { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
    { kind: "delivery", via: "hq-stream", scopes: generations, reset: true, rows, removals: [] },
    { kind: "hq-ready", scopes: generations },
    ...SCOPES.map((scope) => stream(scope, { kind: "baseline-committed" })),
  ]);
  const people = (state: AccountState) => hqProjectPeople.derive(readsOfState(state), ORG);
  const next = apply(read, [
    {
      kind: "delivery",
      via: "hq-stream",
      scopes: generations,
      reset: false,
      rows: [
        {
          ...placement("ada", { ownerUserId: "u-jan", waitsOnViewer: false, mine: true }, {}),
          revision: { ...revision, revision: 2 },
        },
      ],
      removals: [],
    },
  ]);
  expect(people(next).ada?.mine).toBe(true);
  expect(people(read).bob?.mine).toBe(false);
});
