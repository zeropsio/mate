/**
 * A proposal on its card: what the person decided of it, as HQ keeps it (`hq/chief.ts`), how an
 * approved one is carried out, the words a message to another Mate — or to the person's own
 * Chief — is sent in, and how far an approved domain is from answering. Nothing here acts; the card's container carries out an approval as the
 * person.
 */
import type {
  DomainFace,
  PlaceAddresses,
  ProjectGrantsRead,
  VaultScopeRef,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import type {
  HqProposalDecision,
  HqProposalDecisionWrite,
} from "@t3tools/client-runtime/zerops/hq";
import type {
  ZeropsAccessLevel,
  ZeropsChiefMessageParams,
  ZeropsMessageProposalParams,
  ZeropsProposal,
} from "@t3tools/client-runtime/zerops/model";

import { isTokenMember } from "@t3tools/client-runtime/zerops/mateAccess";
import type { ProjectAccessChange } from "@t3tools/client-runtime/zerops/projectAccess";
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";

import type { ComposerSendOutcome } from "~/hooks/useComposerSendRequests";

import { recordsOf } from "../addresses/addresses.logic";
import { accessChanges } from "../projects/projectPeople.logic";

/** What the person decided of one proposal, and how what they approved ended. */
export type ProposalDecision =
  | { readonly state: "running"; readonly at: string }
  | { readonly state: "done"; readonly at: string }
  | { readonly state: "failed"; readonly at: string; readonly message: string }
  | { readonly state: "declined"; readonly at: string };

/** Each proposal's decision, by its id. */
export type ProposalDecisions = Readonly<Record<string, ProposalDecision>>;

/** How many decisions this tab holds: the newest, so the record never grows without end. */
export const PROPOSAL_DECISIONS_KEPT = 200;

/**
 * What a card shows: `open` offers Approve and Decline; `unseen` is one approved before a reload,
 * whose end this tab did not see.
 */
export type ProposalStage = "open" | "running" | "unseen" | "done" | "failed" | "declined";

export function proposalStage(
  decision: ProposalDecision | undefined,
  runningHere: boolean,
): ProposalStage {
  if (decision === undefined) return "open";
  if (decision.state === "running" && !runningHere) return "unseen";
  return decision.state;
}

/** Whether `next` may follow `before`: one decision per proposal, then how an approval ended. */
function follows(before: ProposalDecision | undefined, next: ProposalDecision): boolean {
  if (before === undefined) return next.state === "running" || next.state === "declined";
  return before.state === "running" && (next.state === "done" || next.state === "failed");
}

/**
 * The decisions with `next` recorded for `id`, where it may follow what is recorded: a proposal is
 * approved or declined once, and an approval ends once. Only the newest
 * {@link PROPOSAL_DECISIONS_KEPT} are kept.
 */
export function recordDecision(
  decisions: ProposalDecisions,
  id: string,
  next: ProposalDecision,
): ProposalDecisions {
  if (!follows(decisions[id], next)) return decisions;
  const entries = Object.entries({ ...decisions, [id]: next });
  if (entries.length <= PROPOSAL_DECISIONS_KEPT) return Object.fromEntries(entries);
  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, PROPOSAL_DECISIONS_KEPT),
  );
}

/** What a failed approval says where HQ holds no words of it. */
const FAILED_WORDS = "Zerops did not do it.";

/** A decision as HQ holds it, in the card's terms: an approval with no end yet is running. */
export function decisionFromHq(record: HqProposalDecision): ProposalDecision {
  if (record.decision === "declined") return { state: "declined", at: record.at };
  switch (record.outcome) {
    case null:
      return { state: "running", at: record.at };
    case "done":
      return { state: "done", at: record.at };
    case "failed":
      return { state: "failed", at: record.at, message: record.words ?? FAILED_WORDS };
  }
}

/** The write HQ is sent for a decision, under the project of the conversation its card is in. */
export function hqWriteOf(decision: ProposalDecision, projectId: string): HqProposalDecisionWrite {
  switch (decision.state) {
    case "running":
      return { projectId, decision: "approved" };
    case "done":
      return { projectId, decision: "approved", outcome: "done" };
    case "failed":
      return { projectId, decision: "approved", outcome: "failed", words: decision.message };
    case "declined":
      return { projectId, decision: "declined" };
  }
}

const REACH: Readonly<Record<ProposalDecision["state"], number>> = {
  running: 1,
  done: 2,
  failed: 2,
  declined: 2,
};

