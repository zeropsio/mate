/**
 * A reveal on its card: the person sees a hidden value the Mate cannot, read with their own access
 * through the vault's reveal, only on their screen and only for a moment. Where the value is found
 * in the vault, what the press says, who may reveal it, and the card's state — from HQ's decision
 * record (revealed to whom and when, Not now) and what happens on this screen now (revealing, a
 * confirmation in Zerops, shown). The value itself is in none of it.
 */
import type { ProjectGrantsRead, VaultScopeRef, VaultView } from "@t3tools/client-runtime/data";
import type { HqRevealRecord } from "@t3tools/client-runtime/zerops/hq";
import { isTokenMember } from "@t3tools/client-runtime/zerops/mateAccess";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";

import { type AskState, authorityWords, notNowWords } from "../../ask/ask.logic";
import type { AccessMember, ProposalDecision } from "./proposal.logic";

type RevealProposal = Extract<ZeropsProposal, { kind: "env.reveal" }>;
type Tier = "stage" | "production" | null;

/** Where the value is in the project's vault, or why it cannot be revealed from there. */
export type RevealTarget =
  | { readonly kind: "reading" }
  | { readonly kind: "missing"; readonly words: string }
  | {
      readonly kind: "found";
      readonly scope: VaultScopeRef;
      /** The platform's row id: what Zerops reveals. */
      readonly id: string;
      /** A value the vault holds plainly already; `null` for a hidden one, revealed by Zerops. */
      readonly plain: string | null;
    };

/**
 * The value a reveal names, in its project's vault: the project's own, or a service's — by its id,
 * or in this Mate by its hostname. Nothing while the vault is read.
 */
export function revealTarget(view: VaultView, proposal: RevealProposal): RevealTarget {
  const place = proposal.projectName ?? "This project";
  if (view.status === "unread") return { kind: "reading" };
  const { scope: kind, key } = proposal.params;
  const scope = view.scopes.find((each) =>
    kind === "project"
      ? each.id === "shared"
      : proposal.serviceId === undefined
        ? each.hostname === proposal.serviceName
        : each.id === proposal.serviceId,
  );
  if (scope === undefined) {
    return {
      kind: "missing",
      words:
        view.status === "failed"
          ? `${place}'s vault could not be read.`
          : `${place} has no service ${proposal.serviceName ?? ""}.`.replace(" .", "."),
    };
  }
  const held = scope.values.find((each) => each.key === key);
  if (held === undefined) {
    return { kind: "missing", words: `${scope.hostname ?? place} has no ${key}.` };
  }
  return {
    kind: "found",
    scope: scope.ref,
    id: held.id,
    plain: held.sensitive ? null : (held.value ?? ""),
  };
}

/** The main press, named for its result: production's carries its weight in its words. */
export function revealPress(tier: Tier): string {
  return tier === "production" ? "Reveal production value" : "Reveal";
}

/** Who may reveal it, as a rule: production's access, a stage's, or this Mate's. */
export function revealRule(proposal: RevealProposal, tier: Tier): string {
  if (tier === "production") return "Only people with production access can reveal this.";
  if (tier === "stage")
    return `Only people with access to ${proposal.projectName ?? "this stage"} can reveal this.`;
  return "Only people who can work in this Mate can reveal this.";
}

/**
 * The people who may reveal it, by name: the organization's people (never a token) who work in the
 * project — its own grant, else their role — besides the viewer. Nobody while its grants are read.
 */
export function revealersOf(
  members: ReadonlyArray<AccessMember>,
  grants: Pick<ProjectGrantsRead, "status" | "grants"> | undefined,
  viewer: string | undefined,
): ReadonlyArray<string> {
  if (grants?.status !== "ready") return [];
  return members.flatMap((member) => {
    const userId = member.user?.id ?? member.userId;
    if (isTokenMember(member) || userId === viewer) return [];
    const role =
      grants.grants?.find((grant) => grant.clientUserId === member.id)?.roleCode ?? member.roleCode;
    const name = member.user?.fullName?.trim() || member.user?.email;
    return roleAtLeast(role, "BASIC_USER") && name !== undefined ? [name] : [];
  });
}

/**
 * What happens on this screen: nothing, the reveal under way, a confirmation Zerops asks for in its
 * window, the value shown, or what refused it. Held in memory only, so a reload starts at nothing.
 */
export type RevealPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "revealing" }
  | { readonly kind: "confirming" }
  | { readonly kind: "shown" }
  | { readonly kind: "failed"; readonly words: string };

/** Whether the viewer may reveal it, or the rule and who may. */
export type RevealAuthority =
  | { readonly kind: "may" }
  | { readonly kind: "others"; readonly rule: string; readonly names: ReadonlyArray<string> };

/**
 * The card's state: what happens on this screen first, then HQ's record — revealed (to whom and
 * when, hidden again) or Not now — then whose it is to reveal.
 */
export function revealAskState(input: {
  readonly phase: RevealPhase;
  readonly decision: ProposalDecision | undefined;
  /** Who the record names, by name, and when, as the conversation's clock says it. */
  readonly by: string | null;
  readonly at: string | null;
  readonly authority: RevealAuthority;
}): AskState {
  const { phase, decision, by, at } = input;
  switch (phase.kind) {
    case "revealing":
      return { kind: "working", words: "Revealing…", pressed: "main" };
    case "confirming":
      return {
        kind: "working",
        words: "Confirm on your signed-in device to reveal.",
        pressed: null,
      };
    case "shown":
      return { kind: "done", words: "Only on your screen · recorded at HQ", told: null };
    case "failed":
      return { kind: "failed", words: phase.words };
    case "idle":
      break;
  }
  if (decision?.state === "declined") return { kind: "notNow", words: notNowWords(by, at) };
  if (decision !== undefined) {
    const whom = [by === null ? null : `to ${by}`, at === null ? null : `at ${at}`]
      .filter((part) => part !== null)
      .join(" ");
    return {
      kind: "done",
      words: `Revealed${whom === "" ? "" : ` ${whom}`} · hidden again`,
      told: null,
    };
  }
  if (input.authority.kind === "others") {
    return {
      kind: "othersToAnswer",
      words: authorityWords(input.authority.rule, input.authority.names),
    };
  }
  return { kind: "waiting" };
}

/** What HQ records of a reveal: where the value lives and its name, never the value. */
export function revealRecordOf(proposal: RevealProposal): HqRevealRecord {
  return {
    projectId: proposal.projectId,
    ...(proposal.params.scope === "service" && proposal.serviceName !== undefined
      ? { service: proposal.serviceName }
      : {}),
    key: proposal.params.key,
  };
}
