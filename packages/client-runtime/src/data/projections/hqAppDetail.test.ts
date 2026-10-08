import { describe, expect, it } from "vite-plus/test";

import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { hqAppDetail, hqAppDetails } from "./hqAppDetail.ts";

const ORG = "org";
const SCOPE = hqAppDetailScope(ORG, "shop");
const SHA = "a".repeat(40);
const revision = { kind: "hq", incarnation: "i", revision: 1 } as const;
const repo = { name: "api", mainHead: SHA, updatedAt: "2026-10-06T00:00:00Z" };
const tier = {
  state: "present",
  importYaml: "services:\n  - hostname: api\n",
  mainHead: SHA,
} as const;

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
const row = (key: string, value: Row["value"]): Row =>
  ({ family: "hqAppDetail", id: `shop/${key}`, revision, value }) as Row;
const deliver = (rows: ReadonlyArray<Row>, reset = false): AccountInput => ({
  kind: "delivery",
  via: "hq-stream",
  scopes: [{ scope: SCOPE, generation: 1 }],
  reset,
  rows,
  removals: [],
});

const demanded = apply(emptyAccount, [
  stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
  stream(linkKeys.hq(ORG), { kind: "handshake" }),
  stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
  stream(SCOPE, { kind: "demand", demanded: true }),
  stream(SCOPE, { kind: "attempt" }),
  stream(SCOPE, { kind: "handshake" }),
]);
/** HQ's reset said the repositories and the stage's tier, nothing else yet. */
const partial = apply(demanded, [
  deliver(
    [
      row("repos", { kind: "repos", value: [repo] }),
      row("recipe:stage", { kind: "recipe", value: tier }),
    ],
    true,
  ),
]);
const read = apply(partial, [
  deliver([
    row("releases", { kind: "releases", value: [] }),
    row("changes", { kind: "changes", value: [] }),
    row("recipe:production", { kind: "recipe", value: { state: "absent" } }),
  ]),
  { kind: "hq-ready", scopes: [{ scope: SCOPE, generation: 1 }] },
  stream(SCOPE, { kind: "baseline-committed" }),
]);
const down = apply(read, [
  stream(linkKeys.hq(ORG), {
    kind: "fault",
    fault: { outcome: "transient", message: "HQ's stream broke." },
    jitter: 0,
  }),
  stream(SCOPE, { kind: "parent-lost" }),
]);
const refused = apply(read, [
  stream(SCOPE, {
    kind: "fault",
    fault: {
      outcome: "definitive-refusal",
      message: "You cannot read this application.",
      code: "forbidden",
    },
    jitter: 0,
  }),
]);
const withheld = apply(read, [
  {
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: SCOPE, generation: 1 }],
    reset: false,
    rows: [],
    removals: [{ family: "hqAppDetail", id: "shop/repos", reason: "no-access" }],
  },
]);

const detail = (state: AccountState) =>
  hqAppDetail.derive(readsOfState(state), { orgId: ORG, appId: "shop" });

describe("hqAppDetail", () => {
  it.each([
    {
      name: "not asked",
      state: emptyAccount,
      expected: { read: "unread", live: false, failure: null },
    },
    { name: "first catchup", state: demanded, expected: { read: "reading", live: false } },
    {
      name: "read",
      state: read,
      expected: { read: "read", live: true, reconnecting: false, failure: null },
    },
    {
      name: "HQ down",
      state: down,
      expected: { read: "read", live: false, reconnecting: true, failure: null },
    },
    {
      name: "refused, with HQ's code and words",
      state: refused,
      expected: {
        live: false,
        failure: { code: "forbidden", message: "You cannot read this application." },
      },
    },
  ])("$name", ({ state, expected }) => {
    expect(detail(state)).toMatchObject(expected);
  });

  it("knows only the records HQ said, each apart", () => {
    expect(detail(partial)).toMatchObject({
      releases: undefined,
      repos: [repo],
      changes: undefined,
      recipes: { stage: tier },
    });
    expect(detail(partial).recipes).not.toHaveProperty("production");
  });

  it("reads an empty list under its key, and an absent tier as absent", () => {
    expect(detail(read)).toMatchObject({
      releases: [],
      changes: [],
      recipes: { stage: tier, production: { state: "absent" } },
    });
  });

  it("keeps what it read through an outage and a refusal", () => {
    const { releases, repos, changes, recipes } = detail(read);
    expect(detail(down)).toMatchObject({ releases, repos, changes, recipes });
    expect(detail(refused)).toMatchObject({ releases, repos, changes, recipes });
  });

  it("drops a record HQ withheld", () => {
    expect(detail(withheld).repos).toBeUndefined();
  });

  it("reads a record under another record's key as not known", () => {
    const crossed = apply(read, [
      deliver([
        {
          ...row("releases", { kind: "repos", value: [repo] }),
          revision: { ...revision, revision: 2 },
        },
      ]),
    ]);
    expect(detail(crossed).releases).toBeUndefined();
  });
});

describe("hqAppDetails", () => {
  it("is each named application's detail, by its id", () => {
    const details = hqAppDetails.derive(readsOfState(read), {
      orgId: ORG,
      appIds: ["shop", "blog"],
    });
    expect(Object.keys(details)).toEqual(["shop", "blog"]);
    expect(details.shop).toEqual(detail(read));
    expect(details.blog).toMatchObject({ read: "unread", repos: undefined });
  });

  it("moves when one application's detail moves", () => {
    const key = { orgId: ORG, appIds: ["shop"] };
    expect(
      hqAppDetails.equals(
        hqAppDetails.derive(readsOfState(partial), key),
        hqAppDetails.derive(readsOfState(read), key),
      ),
    ).toBe(false);
  });
});
