/**
 * What the person decided of each proposal of the organization's Mate, kept under the signed-in
 * account by proposal id: a reload draws each card as it was left, and none offers Approve twice.
 * An own-action record: what this browser itself did, never a source's answer.
 *
 * Which approvals this tab carries out now is memory only: an approval a reload interrupted is not
 * running here, and its card says its end was not seen.
 */
import { useCallback, useSyncExternalStore } from "react";

import {
  ProposalDecisionsSchema,
  recordDecision,
  type ProposalDecision,
  type ProposalDecisions,
} from "../components/zerops/proposal/proposal.logic";
import { useLocalStorage } from "../hooks/useLocalStorage";

const PROPOSAL_DECISIONS_KEY = "mate:zerops:proposal-decisions";

const NONE: ProposalDecisions = {};

const runningHere = new Set<string>();
const listeners = new Set<() => void>();
let runningVersion = 0;

function setRunningHere(id: string, running: boolean): void {
  if (running) runningHere.add(id);
  else runningHere.delete(id);
  runningVersion += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const readVersion = () => runningVersion;

export interface ProposalDecisionHandle {
  readonly decision: ProposalDecision | undefined;
  /** This tab carries out its approval now. */
  readonly runningHere: boolean;
  /** Records `next` where it may follow what is recorded (`recordDecision`). */
  readonly record: (next: ProposalDecision) => void;
}

export function useProposalDecision(id: string): ProposalDecisionHandle {
  const [decisions, setDecisions] = useLocalStorage(
    PROPOSAL_DECISIONS_KEY,
    NONE,
    ProposalDecisionsSchema,
  );
  useSyncExternalStore(subscribe, readVersion, readVersion);
  const record = useCallback(
    (next: ProposalDecision) => {
      setDecisions((current) => {
        const after = recordDecision(current, id, next);
        if (after !== current) setRunningHere(id, next.state === "running");
        return after;
      });
    },
    [id, setDecisions],
  );
  return { decision: decisions[id], runningHere: runningHere.has(id), record };
}