/**
 * What a card holds once HQ answered `answered`: whichever has got further — an answer read
 * before this tab's own write landed takes nothing back, and an end another tab saw is shown.
 */
export function furtherDecision(
  before: ProposalDecision | undefined,
  answered: ProposalDecision,
): ProposalDecision {
  if (before === undefined) return answered;
  return REACH[answered.state] > REACH[before.state] ? answered : before;
}

/** The message another Mate is sent: the words, then the attachment titled and quoted whole. */
export function proposalMessage(
  params: ZeropsMessageProposalParams | ZeropsChiefMessageParams,
): string {
  const { attachment } = params;
  if (attachment === undefined) return params.words;
  const text = attachment.text.replace(/\s+$/u, "");
  return `${params.words}\n\n${attachment.title}:\n\`\`\`\n${text}\n\`\`\``;
}

/**
 * The vault write an approved value is, read off the vault as it stands: a key held there is
 * updated in place, any other added. Refused where the vault is not read yet, or where the value
 * has nowhere to go.
 */
export function envProposalWrite(
  view: VaultView,
  proposal: Extract<ZeropsProposal, { kind: "env.set" }>,
): { readonly scope: VaultScopeRef; readonly write: VaultWrite } | { readonly refused: string } {
  if (view.status === "unread") return { refused: "Reading the vault…" };
  const { params } = proposal;
  const id = params.scope === "project" ? "shared" : proposal.serviceId;
  const scope = view.scopes.find((each) => each.id === id);
  if (scope === undefined) {
    return {
      refused:
        view.status === "failed"
          ? "The vault could not be read."
          : "That service is not in the project's vault.",
    };
  }
  if (!scope.editable) {
    return {
      refused: `Zerops sets ${scope.hostname ?? "its"}'s values; they cannot be written here.`,
    };
  }
  const held = scope.values.find((each) => each.key === params.key);
  return {
    scope: scope.ref,
    write:
      held === undefined
        ? { kind: "add", key: params.key, value: params.value, sensitive: params.secret }
        : {
            kind: "update",
            id: held.id,
            key: params.key,
            value: params.value,
            sensitive: params.secret,
          },
  };
}

const SERVICE_VERBS = {
  "service.restart": ["Restarting", "Restarted"],
  "service.start": ["Starting", "Started"],
  "service.stop": ["Stopping", "Stopped"],
} as const;

/**
 * What the person's Chief is sent when a project's Mate asks it: who asks and from where, then the
 * words and what they hand along.
 */
export function chiefAsk(
  params: ZeropsChiefMessageParams,
  from: { readonly mateName: string; readonly projectName: string },
): string {
  return `From ${from.mateName} in ${from.projectName}:\n\n${proposalMessage(params)}`;
}

/** Where an ask goes: the source Mate's person's Chief, none, or not known yet. */
export function chiefMessageTarget(
  own: string | null | undefined,
):
  | { readonly kind: "chief"; readonly projectId: string }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" } {
  if (own === undefined) return { kind: "unknown" };
  return own === null ? { kind: "none" } : { kind: "chief", projectId: own };
}

/**
 * What an approved message says where its Mate's agent took no turn — it waits for a sign-in, say:
 * why, and where the words wait to be sent.
 */
export function heldMessageWords(recipient: string, why: string): string {
  return `${why} Your message waits in ${recipient}'s composer.`;
}

/**
 * What an approved message to a Mate says once its composer answered: nothing beyond "Sent" when
 * it went out; otherwise why not, and where its words are.
 */
export function handOverWords(recipient: string, outcome: ComposerSendOutcome): string | null {
  switch (outcome.kind) {
    case "sent":
      return null;
    case "waits":
      return heldMessageWords(recipient, outcome.why);
    case "taken-over":
      return `You sent or changed the message yourself in ${recipient}'s composer.`;
  }
}

