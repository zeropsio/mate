import type { VaultView } from "@t3tools/client-runtime/data";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import type { HqProposalDecision } from "@t3tools/client-runtime/zerops/hq";

import {
  PROPOSAL_DECISIONS_KEPT,
  chiefAsk,
  chiefMessageTarget,
  decisionFromHq,
  envProposalWrite,
  furtherDecision,
  hqWriteOf,
  proposalMessage,
  proposalOutcomeWords,
  proposalRecipient,
  proposalStage,
  proposalWhere,
  recordDecision,
  type ProposalDecision,
  type ProposalDecisions,
  type ProposalStage,
} from "./proposal.logic";

const AT = "2026-10-12T10:00:00.000Z";
const LATER = "2026-10-12T10:01:00.000Z";

describe("proposalStage", () => {
  it.each<[string, ProposalDecision | undefined, boolean, ReturnType<typeof proposalStage>]>([
    ["undecided, it offers Approve and Decline", undefined, false, "open"],
    ["approved here and still going, it runs", { state: "running", at: AT }, true, "running"],
    [
      "approved before a reload, its end was not seen here",
      { state: "running", at: AT },
      false,
      "unseen",
    ],
    ["done, it says so", { state: "done", at: AT }, false, "done"],
    ["failed, it says so", { state: "failed", at: AT, message: "No." }, false, "failed"],
    ["declined, it says so", { state: "declined", at: AT }, false, "declined"],
  ])("%s", (_title, decision, runningHere, stage) => {
    expect(proposalStage(decision, runningHere)).toBe(stage);
  });
});

describe("recordDecision", () => {
  it.each<[string, ProposalDecision | undefined, ProposalDecision, ProposalDecision | undefined]>([
    [
      "an undecided proposal is approved",
      undefined,
      { state: "running", at: AT },
      { state: "running", at: AT },
    ],
    [
      "an undecided proposal is declined",
      undefined,
      { state: "declined", at: AT },
      { state: "declined", at: AT },
    ],
    [
      "an approved one ends done",
      { state: "running", at: AT },
      { state: "done", at: LATER },
      { state: "done", at: LATER },
    ],
    [
      "an approved one ends failed, in the platform's words",
      { state: "running", at: AT },
      { state: "failed", at: LATER, message: "Service is not running." },
      { state: "failed", at: LATER, message: "Service is not running." },
    ],
    [
      "an approved one is never approved twice",
      { state: "running", at: AT },
      { state: "running", at: LATER },
      { state: "running", at: AT },
    ],
    [
      "a done one is never approved again",
      { state: "done", at: AT },
      { state: "running", at: LATER },
      { state: "done", at: AT },
    ],
    [
      "a declined one is never approved after",
      { state: "declined", at: AT },
      { state: "running", at: LATER },
      { state: "declined", at: AT },
    ],
    [
      "an approved one is never declined after",
      { state: "running", at: AT },
      { state: "declined", at: LATER },
      { state: "running", at: AT },
    ],
    [
      "an undecided one never ends without its approval",
      undefined,
      { state: "done", at: AT },
      undefined,
    ],
  ])("%s", (_title, before, next, after) => {
    const decisions: ProposalDecisions = before === undefined ? {} : { p1: before };
    expect(recordDecision(decisions, "p1", next)["p1"]).toEqual(after);
  });

  it("keeps the newest decisions only, so the record never grows without end", () => {
    const many: ProposalDecisions = Object.fromEntries(
      Array.from({ length: PROPOSAL_DECISIONS_KEPT }, (_, index) => [
        `old-${index}`,
        { state: "declined", at: new Date(Date.parse(AT) - (index + 1) * 1000).toISOString() },
      ]),
    );
    const kept = recordDecision(many, "new", { state: "declined", at: AT });
    expect(Object.keys(kept)).toHaveLength(PROPOSAL_DECISIONS_KEPT);
    expect(kept["new"]).toEqual({ state: "declined", at: AT });
    expect(kept[`old-${PROPOSAL_DECISIONS_KEPT - 1}`]).toBeUndefined();
  });
});

