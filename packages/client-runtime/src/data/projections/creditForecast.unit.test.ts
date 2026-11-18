import { expect, it } from "vite-plus/test";

import { liveProjects, ORG } from "../__fixtures__/account.ts";
import { balanceScope, organizationBalanceFamily } from "../families/organizationBalance.ts";
import { creditScope } from "../families/organizationCredit.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { creditForecast } from "./creditForecast.ts";

const decode = organizationBalanceFamily.zerops!.decode;
const frame = (answer: Record<string, unknown>) => ({
  id: "status-row",
  clientId: ORG,
  _version: 3,
  ...answer,
});

// witness: packages/client-runtime/src/data/families/organizationBalance.ts | const amount = typeof value === "number" ? value : Number(value); → const amount = typeof value === "number" ? value : Number.NaN;
it("PJ7: An organization's automatic top-up is read from the decimal amounts Zerops sends", () => {
  const answer = {
    credit: 10,
    promoCredit: 0,
    autoTopUp: { threshold: "50", amount: "100.5", calendarMonthlyLimit: "300" },
    status: "ACTIVE",
  };
  expect(decode(frame(answer))?.value).toEqual({
    organizationId: ORG,
    credit: 10,
    promoCredit: 0,
    autoTopUp: { threshold: 50, amount: 100.5, monthlyLimit: 300 },
    status: "ACTIVE",
  });
});

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
/** One read of the organization's own scope, demanded and answering `row`. */
const read = (scope: ScopeKey, row: Pick<Row, "family" | "value">): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    members: [ORG],
    rows: [{ ...row, id: ORG, revision: { kind: "zerops", version: null } } as Row],
  },
  event(scope, { kind: "baseline-committed" }),
];
const needsCredit = (verified: boolean) =>
  creditForecast.derive(
    readsOfState(
      apply(emptyAccount, [
        ...liveProjects(ORG, [{ id: "hq" }]),
        ...read(creditScope(ORG), { family: "organizationCredit", value: { verified } }),
        ...read(balanceScope(ORG), {
          family: "organizationBalance",
          value: {
            organizationId: ORG,
            credit: 0,
            promoCredit: 0,
            autoTopUp: null,
            status: "ACTIVE",
          },
        }),
      ]),
    ),
    { orgId: ORG, openedAt: 0, balanceOpenedAt: 0 },
  );

// witness: packages/client-runtime/src/data/projections/creditForecast.ts | if (credit.kind !== "known" || credit.value.verified) return false; → if (credit.kind !== "known") return false;
it("PJ27: An organization no top-up verified, holding its one free project, needs credit before another project; a verified organization needs none", () => {
  expect(needsCredit(false)).toBe(true);
  expect(needsCredit(true)).toBe(false);
});