/** What a card says of a decided proposal; a failed one says the platform's own words instead. */
export function proposalOutcomeWords(
  proposal: ZeropsProposal,
  stage: Exclude<ProposalStage, "open" | "failed">,
): string {
  if (stage === "declined") return "Declined. Nothing ran.";
  if (stage === "unseen")
    return "Approved before the page reloaded. How it ended was not seen here.";
  const running = stage === "running";
  switch (proposal.kind) {
    case "service.restart":
    case "service.start":
    case "service.stop": {
      const [going, gone] = SERVICE_VERBS[proposal.kind];
      const service = proposal.serviceName ?? "the service";
      return running ? `${going} ${service}…` : `${gone} ${service}.`;
    }
    case "env.set":
      return running
        ? `Writing ${proposal.params.key} to the vault…`
        : `${proposal.params.key} is in the vault.`;
    case "mate.message":
      return running
        ? `Sending to ${proposal.params.to.mateName}…`
        : `Sent to ${proposal.params.to.mateName}.`;
    case "chief.message":
      return running ? "Sending to your Chief…" : "Sent to your Chief.";
    case "domain.add": {
      const names = domainNames(proposal.params.domains);
      return running ? `Adding ${names}…` : `Added ${names}.`;
    }
    case "access.set": {
      const place = proposal.projectName ?? "the project";
      return running ? `Changing access to ${place}…` : `Access to ${place} changed.`;
    }
  }
}

type DomainProposal = Extract<ZeropsProposal, { kind: "domain.add" }>;

/** The domains in a sentence, a name before its www.: "a.com and www.a.com", "a, b and c". */
function domainNames(domains: ReadonlyArray<string>): string {
  const ordered = domains.toSorted(
    (left, right) => Number(left === `www.${right}`) - Number(right === `www.${left}`),
  );
  if (ordered.length <= 1) return ordered.join("");
  return `${ordered.slice(0, -1).join(", ")} and ${ordered.at(-1)}`;
}

/** The card's title: a domain's names the project it puts on them; any other its summary. */
export function proposalTitle(proposal: ZeropsProposal): string {
  if (proposal.kind !== "domain.add") return proposal.summary;
  return `Put ${proposal.projectName ?? "the project"} on ${domainNames(proposal.params.domains)}`;
}

/** How far each face is from answering: the furthest behind speaks for the proposal's domains. */
const FACE_ORDER: ReadonlyArray<DomainFace> = [
  "removing",
  "going-live",
  "changing",
  "dns",
  "elsewhere",
  "certificate-failed",
  "certificate",
  "live",
];

/** An approved domain's state in words, and whether it waits on the person, works or answers. */
export interface DomainProposalState {
  readonly tone: "working" | "waiting" | "problem" | "live";
  readonly words: string;
}

/**
 * The records an approved domain still needs at the person's DNS provider: those of its domains
 * waiting for DNS or pointing elsewhere, as the addresses sheet lists them. Nothing once each
 * answers, or while the project's IP addresses are unread.
 */
export function domainProposalRecords(
  place: PlaceAddresses,
  proposal: DomainProposal,
): ReturnType<typeof recordsOf> | undefined {
  if (place.state !== "ready") return undefined;
  const waiting = place.domains.filter(
    (each) =>
      proposal.params.domains.includes(each.domainName) &&
      (each.face === "dns" || each.face === "elsewhere"),
  );
  if (waiting.length === 0) return undefined;
  const records = recordsOf(waiting, place.ips);
  return records.records.length === 0 ? undefined : records;
}

/**
 * How far an approved domain is from answering, as the project's addresses show it: the one of its
 * domains furthest behind speaks for them. Undefined while the addresses are read, or where the
 * project holds none of them.
 */
export function domainProposalState(
  place: PlaceAddresses,
  proposal: DomainProposal,
): DomainProposalState | undefined {
  if (place.state !== "ready") return undefined;
  const held = place.domains
    .filter((each) => proposal.params.domains.includes(each.domainName))
    .toSorted((left, right) => FACE_ORDER.indexOf(left.face) - FACE_ORDER.indexOf(right.face));
  const behind = held[0];
  if (behind === undefined) return undefined;
  const name = behind.domainName;
  switch (behind.face) {
    case "removing":
      return { tone: "waiting", words: `${name} is being removed.` };
    case "going-live":
    case "changing":
      return { tone: "working", words: `Putting ${name} in place…` };
    case "dns":
      return {
        tone: "waiting",
        words: `Waiting for your DNS. Add ${name}'s records at your DNS provider.`,
      };
    case "elsewhere":
      return {
        tone: "problem",
        words: `${name} points elsewhere. Change its records at your DNS provider.`,
      };
    case "certificate":
      return { tone: "working", words: `Your DNS is right. ${name}'s certificate is on its way…` };
    case "certificate-failed":
      return {
        tone: "problem",
        words: `${name}'s certificate could not be installed.${behind.sslError === undefined ? "" : ` ${behind.sslError}`}`,
      };
    case "live": {
      const names = held.map((each) => each.domainName);
      return {
        tone: "live",
        words: `${domainNames(names)} ${names.length > 1 ? "are" : "is"} live.`,
      };
    }
  }
}

