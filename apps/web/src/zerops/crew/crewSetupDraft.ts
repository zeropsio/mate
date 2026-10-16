/**
 * *Set up a crew*'s draft, kept for the signed-in account per Mate until the
 * crew starts or the person drops it: the goal as written, across a closed
 * tab, a closed page and a reload. Who is on the crew needs no keeping here —
 * each pick is written to the Mate's crew home as it is made.
 *
 * Storage can hold anything at all: what doesn't read as a draft is none.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";

import { readCrewSetupDraft, writeCrewSetupDraft } from "../draftStorage";

/** What the setup keeps of a Mate's draft: the goal as written. */
const CrewSetupDraft = Schema.Struct({ goal: Schema.String });
type CrewSetupDraft = typeof CrewSetupDraft.Type;

const decodeDraft = Schema.decodeUnknownOption(CrewSetupDraft);

/** A stored draft, or `null` for anything that isn't one. */
export function crewSetupDraftOf(stored: unknown): CrewSetupDraft | null {
  const draft = decodeDraft(stored);
  return draft._tag === "Some" ? draft.value : null;
}

const readDraft = (environmentId: EnvironmentId): CrewSetupDraft | null =>
  crewSetupDraftOf(readCrewSetupDraft(environmentId));

/** A setup draft is kept for this Mate: its Crew tab opens on the setup. */
export const hasCrewSetupDraft = (environmentId: EnvironmentId): boolean =>
  readDraft(environmentId) !== null;

export interface CrewSetupDraftState {
  /** The goal as written here; `null` while nothing was written in this draft. */
  readonly goal: string | null;
  readonly setGoal: (goal: string) => void;
  /** The crew started, or the person dropped the draft: nothing is kept any more. */
  readonly clear: () => void;
}

/** The Mate's setup draft for the signed-in account, kept as it changes; another Mate's is its own. */
export function useCrewSetupDraft(environmentId: EnvironmentId): CrewSetupDraftState {
  const [shown, setShown] = useState(() => ({
    environmentId,
    goal: readDraft(environmentId)?.goal ?? null,
  }));
  if (shown.environmentId !== environmentId) {
    setShown({ environmentId, goal: readDraft(environmentId)?.goal ?? null });
  }
  const setGoal = useCallback(
    (next: string) => {
      setShown({ environmentId, goal: next });
      writeCrewSetupDraft(environmentId, { goal: next });
    },
    [environmentId],
  );
  const clear = useCallback(() => {
    setShown({ environmentId, goal: null });
    writeCrewSetupDraft(environmentId, null);
  }, [environmentId]);
  return { goal: shown.environmentId === environmentId ? shown.goal : null, setGoal, clear };
}