describe("proposalMessage", () => {
  it.each<[string, Parameters<typeof proposalMessage>[0], string]>([
    [
      "words alone are sent as they are",
      { to: { projectId: "p", mateName: "Rossy" }, words: "Write the release notes." },
      "Write the release notes.",
    ],
    [
      "an attachment follows the words, titled and quoted whole",
      {
        to: { projectId: "p", mateName: "Rossy" },
        words: "These prod logs show checkout failing. Please debug it.",
        attachment: {
          title: "prod · api · last 2 lines",
          text: "ERR 500 /checkout\nERR 502 /pay\n",
        },
      },
      "These prod logs show checkout failing. Please debug it.\n\nprod · api · last 2 lines:\n```\nERR 500 /checkout\nERR 502 /pay\n```",
    ],
  ])("%s", (_title, params, message) => {
    expect(proposalMessage(params)).toBe(message);
  });
});

const view = (scopes: ReadonlyArray<Partial<VaultView["scopes"][number]>>): VaultView =>
  ({
    status: "ready",
    complete: true,
    notLive: [],
    scopes: scopes.map((scope) => ({
      ref: { kind: "shared" },
      id: "shared",
      hostname: null,
      kind: "shared",
      serviceType: null,
      editable: true,
      values: [],
      reads: [],
      startedAt: null,
      ...scope,
    })),
  }) as unknown as VaultView;

const value = (id: string, key: string) =>
  ({
    id,
    key,
    sensitive: false,
    value: "x",
    createdAt: null,
    changedAt: null,
    madeByZerops: false,
    readers: [],
  }) as const;

const envProposal = (
  scope: "project" | "service",
  key: string,
  secret = false,
): Extract<ZeropsProposal, { kind: "env.set" }> => ({
  id: "p1",
  kind: "env.set",
  summary: `Set ${key}`,
  projectId: "p-contoso",
  ...(scope === "service" ? { serviceId: "s-api" } : {}),
  params: { scope, key, value: "v2", secret },
});

describe("envProposalWrite", () => {
  it.each<[string, VaultView, ReturnType<typeof envProposal>, ReturnType<typeof envProposalWrite>]>(
    [
      [
        "a new project value is added to Shared",
        view([{ values: [value("v1", "OTHER")] }]),
        envProposal("project", "STRIPE_KEY", true),
        {
          scope: { kind: "shared" },
          write: { kind: "add", key: "STRIPE_KEY", value: "v2", sensitive: true },
        },
      ],
      [
        "a project value held already is updated in place",
        view([{ values: [value("v1", "STRIPE_KEY")] }]),
        envProposal("project", "STRIPE_KEY"),
        {
          scope: { kind: "shared" },
          write: { kind: "update", id: "v1", key: "STRIPE_KEY", value: "v2", sensitive: false },
        },
      ],
      [
        "a service's value goes to that service's vault",
        view([
          {},
          {
            ref: { kind: "service", serviceId: "s-api" },
            id: "s-api",
            hostname: "api",
            kind: "runtime",
            values: [value("v9", "LOG_LEVEL")],
          },
        ]),
        envProposal("service", "LOG_LEVEL"),
        {
          scope: { kind: "service", serviceId: "s-api" },
          write: { kind: "update", id: "v9", key: "LOG_LEVEL", value: "v2", sensitive: false },
        },
      ],
      [
        "nothing is written while the vault is not read",
        { ...view([]), status: "unread" } as VaultView,
        envProposal("project", "A"),
        { refused: "Reading the vault…" },
      ],
      [
        "a service the vault does not hold is refused",
        view([{}]),
        envProposal("service", "A"),
        { refused: "That service is not in the project's vault." },
      ],
      [
        "a managed service's values are Zerops's to set",
        view([
          {},
          {
            ref: { kind: "service", serviceId: "s-api" },
            id: "s-api",
            hostname: "db",
            kind: "managed",
            editable: false,
          },
        ]),
        envProposal("service", "A"),
        { refused: "Zerops sets db's values; they cannot be written here." },
      ],
    ],
  )("%s", (_title, vault, proposal, write) => {
    expect(envProposalWrite(vault, proposal)).toEqual(write);
  });
});

