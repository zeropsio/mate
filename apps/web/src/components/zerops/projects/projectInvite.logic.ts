/**
 * Inviting someone to a project, step by step: their address, checked with Zerops; their name
 * where the address has no Zerops account yet (Zerops makes one with the invitation); then how
 * much they may do. Pure: Zerops's answers arrive as values.
 */
import type { Invitee } from "@t3tools/client-runtime/data";
import type { AppAccessLevel } from "@t3tools/client-runtime/zerops/appAccess";

export type InviteStep =
  | { readonly step: "address" }
  | { readonly step: "name"; readonly email: string }
  | { readonly step: "access"; readonly email: string; readonly invitee: Invitee };

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

/** Where the invitation goes once Zerops said who the address is. */
export function inviteStepAfterCheck(
  email: string,
  answer: { readonly kind: "existing"; readonly userId: string } | { readonly kind: "new" },
): InviteStep {
  return answer.kind === "existing"
    ? { step: "access", email, invitee: { kind: "existing", userId: answer.userId } }
    : { step: "name", email };
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
