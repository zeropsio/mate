import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";
import { zeropsRefusedWords } from "../../zerops/hq/refusals.ts";

/**
 * How a stopped operation is said to people, by who stopped it (`origin`, `mate-hq
 * spec/protocol.md` "Operation failures"). Every surface that shows a failure says it through
 * these two functions; a program decides on `origin` and `code`, never on these words.
 */

/** A Zerops process the step followed failed: one sentence per HQ code of the spec's list. */
const PROCESS_FAILED = new Map<string, string>([
  ["project_create_failed", "Zerops could not create the project."],
  ["project_create_platform_error", "Zerops had an internal error creating the project."],
  ["project_delete_failed", "Zerops could not delete the project."],
  ["build_failed", "Zerops could not build the Mate's service."],
  ["restart_failed", "Zerops could not restart the Mate's service."],
]);

/** Zerops itself failed a process the step followed: nothing is wrong in the person's work. */
const ZEROPS_PLATFORM_ERROR = "zerops_platform_error";

const platformErrorWords = (step: string): string =>
  step === "import"
    ? "Zerops had an internal error while building the Mate's service. Nothing is wrong with your project."
    : "Zerops had an internal error. Nothing is wrong on your side.";

/** HQ can no longer follow the work for its maker, which says nothing of the work itself. */
const ACCESS_LOST = "access_lost";

const ACCESS_LOST_WORDS =
  "HQ can no longer act for its maker on this project. Zerops may still be finishing it.";

/** A write got no verdict: it may or may not have happened, and the press only reads. */
const OUTCOME_UNKNOWN = "outcome_unknown";

const OUTCOME_UNKNOWN_WORDS = "Zerops did not confirm whether this step went through.";

/** Zerops stopped answering a read: nothing is known to have failed, and Continue reads again. */
const ZEROPS_NOT_ANSWERING = "zerops_not_answering";

const ZEROPS_NOT_ANSWERING_WORDS = "Zerops has not been answering, so HQ stopped asking.";

/** Zerops failed the project's creation: no press can repeat it, so End is the one way out. */
const PROJECT_CREATE_PLATFORM_ERROR = "project_create_platform_error";

/** The word on the button of HQ's one Continue offer: what the press does for this reason. */
export type WaitingPress = "Continue" | "Try again" | "Check again";

/** What a press says while HQ takes it. */
export const PRESSING: Readonly<Record<WaitingPress, string>> = {
  Continue: "Continuing…",
  "Try again": "Trying again…",
  "Check again": "Checking…",
};

/** A waiting operation as its maker reads it: the press, a row's clause, the whole sentence. */
export interface WaitingWords {
  readonly press: WaitingPress;
  readonly why: string;
  readonly line: string;
  /** No Continue can change it: `line` is every reader's, and End is the way out. */
  readonly endOnly?: true;
}

/** The one list of waiting reasons: the work resumes, a failed step is sent again, or it reads. */
const WAITING = new Map<string, WaitingWords>([
  [
    "token_expired",
    {
      press: "Continue",
      why: "your Zerops sign-in ran out",
      line: "Your Zerops sign-in ran out before it finished. Continue gives HQ your current one.",
    },
  ],
  [
    ACCESS_LOST,
    {
      press: "Continue",
      why: "HQ can no longer act for you on this project",
      line: `${ACCESS_LOST_WORDS} Continue to check where it stands.`,
    },
  ],
  [
    ZEROPS_PLATFORM_ERROR,
    {
      press: "Try again",
      why: "Zerops had an internal error",
      line: `${platformErrorWords("")} Try again when you are ready.`,
    },
  ],
  [
    OUTCOME_UNKNOWN,
    {
      press: "Check again",
      why: "Zerops did not confirm it went through",
      line: `${OUTCOME_UNKNOWN_WORDS} Check again to find out; nothing is sent again. If it stays unconfirmed, you can give it up and start again; a request already at Zerops may still finish.`,
    },
  ],
  [
    ZEROPS_NOT_ANSWERING,
    {
      press: "Try again",
      why: "Zerops is not answering",
      line: `${ZEROPS_NOT_ANSWERING_WORDS} Nothing is known to have failed. Try again when you are ready.`,
    },
  ],
  [
    PROJECT_CREATE_PLATFORM_ERROR,
    {
      press: "Continue",
      why: "Zerops could not create the project",
      line: "Zerops had an internal error creating the project, and trying again cannot repair it. End it to free the application; the project stays and can be deleted.",
      endOnly: true,
    },
  ],
]);

