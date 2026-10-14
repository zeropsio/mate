import type { AddressDomain, PlaceAddresses, VaultView } from "@t3tools/client-runtime/data";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import type { HqProposalDecision } from "@t3tools/client-runtime/zerops/hq";

import {
  PROPOSAL_DECISIONS_KEPT,
  chiefAsk,
  chiefMessageTarget,
  decisionFromHq,
  domainProposalAlso,
  domainProposalState,
  envProposalWrite,
  furtherDecision,
  hqWriteOf,
  proposalMessage,
  heldMessageWords,
  proposalOutcomeWords,
  proposalRecipient,
  proposalStage,
  proposalTitle,
  proposalWhere,
  recordDecision,
  type ProposalDecision,
  type ProposalDecisions,
  type ProposalStage,
  domainProposalRecords,
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

const domain: Extract<ZeropsProposal, { kind: "domain.add" }> = {
  id: "p-domain",
  kind: "domain.add",
  summary: "Put Contoso - production on contoso.com and www.contoso.com",
  reason: "The shop is ready for its own name.",
  projectId: "pProd",
  projectName: "Contoso - production",
  serviceId: "sMedusa",
  serviceName: "medusa",
  params: { domains: ["contoso.com", "www.contoso.com"], port: 9000 },
};

describe("proposalTitle", () => {
  it.each<[string, ZeropsProposal, string]>([
    [
      "a domain and its www put the project on both",
      domain,
      "Put Contoso - production on contoso.com and www.contoso.com",
    ],
    [
      "the www named first still reads apex first",
      { ...domain, params: { ...domain.params, domains: ["www.contoso.com", "contoso.com"] } },
      "Put Contoso - production on contoso.com and www.contoso.com",
    ],
    [
      "one domain is named alone",
      { ...domain, params: { ...domain.params, domains: ["api.contoso.com"] } },
      "Put Contoso - production on api.contoso.com",
    ],
    [
      "unrelated domains are listed",
      { ...domain, params: { ...domain.params, domains: ["a.com", "b.com", "c.com"] } },
      "Put Contoso - production on a.com, b.com and c.com",
    ],
    [
      "any other proposal titles itself by its summary",
      {
        id: "p",
        kind: "service.restart",
        summary: "Restart medusa in Contoso",
        projectId: "p",
        serviceId: "s",
      },
      "Restart medusa in Contoso",
    ],
  ])("%s", (_title, proposal, title) => {
    expect(proposalTitle(proposal)).toBe(title);
  });
});

const placed = (
  over: Partial<AddressDomain> & Pick<AddressDomain, "domainName">,
): AddressDomain => ({
  routingId: "r1",
  routingDomains: [over.domainName],
  targets: [{ serviceId: "sMedusa", serviceName: "medusa", port: 9000, path: "/" }],
  sslEnabled: true,
  face: "live",
  url: `https://${over.domainName}`,
  resolvedIps: [],
  nameServers: [],
  ...over,
});

const place = (
  domains: ReadonlyArray<AddressDomain>,
  over: Partial<PlaceAddresses> = {},
): PlaceAddresses => ({
  state: "ready",
  domains,
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "ready",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains: [],
  waitingPorts: [],
  readsProject: false,
  ...over,
});

describe("domainProposalState", () => {
  const both = (face: AddressDomain["face"], www: AddressDomain["face"] = face) =>
    place([
      placed({ domainName: "contoso.com", face }),
      placed({ domainName: "www.contoso.com", face: www }),
    ]);
  it.each<[string, PlaceAddresses, ReturnType<typeof domainProposalState>]>([
    [
      "an added domain waits for the person's DNS, and says where to add its records",
      both("dns"),
      {
        tone: "waiting",
        words: "Waiting for your DNS. Add contoso.com's records at your DNS provider.",
      },
    ],
    [
      "a domain being put in place says so",
      both("going-live"),
      { tone: "working", words: "Putting contoso.com in place…" },
    ],
    [
      "a domain whose DNS points elsewhere says what to change",
      both("elsewhere"),
      {
        tone: "problem",
        words: "contoso.com points elsewhere. Change its records at your DNS provider.",
      },
    ],
    [
      "a domain with the right DNS waits for its certificate",
      both("certificate"),
      { tone: "working", words: "Your DNS is right. contoso.com's certificate is on its way…" },
    ],
    [
      "a certificate that could not be installed says the platform's words",
      place([
        placed({
          domainName: "contoso.com",
          face: "certificate-failed",
          sslError: "CAA record forbids it.",
        }),
        placed({ domainName: "www.contoso.com" }),
      ]),
      {
        tone: "problem",
        words: "contoso.com's certificate could not be installed. CAA record forbids it.",
      },
    ],
    [
      "the domain furthest from answering speaks for both",
      both("live", "dns"),
      {
        tone: "waiting",
        words: "Waiting for your DNS. Add www.contoso.com's records at your DNS provider.",
      },
    ],
    [
      "both answering say they are live",
      both("live"),
      { tone: "live", words: "contoso.com and www.contoso.com are live." },
    ],
    ["nothing while the addresses are read", place([], { state: "reading" }), undefined],
    ["nothing while the project holds none of its domains", place([]), undefined],
  ])("%s", (_title, addresses, state) => {
    expect(domainProposalState(addresses, domain)).toEqual(state);
  });
});

describe("domainProposalRecords", () => {
  const ips = {
    v6: "2001:db8::1",
    sharedV4: "93.185.106.128",
    zone: "p1.prg1-zerops.zone",
    zoneHasSharedV4: false,
  };
  it("an approved domain waiting for DNS lists the records still to add, its domains alone", () => {
    const records = domainProposalRecords(
      place(
        [
          placed({ domainName: "contoso.com", face: "live" }),
          placed({ domainName: "www.contoso.com", face: "dns" }),
          placed({ domainName: "other.com", face: "dns" }),
        ],
        { ips },
      ),
      domain,
    );
    expect(records?.records.map((record) => `${record.type} ${record.name}`)).toEqual([
      "A www.contoso.com",
      "AAAA www.contoso.com",
    ]);
    expect(records?.cnames.map((record) => [record.name, record.ipv4])).toEqual([
      ["www.contoso.com", false],
    ]);
  });

  it.each<[string, PlaceAddresses]>([
    ["nothing once every domain answers", place([placed({ domainName: "contoso.com" })], { ips })],
    ["nothing while the addresses are read", place([], { state: "reading" })],
    [
      "nothing while the project's IP addresses are unread",
      place([placed({ domainName: "contoso.com", face: "dns" })]),
    ],
  ])("%s", (_title, addresses) => {
    expect(domainProposalRecords(addresses, domain)).toBeUndefined();
  });
});

describe("domainProposalAlso", () => {
  it.each<[string, PlaceAddresses, string | undefined]>([
    ["no other change waits: approving puts in place only this", place([]), undefined],
    [
      "another change waiting goes live with it, named before the person approves",
      place([], {
        waitingDomains: [
          { id: "w1", label: "shop.com → app · port 3000" },
          { id: "w2", label: "Removing api.shop.com" },
        ],
      }),
      "Approving also puts in place: shop.com → app · port 3000, Removing api.shop.com.",
    ],
  ])("%s", (_title, addresses, words) => {
    expect(domainProposalAlso(addresses)).toBe(words);
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
    [domain, "running", "Adding contoso.com and www.contoso.com…"],
    [domain, "done", "Added contoso.com and www.contoso.com."],
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
    ["a domain names the service and the web port it points at", domain, "→ medusa · port 9000"],
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

describe("heldMessageWords", () => {
  it("an approved message its Mate took no turn on says why, and where it waits", () => {
    expect(heldMessageWords("Eddy", "Eddy needs a Claude sign-in to continue.")).toBe(
      "Eddy needs a Claude sign-in to continue. Your message waits in Eddy's composer.",
    );
  });
});
