import { describe, expect, it } from "vite-plus/test";

import { liveProjects, ORG } from "../__fixtures__/account.ts";
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
const begun: ReadonlyArray<AccountInput> = [
  event(CREDIT, { kind: "demand", demanded: true }),
  event(CREDIT, { kind: "attempt" }),
  event(CREDIT, { kind: "handshake" }),
];
/** The organization's own record read: whether it is verified. */
const credit = (verified: boolean): ReadonlyArray<AccountInput> => [
  ...begun,
  { kind: "baseline-begin", scope: CREDIT, generation: 1 },
  {
    kind: "baseline-commit",
    scope: CREDIT,
    generation: 1,
    via: "zerops-read",
    members: [ORG],
    rows: [
      {
        family: "organizationCredit",
        id: ORG,
        value: { verified },
        revision: { kind: "zerops", version: null },
      } as Row,
    ],
  },
  event(CREDIT, { kind: "baseline-committed" }),
];
const failed = event(CREDIT, {
  kind: "fault",
  jitter: 0,
  fault: { outcome: "transient", message: "transient" },
});
const ONE_PROJECT = liveProjects(ORG, [{ id: "hq" }]);
const NO_PROJECT = liveProjects(ORG, []);

describe("whether a new project waits for credit, before Create", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly needsCredit: boolean;
  }>([
    {
      name: "an organization no top-up verified, with its one free project, needs credit for another",
      inputs: [...ONE_PROJECT, ...credit(false)],
      needsCredit: true,
    },
    {
      name: "an organization a top-up or Zerops verified needs none",
      inputs: [...ONE_PROJECT, ...credit(true)],
      needsCredit: false,
    },
    {
      name: "an organization with no project yet makes its free one",
      inputs: [...NO_PROJECT, ...credit(false)],
      needsCredit: false,
    },
    {
      name: "says nothing while its credit is unknown",
      inputs: [...ONE_PROJECT, ...begun],
      needsCredit: false,
    },
    {
      name: "says nothing where its credit could not be read",
      inputs: [...ONE_PROJECT, ...begun, failed],
      needsCredit: false,
    },
    {
      name: "says nothing while its projects are not read",
      inputs: credit(false),
      needsCredit: false,
    },
    {
      name: "keeps saying it while its credit is read again",
      inputs: [...ONE_PROJECT, ...credit(false), event(CREDIT, { kind: "revalidate" })],
      needsCredit: true,
    },
  ])("$name", ({ inputs, needsCredit }) => {
    const state = apply(emptyAccount, inputs);
    expect(creditForecast.derive(readsOfState(state), ORG)).toBe(needsCredit);
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
