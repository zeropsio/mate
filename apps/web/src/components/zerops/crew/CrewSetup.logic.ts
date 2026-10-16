/**
 * *Set up a crew*'s presses, as what each waits for: *Let Fen suggest a
 * crew* and *Start the crew* both wait for the goal and say so, a press the
 * viewer may not make says why, and one that waits on the crew home being
 * written waits without words. Why no crew was proposed, in plain words; the
 * setup's draft as it was kept.
 *
 * Pure: no I/O.
 */
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import {
  CREW_SETUP_WORDS,
  crewProposalFailedWords,
  crewSuggestUnavailableWords,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import {
  CrewProposalError,
  EnvironmentAuthorizationError,
  type ExecutionEnvironmentCapabilities,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** A press as the setup offers it: whether it waits, and the words under it that say why. */
export interface CrewSetupPress {
  readonly disabled: boolean;
  readonly reason: string | null;
}

/** Where a proposal runs: the agent of the Mate's chat — or why it can't, for this viewer. */
export type CrewProposeWith =
  | { readonly kind: "ready"; readonly modelSelection: ModelSelection }
  /** The Mate's server is not read yet: whether it proposes at all is not known. */
  | { readonly kind: "reading" }
  | { readonly kind: "unavailable"; readonly words: string };

/**
 * A proposal runs on the agent the Mate's chat runs, and spends its login: only
 * where this viewer may run that chat (D6, the same lock as asking the Mate).
 */
export function crewProposeWith(input: {
  /** The Mate's server's capabilities; `undefined` while they are not read. */
  readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "crewProposals"> | undefined;
  /** The Mate's chat's model; `undefined` while it has none. */
  readonly modelSelection: ModelSelection | undefined;
  readonly lock: CrewLock | null;
  readonly mateName: string;
}): CrewProposeWith {
  if (input.capabilities === undefined) return { kind: "reading" };
  // A server from before proposals is never asked: it would not know the call.
  if (input.capabilities.crewProposals !== true)
    return { kind: "unavailable", words: crewSuggestUnavailableWords(input.mateName, "update") };
  if (input.modelSelection === undefined)
    return { kind: "unavailable", words: crewSuggestUnavailableWords(input.mateName, "no-chat") };
  if (input.lock !== null)
    return {
      kind: "unavailable",
      words: crewSuggestUnavailableWords(input.mateName, input.lock.ownership),
    };
  return { kind: "ready", modelSelection: input.modelSelection };
}

/** *Let Fen suggest a crew*: it needs the goal, and the Mate's agent this viewer may run. */
export function crewSuggestState(input: {
  readonly goal: string;
  /** The crew home is being written. */
  readonly busy: boolean;
  /** Why the Mate's agent may not propose for this viewer; `null` where it may. */
  readonly unavailable: string | null;
}): CrewSetupPress {
  if (input.goal.trim() === "") return { disabled: true, reason: CREW_SETUP_WORDS.goalFirst };
  if (input.unavailable !== null) return { disabled: true, reason: input.unavailable };
  return { disabled: input.busy, reason: null };
}

/** *Start the crew*: it needs someone on it and the goal, and a crew this viewer may start. */
export function crewStartState(input: {
  readonly goal: string;
  /** Someone is on the crew. */
  readonly drafted: boolean;
  /** Something else holds it: a write in flight, a crew standing, a home that doesn't read. */
  readonly blocked: boolean;
  /** Why this viewer may not start it (D6); `null` where they may. */
  readonly lock: string | null;
}): CrewSetupPress {
  if (!input.drafted) return { disabled: true, reason: CREW_SETUP_WORDS.pickFirst };
  if (input.goal.trim() === "") return { disabled: true, reason: CREW_SETUP_WORDS.goalFirst };
  if (input.lock !== null) return { disabled: true, reason: input.lock };
  return { disabled: input.blocked, reason: null };
}

const isCrewProposalError = Schema.is(CrewProposalError);
const isEnvironmentAuthorizationError = Schema.is(EnvironmentAuthorizationError);

/** Why no crew was proposed, in the row that asked. */
export function crewProposalFailure(cause: unknown, mateName: string): string {
  if (isCrewProposalError(cause))
    return crewProposalFailedWords(mateName, cause.reason, cause.detail);
  if (isEnvironmentAuthorizationError(cause)) return cause.message;
  return crewProposalFailedWords(mateName, "failed", null);
}
