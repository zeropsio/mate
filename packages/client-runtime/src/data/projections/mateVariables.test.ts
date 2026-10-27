import { describe, expect, it } from "vite-plus/test";

import { liveServices, ORG } from "../__fixtures__/account.ts";
import { mateVariablesScope, type MateVariablesValue } from "../families/mateVariables.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateVariables, type MateVariables } from "./mateVariables.ts";

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

describe("mateVariables", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly expected: MateVariables;
  }>([
    {
      name: "not read yet: unread, never off",
      state: () => apply(demanded()),
      expected: { flag: "unread" },
    },
    {
      name: "the read failed: unknown, never off",
      state: () =>
        apply([
          ...demanded(),
          event(SCOPE, {
            kind: "fault",
            fault: { outcome: "authoritative-denial", message: "HTTP 403" },
            jitter: 0,
          }),
        ]),
      expected: { flag: "unknown" },
    },
    {
      name: "its flag on",
      state: () => answered([flag(true)]),
      expected: { flag: true },
    },
    {
      name: "a flag turned off reads off",
      state: () => answered([flag(false)]),
      expected: { flag: false },
    },
    {
      name: "a redacted flag stays unknown",
      state: () => answered([{ flag: "unknown" }]),
      expected: { flag: "unknown" },
    },
    {
      name: "an absent flag reads off",
      state: () => answered([], "ACTIVE"),
      expected: { flag: false },
    },
    {
      name: "a re-read under way keeps what the last answer said",
      state: () => {
        const read = answered([flag(true)]);
        return [
          event(SCOPE, { kind: "attempt" }),
          { kind: "baseline-begin", scope: SCOPE, generation: 2 } as AccountInput,
        ].reduce((current, input) => reduceAccount(current, input).state, read);
      },
      expected: { flag: true },
    },
    {
      name: "let go: what the last answer said stands",
      state: () =>
        reduceAccount(answered([flag(true)]), event(SCOPE, { kind: "demand", demanded: false }))
          .state,
      expected: { flag: true },
    },
    {
      name: "an outage after the answer keeps what it said",
      state: () =>
        reduceAccount(
          answered([flag(true)]),
          event(linkKeys.zerops(ORG), {
            kind: "fault",
            fault: { outcome: "transient", message: "socket closed" },
            jitter: 0,
          }),
        ).state,
      expected: { flag: true },
    },
  ])("$name", ({ state, expected }) => {
    expect(mateVariables.derive(readsOfState(state()), { orgId: ORG, serviceId: "zcp" })).toEqual(
      expected,
    );
  });
});

it("another Mate's container is unread until its own answer, never off", () => {
  const state = answered([flag(true)]);
  expect(mateVariables.derive(readsOfState(state), { orgId: ORG, serviceId: "fresh" })).toEqual({
    flag: "unread",
  });
});
