import { expect, it } from "vite-plus/test";

import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { emptyAccount, linkKeys, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { hqAppDetail } from "./hqAppDetail.ts";

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
): AccountInput => ({ kind: "stream", key, now: 0, event });
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

// witness: packages/client-runtime/src/data/projections/hqAppDetail.ts | value?.kind === "releases" → value !== undefined
it("PJ44: An application record read under another record's key is not known", () => {
  const read = apply(emptyAccount, [
    stream(linkKeys.hq(ORG), { kind: "demand", demanded: true }),
    stream(linkKeys.hq(ORG), { kind: "handshake" }),
    stream(linkKeys.hq(ORG), { kind: "baseline-committed" }),
    stream(SCOPE, { kind: "demand", demanded: true }),
    stream(SCOPE, { kind: "attempt" }),
    stream(SCOPE, { kind: "handshake" }),
    deliver(
      [
        row("repos", { kind: "repos", value: [repo] }),
        row("recipe:stage", { kind: "recipe", value: tier }),
      ],
      true,
    ),
    deliver([
      row("releases", { kind: "releases", value: [] }),
      row("changes", { kind: "changes", value: [] }),
      row("recipe:production", { kind: "recipe", value: { state: "absent" } }),
    ]),
    { kind: "hq-ready", scopes: [{ scope: SCOPE, generation: 1 }] },
    stream(SCOPE, { kind: "baseline-committed" }),
  ]);
  const crossed = apply(read, [
    deliver([
      {
        ...row("releases", { kind: "repos", value: [repo] }),
        revision: { ...revision, revision: 2 },
      },
    ]),
  ]);
  expect(hqAppDetail.derive(readsOfState(crossed), { orgId: ORG, appId: "shop" }).releases).toBe(
    undefined,
  );
});
