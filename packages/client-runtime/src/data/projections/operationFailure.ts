import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";

/**
 * How a stopped operation is said to people, by who stopped it (`origin`, `mate-hq
 * spec/protocol.md` "Operation failures"). Every surface that shows a failure says it through
 * these two functions; a program decides on `origin` and `code`, never on these words.
 */

/** A Zerops process the step followed failed: one sentence per HQ code of the spec's list. */
const PROCESS_FAILED = new Map<string, string>([
  ["project_create_failed", "Zerops could not create the project."],
  ["project_delete_failed", "Zerops could not delete the project."],
  ["build_failed", "Zerops could not build the Mate's service."],
  ["restart_failed", "Zerops could not restart the Mate's service."],
]);

/** HQ stopped the step itself: one sentence per HQ code of the spec's closed list. */
const HQ_STOPPED = new Map<string, string>([
  ["token_expired", "Your Zerops sign-in ran out before it finished."],
  ["project_not_gone", "Zerops still lists the project after its deletion ended."],
  ["token_delete_refused", "Only an organization owner can delete this production's deploy token."],
  [
    "project_write_in_flight",
    "An earlier change to the project has not settled yet. Try again in a moment.",
  ],
  ["superseded", "Deleting a Mate on its project ended this setup."],
  [
    "project_ambiguous",
    "Several Zerops projects carry this Mate's tag, so HQ cannot tell which one is its own.",
  ],
  ["several_containers", "The project holds several Mate services."],
  ["another_persons_chief", "The project is registered as another person's Chief."],
  ["chief_already_registered", "You already have a Chief."],
  [
    "invitation_moved",
    "Their invitation changed in Zerops after this started, so nothing was sent again.",
  ],
  ["not_invited", "They are no longer waiting on an invitation: they joined, or it was withdrawn."],
  [
    "names_required",
    "Zerops has no account for this address any more and needs their first and last name. Invite them again.",
  ],
  ["not_member", "They are no longer in the organization."],
]);

/**
 * The failure in words, one form per origin: Zerops' refusal with Zerops' own sentence as sent (its
 * code where it gave none), a failed Zerops process and HQ's own stop each as their sentence, and a
 * code or origin this build does not know as the code.
 */
export function operationFailureWords(failure: HqOperationFailure): string {
  if (failure.origin === "zerops")
    return `Zerops refused: ${failure.zerops?.words ?? failure.code}`;
  if (failure.origin === "zerops_process")
    return PROCESS_FAILED.get(failure.code) ?? `Zerops could not finish it: ${failure.code}`;
  return (
    (failure.origin === "hq" ? HQ_STOPPED.get(failure.code) : undefined) ??
    `HQ stopped it: ${failure.code}`
  );
}

/**
 * Zerops' whole answer, for people to read or hand to support: the failure exactly as HQ sent it,
 * for a refusal by Zerops, and null for a stop Zerops never answered.
 */
export function operationFailureDetails(failure: HqOperationFailure): string | null {
  return failure.origin === "zerops" ? JSON.stringify(failure, null, 2) : null;
}
