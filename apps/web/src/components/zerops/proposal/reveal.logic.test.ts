import type { VaultScope, VaultValue, VaultView } from "@t3tools/client-runtime/data";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import type { AskState } from "../../ask/ask.logic";
import type { ProposalDecision } from "./proposal.logic";
import {
  revealAskState,
  revealersOf,
  revealPress,
  revealRecordOf,
  revealRule,
  revealTarget,
  type RevealPhase,
} from "./reveal.logic";

type RevealProposal = Extract<ZeropsProposal, { kind: "env.reveal" }>;

const PROD: RevealProposal = {
  id: "r1",
  kind: "env.reveal",
  summary: "Show DATABASE_PASSWORD from Production",
  reason: "You asked for it to connect from your laptop.",
  projectId: "p-prod",
  projectName: "Production",
  serviceId: "s-db",
  serviceName: "db",
  params: { scope: "service", key: "DATABASE_PASSWORD" },
};

/** The proposal by hostname alone, as a reveal in this Mate names its service. */
const { serviceId: _byId, ...BY_HOSTNAME } = PROD;
/** A project's own value: no service at all. */
const { serviceName: _service, ...PROJECT_VALUE } = BY_HOSTNAME;

const value = (key: string, sensitive: boolean, plain: string | null = null): VaultValue => ({
  id: `v-${key}`,
  key,
  sensitive,
  value: plain,
  createdAt: null,
  changedAt: null,
  madeByZerops: false,
  readers: [],
});

const scope = (
  id: string,
  hostname: string | null,
  values: ReadonlyArray<VaultValue>,
): VaultScope =>
  ({
    ref: id === "shared" ? { kind: "shared" } : { kind: "service", serviceId: id },
    id,
    hostname,
    kind: id === "shared" ? "shared" : "managed",
    serviceType: null,
    editable: id === "shared",
    values,
    reads: [],
    startedAt: null,
  }) as VaultScope;

const view = (status: VaultView["status"], scopes: ReadonlyArray<VaultScope>): VaultView => ({
  status,
  complete: status === "ready",
  scopes,
  notLive: [],
});

const VAULT = view("ready", [
  scope("shared", null, [value("APP_URL", false, "https://shop.example.com")]),
  scope("s-db", "db", [value("DATABASE_PASSWORD", true)]),
]);

describe("where a reveal finds its value", () => {
  it.each<[string, RevealProposal, VaultView, ReturnType<typeof revealTarget>]>([
    [
      "a service's hidden value, by the service's id",
      PROD,
      VAULT,
      {
        kind: "found",
        scope: { kind: "service", serviceId: "s-db" },
        id: "v-DATABASE_PASSWORD",
        plain: null,
      },
    ],
    [
      "a service in this Mate, by its hostname alone",
      BY_HOSTNAME,
      VAULT,
      {
        kind: "found",
        scope: { kind: "service", serviceId: "s-db" },
        id: "v-DATABASE_PASSWORD",
        plain: null,
      },
    ],
    [
      "a plain project value, already in the vault as it is",
      { ...PROJECT_VALUE, params: { scope: "project", key: "APP_URL" } },
      VAULT,
      {
        kind: "found",
        scope: { kind: "shared" },
        id: "v-APP_URL",
        plain: "https://shop.example.com",
      },
    ],
    ["nothing while the vault is read", PROD, view("unread", []), { kind: "reading" }],
    [
      "a key the service does not hold",
      { ...PROD, params: { scope: "service", key: "REDIS_PASSWORD" } },
      VAULT,
      { kind: "missing", words: "db has no REDIS_PASSWORD." },
    ],
    [
      "a project key the project does not hold",
      { ...PROJECT_VALUE, params: { scope: "project", key: "STRIPE_KEY" } },
      VAULT,
      { kind: "missing", words: "Production has no STRIPE_KEY." },
    ],
    [
      "a service the vault does not list",
      { ...PROD, serviceId: "s-gone", serviceName: "cache" },
      VAULT,
      { kind: "missing", words: "Production has no service cache." },
    ],
    [
      "a vault that could not be read",
      PROD,
      view("failed", []),
      { kind: "missing", words: "Production's vault could not be read." },
    ],
  ])("%s", (_title, proposal, vault, expected) => {
    expect(revealTarget(vault, proposal)).toEqual(expected);
  });
});

describe("the reveal's press", () => {
  it.each([
    ["production", "Reveal production value"],
    ["stage", "Reveal"],
    [null, "Reveal"],
  ] as const)("on %s it says %s", (tier, press) => {
    expect(revealPress(tier)).toBe(press);
  });
});

