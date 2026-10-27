import { describe, expect, it } from "vite-plus/test";

import { liveProjects, ORG } from "../__fixtures__/account.ts";
import { balanceScope, organizationBalanceFamily } from "../families/organizationBalance.ts";
import { creditScope, organizationCreditFamily } from "../families/organizationCredit.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { creditForecast } from "./creditForecast.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

const CREDIT = creditScope(ORG);
const BALANCE = balanceScope(ORG);
const opening = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
];
/** One read of the organization's own scope answering `row` at `generation`. */
const answer = (
  scope: ScopeKey,
  row: Pick<Row, "family" | "value">,
  generation: number,
): ReadonlyArray<AccountInput> => [
  { kind: "baseline-begin", scope, generation },
  {
    kind: "baseline-commit",
    scope,
    generation,
    via: "zerops-read",
    members: [ORG],
    rows: [{ ...row, id: ORG, revision: { kind: "zerops", version: null } } as Row],
  },
  event(scope, { kind: "baseline-committed" }),
];
const begun = opening(CREDIT);
/** The organization's own record read: whether it is verified. */
const credit = (verified: boolean): ReadonlyArray<AccountInput> => [
  ...begun,
  ...answer(CREDIT, { family: "organizationCredit", value: { verified } }, 1),
];
/** The organization's balance read: its topped-up and its promo credit. */
const balance = (topUp: number, promoCredit: number): ReadonlyArray<AccountInput> => [
  ...opening(BALANCE),
  ...answer(BALANCE, { family: "organizationBalance", value: { credit: topUp, promoCredit } }, 1),
];
const NO_BALANCE = balance(0, 0);
const failed = event(CREDIT, {
  kind: "fault",
  jitter: 0,
  fault: { outcome: "transient", message: "transient" },
});
const balanceFault = (outcome: "transient" | "definitive-refusal") =>
  event(BALANCE, { kind: "fault", jitter: 0, fault: { outcome, message: outcome } });
const ONE_PROJECT = liveProjects(ORG, [{ id: "hq" }]);
const NO_PROJECT = liveProjects(ORG, []);
const OPENED = { orgId: ORG, openedAt: 0, balanceOpenedAt: 0 };

