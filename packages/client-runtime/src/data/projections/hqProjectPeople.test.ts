import { describe, expect, it } from "vite-plus/test";

import { hqPeopleScope, placementsScope } from "../families/hqNavigation.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { hqProjectPeople } from "./hqProjectPeople.ts";

const ORG = "org";
const SCOPES: ReadonlyArray<ScopeKey> = [placementsScope(ORG), hqPeopleScope(ORG)];
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;

const person = (fields: { ownerUserId: string | null; waitsOnViewer: boolean }) => ({
  role: "DEVELOPER",
  mayWrite: true,
  mine: false,
  unseen: null,
  ...fields,
});
const placement = (
  projectId: string,
  fields: Parameters<typeof person>[0],
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
    person: person(fields),
    signedInNow,
    everSignedIn,
  } as never,
});
const rows: ReadonlyArray<Row> = [
  placement("ada", { ownerUserId: "u-jan", waitsOnViewer: true }, { "claude-code": "u-jan" }),
  // Eva signed Codex out since: nobody holds it now, she did once.
  placement("bob", { ownerUserId: "u-eva", waitsOnViewer: false }, {}, { codex: "u-eva" }),
  placement("nobody", { ownerUserId: null, waitsOnViewer: false }, {}),
  // HQ named an owner it sends no person record of: nobody is drawn.
  placement("ghost", { ownerUserId: "u-ghost", waitsOnViewer: false }, {}),
  {
    family: "hqPerson",
    id: "u-jan",
    revision,
    value: { name: "Jan Novák", clientUserId: "cu-jan", avatarUrl: "https://img/jan.png" } as never,
  },
  {
    family: "hqPerson",
    id: "u-eva",
    revision,
    value: { name: "Eva", clientUserId: "cu-eva", avatarUrl: null } as never,
  },
];

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
const read = apply(emptyAccount, [
  stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
  ...SCOPES.flatMap((scope) => [
    stream(scope, { kind: "demand", demanded: true }),
    stream(scope, { kind: "attempt" }),
    stream(scope, { kind: "handshake" }),
  ]),
  stream(linkKeys.hq(ORG), { kind: "handshake" }),
  stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
  { kind: "hq-delivery", scopes: generations, reset: true, rows, removals: [] },
  { kind: "hq-ready", scopes: generations },
  ...SCOPES.map((scope) => stream(scope, { kind: "baseline-committed" })),
]);
const removed = apply(read, [
  {
    kind: "hq-delivery",
    scopes: generations,
    reset: false,
    rows: [],
    removals: [{ family: "placement", id: "bob", reason: "no-access" }],
  },
]);

const people = (state: AccountState) => hqProjectPeople.derive(readsOfState(state), ORG);

describe("hqProjectPeople", () => {
  it.each([
    {
      name: "an owner HQ names, with their picture",
      project: "ada",
      expected: {
        owned: true,
        owner: { userId: "u-jan", name: "Jan Novák", avatarUrl: "https://img/jan.png" },
        waitsOnViewer: true,
        signedInNow: { "claude-code": "u-jan" },
        everSignedIn: { "claude-code": "u-jan" },
      },
    },
    {
      name: "an owner without a picture, signed out since",
      project: "bob",
      expected: {
        owned: true,
        owner: { userId: "u-eva", name: "Eva", avatarUrl: null },
        waitsOnViewer: false,
        signedInNow: {},
        everSignedIn: { codex: "u-eva" },
      },
    },
    {
      name: "nobody's Mate",
      project: "nobody",
      expected: {
        owned: false,
        owner: null,
        waitsOnViewer: false,
        signedInNow: {},
        everSignedIn: {},
      },
    },
    {
      name: "an owner HQ sends no person of: owned, nobody drawn",
      project: "ghost",
      expected: {
        owned: true,
        owner: null,
        waitsOnViewer: false,
        signedInNow: {},
        everSignedIn: {},
      },
    },
  ])("$name", ({ project, expected }) => {
    expect(people(read)[project]).toEqual(expected);
  });

  it("draws nobody for an owner HQ withdrew from the reader", () => {
    const withdrawn = apply(read, [
      {
        kind: "hq-delivery",
        scopes: generations,
        reset: false,
        rows: [],
        removals: [{ family: "hqPerson", id: "u-jan", reason: "no-access" }],
      },
    ]);
    expect(people(withdrawn).ada?.owner).toBeNull();
  });

  it("says nothing of a project HQ removed, nor before HQ said anything", () => {
    expect(people(removed).bob).toBeUndefined();
    expect(people(removed).ada).toBeDefined();
    expect(people(emptyAccount)).toEqual({});
  });
});