describe("who may reveal it", () => {
  it.each<[string, "production" | "stage" | null, RevealProposal, string]>([
    ["production", "production", PROD, "Only people with production access can reveal this."],
    [
      "a stage",
      "stage",
      { ...PROD, projectName: "Client demo" },
      "Only people with access to Client demo can reveal this.",
    ],
    [
      "this Mate",
      null,
      { ...PROD, projectName: "This Mate" },
      "Only people who can work in this Mate can reveal this.",
    ],
  ])("%s says its rule", (_title, tier, proposal, rule) => {
    expect(revealRule(proposal, tier)).toBe(rule);
  });

  it("names the people who work in the project, by its grants or else their role, never a token", () => {
    const members = [
      { id: "cu-petr", roleCode: "BASIC_USER", user: { id: "petr", fullName: "Petr Novák" } },
      { id: "cu-jana", roleCode: "ADMIN", user: { id: "jana", fullName: "Jana" } },
      { id: "cu-ota", roleCode: "ADMIN", user: { id: "ota", fullName: "Ota" } },
      { id: "cu-iva", roleCode: "READ_ONLY", user: { id: "iva", fullName: "Iva" } },
      { id: "cu-me", roleCode: "ADMIN", user: { id: "me", fullName: "Aleš" } },
    ];
    const grants = {
      status: "ready" as const,
      grants: [
        { clientUserId: "cu-ota", roleCode: "READ_ONLY" },
        { clientUserId: "cu-iva", roleCode: "BASIC_USER" },
      ],
    };
    expect(revealersOf(members, grants, "me")).toEqual(["Petr Novák", "Jana", "Iva"]);
    expect(revealersOf(members, { status: "loading", grants: undefined }, "me")).toEqual([]);
  });
});

describe("the reveal's card, from HQ's record and what happens on this screen", () => {
  const IDLE: RevealPhase = { kind: "idle" };
  // A reveal is approved as it is shown: nothing runs after it, so its approval is the record.
  const DONE: ProposalDecision = { state: "running", at: "2026-11-04T15:32:00.000Z", by: "u-ales" };
  const may = { kind: "may" } as const;
  it.each<[string, Parameters<typeof revealAskState>[0], AskState]>([
    [
      "not revealed yet, it waits on the person",
      { phase: IDLE, decision: undefined, by: null, at: null, authority: may },
      { kind: "waiting" },
    ],
    [
      "pressed, it reveals",
      { phase: { kind: "revealing" }, decision: undefined, by: null, at: null, authority: may },
      { kind: "working", words: "Revealing…", pressed: "main" },
    ],
    [
      "Zerops wants the person to confirm it's them, it says where",
      { phase: { kind: "confirming" }, decision: undefined, by: null, at: null, authority: may },
      { kind: "working", words: "Confirm on your signed-in device to reveal.", pressed: null },
    ],
    [
      "shown, it says only this screen has it and HQ recorded it",
      { phase: { kind: "shown" }, decision: DONE, by: "Aleš", at: "15:32", authority: may },
      { kind: "done", words: "Only on your screen · recorded at HQ", told: null },
    ],
    [
      "revealed before and hidden again, it says to whom and when",
      { phase: IDLE, decision: DONE, by: "Aleš", at: "15:32", authority: may },
      { kind: "done", words: "Revealed to Aleš at 15:32 · hidden again", told: null },
    ],
    [
      "revealed before, to someone this person may not reveal it as, it still says so",
      {
        phase: IDLE,
        decision: DONE,
        by: "Petr",
        at: "15:32",
        authority: {
          kind: "others",
          rule: "Only people with production access can reveal this.",
          names: [],
        },
      },
      { kind: "done", words: "Revealed to Petr at 15:32 · hidden again", told: null },
    ],
    [
      "left for now, it says who and when",
      {
        phase: IDLE,
        decision: { state: "declined", at: "2026-11-04T15:34:00.000Z" },
        by: "Aleš",
        at: "15:34",
        authority: may,
      },
      { kind: "notNow", words: "Not now · Aleš, 15:34" },
    ],
    [
      "refused, it says the source's words",
      {
        phase: { kind: "failed", words: "Your role in this organization can't show secrets." },
        decision: undefined,
        by: null,
        at: null,
        authority: may,
      },
      { kind: "failed", words: "Your role in this organization can't show secrets." },
    ],
    [
      "someone else's to reveal, it names who can",
      {
        phase: IDLE,
        decision: undefined,
        by: null,
        at: null,
        authority: {
          kind: "others",
          rule: "Only people with production access can reveal this.",
          names: ["Petr"],
        },
      },
      {
        kind: "othersToAnswer",
        words: "Only people with production access can reveal this. Petr can.",
      },
    ],
  ])("%s", (_title, input, state) => {
    expect(revealAskState(input)).toEqual(state);
  });
});

describe("what HQ records of a reveal", () => {
  it.each<[string, RevealProposal, ReturnType<typeof revealRecordOf>]>([
    [
      "a service's value, after its hostname",
      PROD,
      { projectId: "p-prod", service: "db", key: "DATABASE_PASSWORD" },
    ],
    [
      "a project's value, by its name alone",
      { ...PROJECT_VALUE, params: { scope: "project", key: "APP_URL" } },
      { projectId: "p-prod", key: "APP_URL" },
    ],
  ])("%s", (_title, proposal, record) => {
    expect(revealRecordOf(proposal)).toEqual(record);
  });
});