const WAITING_UNKNOWN: WaitingWords = {
  press: "Continue",
  why: "it waits for you to continue it",
  line: "It stopped and waits for you to continue it.",
};

/** A waiting failure's words by its code; a reason this build does not know resumes. */
export const waitingWords = (code: string): WaitingWords => WAITING.get(code) ?? WAITING_UNKNOWN;

/** What a Zerops platform error's reader can do next, as HQ's state and offers say. */
export type PlatformErrorWay = "continue" | "maker-continues" | "ended";

const PLATFORM_ERROR_WAY: Record<PlatformErrorWay, string> = {
  continue: "Try again when you are ready.",
  "maker-continues": "Only its maker can try again, while they have access to the project.",
  ended: "This setup cannot be tried again.",
};

/** The whole line of a Zerops platform error for a reader with `way`; null for any other failure. */
export function platformErrorLine(
  failure: HqOperationFailure,
  way: PlatformErrorWay,
): string | null {
  if (failure.origin !== "zerops_process" || failure.code !== ZEROPS_PLATFORM_ERROR) return null;
  return `${platformErrorWords(failure.step)} ${PLATFORM_ERROR_WAY[way]}`;
}

/** The whole line of a birth waiting on lost access; null for any other failure. */
export function accessLostLine(failure: HqOperationFailure, continues: boolean): string | null {
  if (failure.origin !== "hq" || failure.code !== ACCESS_LOST) return null;
  return `${ACCESS_LOST_WORDS} ${
    continues
      ? "Continue to check where it stands."
      : "Its maker can continue it once their access is back."
  }`;
}

/** The whole line of an operation waiting on an unknown outcome; null for any other failure. */
export function outcomeUnknownLine(failure: HqOperationFailure, continues: boolean): string | null {
  if (failure.origin !== "hq" || failure.code !== OUTCOME_UNKNOWN) return null;
  return continues
    ? waitingWords(OUTCOME_UNKNOWN).line
    : `${OUTCOME_UNKNOWN_WORDS} It waits for its maker to check, which sends nothing again.`;
}

/** HQ's code for a check of an operation Zerops refused: it is not Zerops' own, so never shown. */
const OBSERVATION_REFUSED = "operation_observation_refused";

/** HQ stopped the step itself: one sentence per HQ code of the spec's closed list. */
const HQ_STOPPED = new Map<string, string>([
  ["token_expired", "Your Zerops sign-in ran out before it finished."],
  [ACCESS_LOST, ACCESS_LOST_WORDS],
  [OUTCOME_UNKNOWN, OUTCOME_UNKNOWN_WORDS],
  [ZEROPS_NOT_ANSWERING, ZEROPS_NOT_ANSWERING_WORDS],
  ["project_not_gone", "Zerops still lists the project after its deletion ended."],
  ["token_delete_refused", "Only an organization owner can delete this production's deploy token."],
  [
    "project_write_in_flight",
    "An earlier change to the project has not settled yet. Try again in a moment.",
  ],
  ["superseded", "Deleting a Mate on its project ended this setup."],
  [
    "ended",
    "It was ended while it waited. Anything it made stays and can be deleted, and a request already at Zerops may still finish.",
  ],
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
  if (failure.origin === "zerops" && failure.code === OBSERVATION_REFUSED)
    return "Zerops would not let HQ check how this went, so its result may still change.";
  if (failure.origin === "zerops")
    return zeropsRefusedWords(failure.code, failure.zerops?.words ?? null);
  if (failure.origin === "zerops_process" && failure.code === ZEROPS_PLATFORM_ERROR)
    return platformErrorWords(failure.step);
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