/**
 * What approving a domain puts in place besides it: putting the project's domains in place puts
 * every waiting change there too, anybody's. Undefined where none waits.
 */
export function domainProposalAlso(place: PlaceAddresses): string | undefined {
  if (place.waitingDomains.length === 0) return undefined;
  return `Approving also puts in place: ${place.waitingDomains.map((each) => each.label).join(", ")}.`;
}

/** Where a proposal acts, in the vault's and the menu's words; a message's Mate is drawn instead. */
export function proposalWhere(proposal: ZeropsProposal): string | null {
  const project = proposal.projectName;
  const within = (words: string) => (project === undefined ? words : `${words} · ${project}`);
  switch (proposal.kind) {
    case "service.restart":
    case "service.start":
    case "service.stop":
      return within(proposal.serviceName ?? "A service");
    case "env.set":
      return proposal.params.scope === "project"
        ? `Every app${project === undefined ? "" : ` in ${project}`}`
        : within(`${proposal.serviceName ?? "The service"}'s own`);
    case "domain.add":
      return `→ ${proposal.serviceName ?? "its service"} · port ${proposal.params.port}`;
    case "access.set":
      // An application's places are one place to the person: never its projects one by one.
      return proposal.params.projects.length > 1
        ? `All of ${project ?? "the application"}: its environments and Mates`
        : (proposal.params.projects[0]?.name ?? project ?? null);
    case "mate.message":
    case "chief.message":
      return null;
  }
}

/**
 * The Mate a message goes to, among the Mates the menu knows: the one of that name in its project,
 * else the project's only Mate; nobody where neither says which.
 */
export function proposalRecipient<
  T extends { readonly projectId?: string | undefined; readonly name: string },
>(identities: Iterable<T | null>, to: ZeropsMessageProposalParams["to"]): T | undefined {
  const here = [...identities].filter(
    (identity): identity is T => identity !== null && identity.projectId === to.projectId,
  );
  const wanted = to.mateName.trim().toLowerCase();
  return (
    here.find((identity) => identity.name.trim().toLowerCase() === wanted) ??
    (here.length === 1 ? here[0] : undefined)
  );
}

type AccessProposal = Extract<ZeropsProposal, { kind: "access.set" }>;

/** An organization member as the access card finds people among them. */
export interface AccessMember {
  /** The membership (`clientUser`) id each grant is written on. */
  readonly id: string;
  readonly userId?: string | undefined;
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
  readonly user?:
    | {
        readonly id?: string | undefined;
        readonly fullName?: string | undefined;
        readonly firstName?: string | undefined;
        readonly email?: string | undefined;
      }
    | undefined;
}

/** What approving an access proposal writes, or why Approve waits. */
export type AccessProposalPlan =
  | {
      readonly kind: "ready";
      readonly changes: ReadonlyArray<ProjectAccessChange>;
      /** The projects it names that are never written, each saying why. */
      readonly dropped: ReadonlyArray<string>;
      /** What it gives, one line per person and project, with what changes from today. */
      readonly lines: ReadonlyArray<string>;
    }
  | { readonly kind: "held"; readonly words: string };

const folded = (text: string | undefined) => text?.trim().replace(/\s+/gu, " ").toLowerCase();

/**
 * The members a name means — people only, never HQ's or anyone's token: an address is one
 * member's; a name is the members of that full name, else of that first name.
 */
function membersNamed(
  members: ReadonlyArray<AccessMember>,
  person: string,
): ReadonlyArray<AccessMember> {
  const list = members.filter((member) => !isTokenMember(member));
  const wanted = folded(person);
  if (person.includes("@")) return list.filter((one) => folded(one.user?.email) === wanted);
  const full = list.filter((one) => folded(one.user?.fullName) === wanted);
  return full.length > 0 ? full : list.filter((one) => folded(one.user?.firstName) === wanted);
}

/** A level as an access change's card says it. */
const LEVEL_SAYS: Readonly<Record<ZeropsAccessLevel, string>> = {
  full: "Full",
  read: "Read",
  none: "Hidden",
  remove: "Their role's access",
};

/** Each person the Mate named at their level on each project, as it asked: while it is read. */
export function accessAskLines(proposal: AccessProposal): ReadonlyArray<string> {
  return proposal.params.people.flatMap(({ person, level }) =>
    proposal.params.projects.map(({ name }) => `${person} · ${LEVEL_SAYS[level]} on ${name}`),
  );
}