describe("whether a new project waits for credit, before Create", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly needsCredit: boolean;
  }>([
    {
      name: "an organization no top-up verified, with its one free project, needs credit for another",
      inputs: [...ONE_PROJECT, ...credit(false), ...NO_BALANCE],
      needsCredit: true,
    },
    {
      name: "an organization a top-up or Zerops verified needs none",
      inputs: [...ONE_PROJECT, ...credit(true), ...NO_BALANCE],
      needsCredit: false,
    },
    {
      name: "an organization with no project yet makes its free one",
      inputs: [...NO_PROJECT, ...credit(false), ...NO_BALANCE],
      needsCredit: false,
    },
    {
      name: "says nothing while its credit is unknown",
      inputs: [...ONE_PROJECT, ...begun, ...NO_BALANCE],
      needsCredit: false,
    },
    {
      name: "says nothing where its credit could not be read",
      inputs: [...ONE_PROJECT, ...begun, failed, ...NO_BALANCE],
      needsCredit: false,
    },
    {
      name: "says nothing while its projects are not read",
      inputs: [...credit(false), ...NO_BALANCE],
      needsCredit: false,
    },
    {
      name: "keeps saying it while its credit is read again",
      inputs: [
        ...ONE_PROJECT,
        ...credit(false),
        ...NO_BALANCE,
        event(CREDIT, { kind: "revalidate" }),
        event(BALANCE, { kind: "revalidate" }),
      ],
      needsCredit: true,
    },
    {
      name: "an unverified organization with promo credit is not told it needs credit",
      inputs: [...ONE_PROJECT, ...credit(false), ...balance(0, 25)],
      needsCredit: false,
    },
    {
      name: "an unverified organization with topped-up credit is not told it needs credit",
      inputs: [...ONE_PROJECT, ...credit(false), ...balance(10, 0)],
      needsCredit: false,
    },
    {
      name: "an unverified organization in debt, its promo credit spent, needs credit",
      inputs: [...ONE_PROJECT, ...credit(false), ...balance(-3, 0)],
      needsCredit: true,
    },
    {
      name: "says nothing while its balance is unknown",
      inputs: [...ONE_PROJECT, ...credit(false), ...opening(BALANCE)],
      needsCredit: false,
    },
    {
      name: "says nothing where billing refuses its balance",
      inputs: [
        ...ONE_PROJECT,
        ...credit(false),
        ...opening(BALANCE),
        balanceFault("definitive-refusal"),
      ],
      needsCredit: false,
    },
    {
      name: "says nothing where its balance could not be read",
      inputs: [...ONE_PROJECT, ...credit(false), ...opening(BALANCE), balanceFault("transient")],
      needsCredit: false,
    },
  ])("$name", ({ inputs, needsCredit }) => {
    const state = apply(emptyAccount, inputs);
    expect(creditForecast.derive(readsOfState(state), OPENED)).toBe(needsCredit);
  });

  it("a dialog opened again after a top-up says nothing from the record read before, only from its own read", () => {
    const before = apply(emptyAccount, [
      ...ONE_PROJECT,
      ...credit(false),
      ...NO_BALANCE,
      event(CREDIT, { kind: "demand", demanded: false }),
      event(BALANCE, { kind: "demand", demanded: false }),
    ]);
    const opened = {
      orgId: ORG,
      openedAt: before.streams.get(CREDIT)!.generation,
      balanceOpenedAt: before.streams.get(BALANCE)!.generation,
    };
    const reopened = apply(before, [...opening(CREDIT), ...opening(BALANCE)]);
    expect(creditForecast.derive(readsOfState(reopened), opened)).toBe(false);

    const recordAnswered = apply(
      reopened,
      answer(
        CREDIT,
        { family: "organizationCredit", value: { verified: false } },
        reopened.streams.get(CREDIT)!.generation,
      ),
    );
    expect(creditForecast.derive(readsOfState(recordAnswered), opened)).toBe(false);

    const answered = apply(
      recordAnswered,
      answer(
        BALANCE,
        { family: "organizationBalance", value: { credit: 0, promoCredit: 0 } },
        reopened.streams.get(BALANCE)!.generation,
      ),
    );
    expect(creditForecast.derive(readsOfState(answered), opened)).toBe(true);
  });

  it("a dialog opened again after a promo grant says nothing from the balance read before", () => {
    const before = apply(emptyAccount, [
      ...ONE_PROJECT,
      ...credit(false),
      ...NO_BALANCE,
      event(BALANCE, { kind: "demand", demanded: false }),
    ]);
    const opened = {
      orgId: ORG,
      openedAt: 0,
      balanceOpenedAt: before.streams.get(BALANCE)!.generation,
    };
    const reopened = apply(before, opening(BALANCE));
    expect(creditForecast.derive(readsOfState(reopened), opened)).toBe(false);

    const granted = apply(
      reopened,
      answer(
        BALANCE,
        { family: "organizationBalance", value: { credit: 0, promoCredit: 25 } },
        reopened.streams.get(BALANCE)!.generation,
      ),
    );
    expect(creditForecast.derive(readsOfState(granted), opened)).toBe(false);
  });
});

describe("an organization's credit, as Zerops answers its record", () => {
  const decode = organizationCreditFamily.sampled!.decode;

  it.each([
    { name: "verified by its first top-up", answer: { verifiedByTopUp: true }, verified: true },
    {
      name: "verified by Zerops by hand",
      answer: { verifiedByTopUp: false, verifiedManually: true },
      verified: true,
    },
    {
      name: "not verified",
      answer: { verifiedByTopUp: false, verifiedManually: false },
      verified: false,
    },
  ])("reads an organization $name", ({ answer, verified }) => {
    expect(decode({ id: ORG, accountName: "Acme", ...answer })).toEqual({ verified });
  });

  it("reads an answer that does not say it as unread, never as unverified", () => {
    expect(decode({ id: ORG, accountName: "Acme" })).toBeNull();
  });
});

describe("an organization's balance, as billing answers it", () => {
  const decode = organizationBalanceFamily.sampled!.decode;

  it.each([
    {
      name: "with promo credit only",
      answer: { credit: 0, promoCredit: 25.5, autoTopUp: null },
      read: { credit: 0, promoCredit: 25.5 },
    },
    {
      name: "with topped-up credit and no promo amount said",
      answer: { credit: 40 },
      read: { credit: 40, promoCredit: 0 },
    },
    {
      name: "with a promo amount and no topped-up amount said",
      answer: { credit: null, promoCredit: 5 },
      read: { credit: 0, promoCredit: 5 },
    },
    {
      name: "with nothing",
      answer: { credit: 0, promoCredit: 0 },
      read: { credit: 0, promoCredit: 0 },
    },
  ])("reads an organization $name", ({ answer, read }) => {
    expect(decode({ clientInfo: { accountName: "Acme" }, ...answer })).toEqual(read);
  });

  it.each([
    { name: "says neither amount", answer: { clientInfo: { accountName: "Acme" } } },
    { name: "says an amount that is not a number", answer: { credit: "lots", promoCredit: 0 } },
  ])("reads an answer that $name as unread, never as empty", ({ answer }) => {
    expect(decode(answer)).toBeNull();
  });
});
