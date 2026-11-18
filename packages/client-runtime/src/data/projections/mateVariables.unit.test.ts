import { expect, it } from "vite-plus/test";
import { liveServices, ORG } from "../__fixtures__/account.ts";
import { mateVariablesScope, type MateVariablesValue } from "../families/mateVariables.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateVariables } from "./mateVariables.ts";

const SCOPE = mateVariablesScope(ORG, "zcp");
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
const apply = (inputs: ReadonlyArray<AccountInput>): AccountState =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, emptyAccount);

const flag = (on: boolean): Partial<MateVariablesValue> => ({ flag: on });

/** The organization's services (the Mate's container `zcp`, as `status`; a later Mate's `fresh`) and `zcp`'s read demanded. */
const demanded = (status = "ACTIVE") => [
  ...liveServices(ORG, [
    { id: "zcp", projectId: "p1", status },
    { id: "fresh", projectId: "p2", status: "ACTIVE" },
  ]),
  event(SCOPE, { kind: "demand", demanded: true }),
  event(SCOPE, { kind: "attempt" }),
  event(SCOPE, { kind: "handshake" }),
  { kind: "baseline-begin", scope: SCOPE, generation: 1 } as AccountInput,
];

/** `zcp`'s search answered with these of its enable flag. */
const answered = (
  rows: ReadonlyArray<Partial<MateVariablesValue>>,
  status?: string,
): AccountState =>
  apply([
    ...demanded(status),
    {
      kind: "baseline-commit",
      scope: SCOPE,
      generation: 1,
      via: "zerops-read",
      members: ["zcp"],
      rows: [
        {
          family: "mateVariables",
          id: "zcp",
          value: Object.assign({ flag: null }, ...rows),
          revision: { kind: "zerops", version: null },
        },
      ],
    } as AccountInput,
    event(SCOPE, { kind: "baseline-committed" }),
  ]);
// witness: packages/client-runtime/src/data/projections/mateVariables.ts | status === "failed" ? UNKNOWN : UNREAD → status === "failed" ? UNKNOWN : { flag: false }
it("PJ64: Another Mate's container variables are unread until its own answer, never off", () => {
  const state = answered([flag(true)]);
  expect(mateVariables.derive(readsOfState(state), { orgId: ORG, serviceId: "fresh" })).toEqual({
    flag: "unread",
  });
});
