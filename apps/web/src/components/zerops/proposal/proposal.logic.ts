/**
 * A Chief's proposal on its card: what the person decided of it, how an approved one is
 * carried out, and the words a message to another Mate is sent in. Nothing here acts; the card's
 * container carries out an approval with the person's own token.
 */
import type { VaultScopeRef, VaultView, VaultWrite } from "@t3tools/client-runtime/data";
import type {
  ZeropsMessageProposalParams,
  ZeropsProposal,
} from "@t3tools/client-runtime/zerops/model";
import * as Schema from "effect/Schema";

/** What the person decided of one proposal, and how what they approved ended. */
export type ProposalDecision =
  | { readonly state: "running"; readonly at: string }
  | { readonly state: "done"; readonly at: string }
  | { readonly state: "failed"; readonly at: string; readonly message: string }
  | { readonly state: "declined"; readonly at: string };

export const ProposalDecisionSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("running"), at: Schema.String }),
  Schema.Struct({ state: Schema.Literal("done"), at: Schema.String }),
  Schema.Struct({ state: Schema.Literal("failed"), at: Schema.String, message: Schema.String }),
  Schema.Struct({ state: Schema.Literal("declined"), at: Schema.String }),
]);

/** Each proposal's decision, by its id. */
export type ProposalDecisions = Readonly<Record<string, ProposalDecision>>;

export const ProposalDecisionsSchema = Schema.Record(Schema.String, ProposalDecisionSchema);

/** How many decisions the account keeps: the newest, so the record never grows without end. */
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

/** The message another Mate is sent: the words, then the attachment titled and quoted whole. */
export function proposalMessage(params: ZeropsMessageProposalParams): string {
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