describe("proposalOutcomeWords", () => {
  const restart: ZeropsProposal = {
    id: "p1",
    kind: "service.restart",
    summary: "Restart medusa in Contoso",
    projectId: "p",
    serviceId: "s",
    serviceName: "medusa",
  };
  const stop: ZeropsProposal = { ...restart, kind: "service.stop", summary: "Stop medusa" };
  const start: ZeropsProposal = { ...restart, kind: "service.start", summary: "Start medusa" };
  const env = envProposal("project", "STRIPE_KEY");
  const message: ZeropsProposal = {
    id: "p2",
    kind: "mate.message",
    summary: "Ask Rossy",
    params: { to: { projectId: "p", mateName: "Rossy" }, words: "Hi" },
  };
  const askChief: ZeropsProposal = {
    id: "p3",
    kind: "chief.message",
    summary: "Ask your Chief",
    projectId: "p-shop",
    params: { words: "Who owns orders?" },
  };
  it.each<[ZeropsProposal, Exclude<ProposalStage, "open" | "failed">, string]>([
    [restart, "running", "Restarting medusa…"],
    [restart, "done", "Restarted medusa."],
    [start, "running", "Starting medusa…"],
    [start, "done", "Started medusa."],
    [stop, "running", "Stopping medusa…"],
    [stop, "done", "Stopped medusa."],
    [env, "running", "Writing STRIPE_KEY to the vault…"],
    [env, "done", "STRIPE_KEY is in the vault."],
    [message, "running", "Sending to Rossy…"],
    [message, "done", "Sent to Rossy."],
    [askChief, "running", "Sending to your Chief…"],
    [askChief, "done", "Sent to your Chief."],
    [restart, "declined", "Declined. Nothing ran."],
    [restart, "unseen", "Approved before the page reloaded. How it ended was not seen here."],
  ])("%j %s: %s", (proposal, stage, words) => {
    expect(proposalOutcomeWords(proposal, stage)).toBe(words);
  });
});

describe("proposalWhere", () => {
  it.each<[string, ZeropsProposal, string | null]>([
    [
      "a service's change names it and its project",
      {
        id: "p",
        kind: "service.restart",
        summary: "s",
        projectId: "p",
        projectName: "Contoso",
        serviceId: "s",
        serviceName: "medusa",
      },
      "medusa · Contoso",
    ],
    [
      "a project value is every app's",
      { ...envProposal("project", "A"), projectName: "Contoso" },
      "Every app in Contoso",
    ],
    [
      "a service's value is its own",
      { ...envProposal("service", "A"), projectName: "Contoso", serviceName: "api" },
      "api's own · Contoso",
    ],
    [
      "a message names nothing here: its Mate is drawn",
      {
        id: "p",
        kind: "mate.message",
        summary: "s",
        params: { to: { projectId: "p", mateName: "R" }, words: "w" },
      },
      null,
    ],
  ])("%s", (_title, proposal, where) => {
    expect(proposalWhere(proposal)).toBe(where);
  });
});

describe("proposalRecipient", () => {
  const rossy = { projectId: "p-shop", name: "Rossy", tint: "coral", shape: "squircle" } as const;
  const juno = { projectId: "p-shop", name: "Juno", tint: "sky", shape: "squircle" } as const;
  const other = { projectId: "p-other", name: "Rossy", tint: "olive", shape: "squircle" } as const;
  it.each<
    [string, ReadonlyArray<typeof rossy | typeof juno | typeof other | null>, string | undefined]
  >([
    ["the Mate named in its project", [other, juno, rossy], "coral"],
    ["the name read without regard to case", [juno, { ...rossy, name: "rossy" } as never], "coral"],
    ["the project's one Mate where the name is not its", [{ ...juno, tint: "sky" }], "sky"],
    [
      "nobody where several live there and none has the name",
      [juno, { ...juno, name: "Ivy" } as never],
      undefined,
    ],
    ["nobody where the project has no Mate the menu knows", [other, null], undefined],
  ])("%s", (_title, identities, tint) => {
    expect(proposalRecipient(identities, { projectId: "p-shop", mateName: "Rossy" })?.tint).toBe(
      tint,
    );
  });
});