/** How much a role reaches on a project: hidden, reads, works, everything. */
const reach = (role: string | undefined) =>
  roleAtLeast(role, "ADMIN")
    ? 3
    : roleAtLeast(role, "BASIC_USER")
      ? 2
      : roleAtLeast(role, "READ_ONLY")
        ? 1
        : 0;

const LEVEL_REACH: Readonly<Record<Exclude<ZeropsAccessLevel, "remove">, number>> = {
  full: 3,
  read: 1,
  none: 0,
};

/** What a level changes from what the person reaches there today. */
function changeWord(today: number, after: number): string {
  if (today === after) return "unchanged";
  if (today === 0) return "new";
  if (after === 0) return "removed";
  return after > today ? "raised" : "lowered";
}

/** A Guest — no role of their own, creating nothing — only ever reads. */
const isGuest = (member: AccessMember) =>
  asOrgRole(member.roleCode) === "NO_ACCESS" && member.canCreateProjects !== true;

/**
 * An access proposal against the organization: each person the Chief named found by their address
 * or name among its people, and their level written on every project the proposal names that the
 * organization holds — never the Headquarters project, never a Mate they own (as an application's
 * People write it), and a Guest at Read at most. Approve waits while the members, the projects or
 * whose each Mate is are read, and for a name that finds nobody or several.
 */
export function accessProposalPlan(input: {
  readonly proposal: AccessProposal;
  readonly members: { readonly known: boolean; readonly list: ReadonlyArray<AccessMember> };
  /**
   * Whose each project's Mate is, as HQ names its owner: projectId → their user id, `null` for
   * nobody's; `undefined` while HQ has not said.
   */
  readonly owners: Readonly<Record<string, string | null | undefined>>;
  /** The organization's projects, id → name; `undefined` while they are read. */
  readonly projects: ReadonlyMap<string, string> | undefined;
  /** Each project's own grants as far as read: what each person reaches there today. */
  readonly grants: Readonly<Record<string, ProjectGrantsRead | undefined>>;
}): AccessProposalPlan {
  if (!input.members.known) return { kind: "held", words: "Reading your organization's members…" };
  const inventory = input.projects;
  if (inventory === undefined)
    return { kind: "held", words: "Reading your organization's projects…" };
  const dropped: Array<string> = [];
  const projectIds = input.proposal.params.projects.flatMap(({ id, name }) => {
    if (!inventory.has(id)) {
      dropped.push(`${name}: not a project in your organization`);
      return [];
    }
    return [id];
  });
  if (projectIds.length === 0)
    return { kind: "held", words: "None of these projects can be given from here." };
  if (projectIds.some((id) => input.owners[id] === undefined))
    return { kind: "held", words: "Reading who owns these Mates…" };
  const changes: Array<ProjectAccessChange> = [];
  const lines: Array<string> = [];
  for (const { person, level } of input.proposal.params.people) {
    const found = membersNamed(input.members.list, person);
    if (found.length === 0)
      return {
        kind: "held",
        words: `No one in your organization is ${person}. Invite them from Team, then ask again.`,
      };
    if (found.length > 1)
      return {
        kind: "held",
        words: `Several people here are ${person}. Ask again with their email address.`,
      };
    const member = found[0]!;
    const userId = member.user?.id ?? member.userId;
    const owned = projectIds.filter((id) => userId !== undefined && input.owners[id] === userId);
    const capped = level === "full" && isGuest(member);
    const given = capped ? "read" : level;
    changes.push(...accessChanges({ clientUserId: member.id, projectIds, owned, choice: given }));
    const who = member.user?.fullName?.trim() || person;
    for (const projectId of projectIds) {
      const project = inventory.get(projectId) ?? projectId;
      if (owned.includes(projectId)) {
        lines.push(`${who} · ${project} stays as it is: their own Mate`);
        continue;
      }
      const read = input.grants[projectId];
      const today =
        read?.status === "ready"
          ? reach(
              read.grants?.find((grant) => grant.clientUserId === member.id)?.roleCode ??
                member.roleCode,
            )
          : undefined;
      const after = given === "remove" ? reach(member.roleCode) : LEVEL_REACH[given];
      lines.push(
        [
          `${who} · ${LEVEL_SAYS[given]} on ${project}`,
          ...(today === undefined ? [] : [changeWord(today, after)]),
          ...(capped ? ["a guest only reads"] : []),
        ].join(" · "),
      );
    }
  }
  return { kind: "ready", changes, dropped, lines };
}
