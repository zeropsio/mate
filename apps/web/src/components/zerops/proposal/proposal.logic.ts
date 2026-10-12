/**
 * A proposal on its card: what the person decided of it, as HQ keeps it (`hq/chief.ts`), how an
 * approved one is carried out, and the words a message to another Mate — or to the person's own
 * Chief — is sent in. Nothing here acts; the card's container carries out an approval as the
 * person.
 */
import type { VaultScopeRef, VaultView, VaultWrite } from "@t3tools/client-runtime/data";
import type {
  HqProposalDecision,
  HqProposalDecisionWrite,
} from "@t3tools/client-runtime/zerops/hq";
import type {
  ZeropsChiefMessageParams,
  ZeropsMessageProposalParams,
  ZeropsProposal,
} from "@t3tools/client-runtime/zerops/model";

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

/** Where an ask of the Chief goes: the viewer's own Chief, none to set up, or not known yet. */
export function chiefMessageTarget(
  own: string | null | undefined,
):
  | { readonly kind: "chief"; readonly projectId: string }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" } {
  if (own === undefined) return { kind: "unknown" };
  return own === null ? { kind: "none" } : { kind: "chief", projectId: own };
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
  }
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