const held = (fields: Partial<HqProposalDecision>): HqProposalDecision => ({
  id: "p1",
  projectId: "p-chief",
  decision: "approved",
  outcome: null,
  words: null,
  by: "u1",
  at: AT,
  ...fields,
});

describe("decisions kept at HQ", () => {
  it.each<[string, HqProposalDecision, ProposalDecision]>([
    ["an approval HQ holds no end of is still running", held({}), { state: "running", at: AT }],
    ["an approval that ended done", held({ outcome: "done" }), { state: "done", at: AT }],
    [
      "an approval that failed says the platform's words",
      held({ outcome: "failed", words: "Zerops said no." }),
      { state: "failed", at: AT, message: "Zerops said no." },
    ],
    [
      "a failure HQ holds no words of still says it failed",
      held({ outcome: "failed" }),
      { state: "failed", at: AT, message: "Zerops did not do it." },
    ],
    ["a decline", held({ decision: "declined" }), { state: "declined", at: AT }],
  ])("a card reads %s", (_title, record, decision) => {
    expect(decisionFromHq(record)).toEqual(decision);
  });

  it.each<[string, ProposalDecision, ReturnType<typeof hqWriteOf>]>([
    [
      "an approval as approved",
      { state: "running", at: AT },
      { projectId: "p-chief", decision: "approved" },
    ],
    [
      "an approval's end as done",
      { state: "done", at: AT },
      { projectId: "p-chief", decision: "approved", outcome: "done" },
    ],
    [
      "a failure with the platform's words",
      { state: "failed", at: AT, message: "No." },
      { projectId: "p-chief", decision: "approved", outcome: "failed", words: "No." },
    ],
    [
      "a decline as declined",
      { state: "declined", at: AT },
      { projectId: "p-chief", decision: "declined" },
    ],
  ])("HQ is sent %s, under the conversation's project", (_title, decision, write) => {
    expect(hqWriteOf(decision, "p-chief")).toEqual(write);
  });

  it.each<[string, ProposalDecision | undefined, ProposalDecision, ProposalDecision]>([
    [
      "HQ's answer draws a card this tab knew nothing of",
      undefined,
      { state: "declined", at: AT },
      { state: "declined", at: AT },
    ],
    [
      "an answer read before this tab's approval landed takes nothing back",
      { state: "running", at: LATER },
      { state: "running", at: AT },
      { state: "running", at: LATER },
    ],
    [
      "an approval's end another tab saw replaces the running one",
      { state: "running", at: AT },
      { state: "done", at: LATER },
      { state: "done", at: LATER },
    ],
    [
      "a running approval HQ has no word of yet stays running",
      { state: "done", at: LATER },
      { state: "running", at: AT },
      { state: "done", at: LATER },
    ],
  ])("%s", (_title, before, answered, after) => {
    expect(furtherDecision(before, answered)).toEqual(after);
  });
});

describe("asking the Chief", () => {
  it.each<[string, Parameters<typeof chiefAsk>[0], string]>([
    [
      "says who asks and from where, then the words",
      { words: "Who owns the orders table?" },
      "From Rossy in Shop:\n\nWho owns the orders table?",
    ],
    [
      "hands the attachment along, titled and quoted whole",
      {
        words: "Is this ours?",
        attachment: { title: "schema diff", text: "ALTER TABLE orders\n" },
      },
      "From Rossy in Shop:\n\nIs this ours?\n\nschema diff:\n```\nALTER TABLE orders\n```",
    ],
  ])("%s", (_title, params, message) => {
    expect(chiefAsk(params, { mateName: "Rossy", projectName: "Shop" })).toBe(message);
  });

  it.each<[string, string | null | undefined, ReturnType<typeof chiefMessageTarget>]>([
    ["goes to the viewer's own Chief", "p-chief", { kind: "chief", projectId: "p-chief" }],
    ["offers to set one up where the viewer has none", null, { kind: "none" }],
    ["waits while whose Chief is not known", undefined, { kind: "unknown" }],
  ])("an ask of the Chief %s", (_title, own, target) => {
    expect(chiefMessageTarget(own)).toEqual(target);
  });
});
