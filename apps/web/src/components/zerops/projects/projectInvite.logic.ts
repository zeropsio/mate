/**
 * Inviting someone to a project, step by step: their address, checked with Zerops; their name
 * where the address has no Zerops account yet (Zerops makes one with the invitation); then how
 * much they may do. Pure: Zerops's answers arrive as values.
 */
import type { Invitee, InviteeCheck } from "@t3tools/client-runtime/data";
import type { AppAccessLevel } from "@t3tools/client-runtime/zerops/appAccess";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";

/**
 * Whom the invitation reaches: an address invited to the organization, or someone already in it,
 * given access here — the way back for someone taken out of the project.
 */
export type InviteTarget =
  | Invitee
  | { readonly kind: "member"; readonly clientUserId: string; readonly userId?: string };

export type InviteStep =
  | { readonly step: "address" }
  | { readonly step: "name"; readonly email: string }
  | { readonly step: "access"; readonly email: string; readonly invitee: InviteTarget };

/** Something with one `@` and a dot after it; Zerops judges the rest. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function addressProblem(value: string): string | null {
  const address = value.trim();
  if (address === "") return "Enter their e-mail address.";
  return ADDRESS.test(address) ? null : "That isn't an e-mail address.";
}

export function nameProblem(first: string, last: string): string | null {
  return first.trim() === "" || last.trim() === "" ? "Enter their first and last name." : null;
}

export const ALREADY_HERE = "Already in this organization — change their access in the list.";

/**
 * Where the invitation goes once Zerops said who the address is — or what stops it: someone the
 * project's people already show, or an owner or admin, who reaches everything by their role.
 */
export function inviteStepAfterCheck(
  email: string,
  answer: InviteeCheck,
  /** Whether the project's people show this membership now. */
  shownHere: (clientUserId: string) => boolean,
): InviteStep | { readonly refused: string } {
  switch (answer.kind) {
    case "existing":
      return { step: "access", email, invitee: { kind: "existing", userId: answer.userId } };
    case "new":
      return { step: "name", email };
    case "member":
      if (roleAtLeast(answer.roleCode, "ADMIN"))
        return {
          refused: "Already an owner or admin of this organization: they reach everything.",
        };
      if (shownHere(answer.clientUserId)) return { refused: ALREADY_HERE };
      return {
        step: "access",
        email,
        invitee: {
          kind: "member",
          clientUserId: answer.clientUserId,
          ...(answer.userId === undefined ? {} : { userId: answer.userId }),
        },
      };
  }
}

/** The two levels, as the invitation offers them. */
export const INVITE_LEVELS: ReadonlyArray<{
  readonly level: AppAccessLevel;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    level: "work",
    label: "Can work on it",
    hint: "Full access wherever it runs. Sees its Mates and can add their own.",
  },
  { level: "look", label: "Can only look", hint: "Sees everything, changes nothing." },
];
