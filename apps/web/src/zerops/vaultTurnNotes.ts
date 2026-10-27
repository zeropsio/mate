/**
 * What a Mate hears of its vault with the next message, and the chips its composer shows for it.
 *
 * The person's own writes from this client are kept here until a message carries them; changes
 * made elsewhere come from the vault itself, since the agent last spoke. A chip set aside, or a
 * change already sent, is not told again in that conversation. Memory only: keys are the
 * platform's facts and are never kept in browser storage.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  vaultAtom,
  vaultChangesSince,
  vaultNote,
  type VaultChange,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import { sameValue } from "../lib/sameValue";
import { useDetailDemand } from "./ZeropsAccountData";
import { useZeropsEnvironmentProject } from "./useZeropsEnvironmentProject";
import {
  heldWrites,
  vaultChangeIdOf,
  vaultTurnChanges,
  vaultValueIdOf,
} from "./vaultTurnNotes.logic";

interface VaultTurnState {
  /** This client's writes not yet told, by project. */
  readonly own: Readonly<Record<string, ReadonlyArray<VaultChange>>>;
  /** The changes set aside or sent, by conversation (`vaultChangeIdOf`). */
  readonly hidden: Readonly<Record<string, ReadonlyArray<string>>>;
}

const useVaultTurnStore = create<VaultTurnState>()(() => ({ own: {}, hidden: {} }));

const NO_CHANGES: ReadonlyArray<VaultChange> = [];
const NO_IDS: ReadonlyArray<string> = [];

/** A write the person made to a project's vault from here: told with the next message. */
export function recordVaultWrite(projectId: string, change: VaultChange): void {
  useVaultTurnStore.setState((state) => ({
    own: { ...state.own, [projectId]: heldWrites(state.own[projectId] ?? NO_CHANGES, change) },
  }));
}

/** A write the platform refused: nothing to tell. */
export function forgetVaultWrite(projectId: string, change: VaultChange): void {
  useVaultTurnStore.setState((state) => ({
    own: {
      ...state.own,
      [projectId]: (state.own[projectId] ?? NO_CHANGES).filter(
        (held) => vaultChangeIdOf(held) !== vaultChangeIdOf(change),
      ),
    },
  }));
}

/** Changes no longer to tell in a conversation: sent with a message, or set aside. */
function hide(threadKey: string, projectId: string, changes: ReadonlyArray<VaultChange>): void {
  const values = new Set(changes.map(vaultValueIdOf));
  useVaultTurnStore.setState((state) => ({
    own: {
      ...state.own,
      [projectId]: (state.own[projectId] ?? NO_CHANGES).filter(
        (held) => !values.has(vaultValueIdOf(held)),
      ),
    },
    hidden: {
      ...state.hidden,
      [threadKey]: [...(state.hidden[threadKey] ?? NO_IDS), ...changes.map(vaultChangeIdOf)],
    },
  }));
}

export interface VaultTurnNotes {
  /** What the next message tells, oldest first: the composer's chips. */
  readonly changes: ReadonlyArray<VaultChange>;
  /** The note that rides with it, or `null` with nothing to tell. */
  readonly note: string | null;
  /** The person sets a chip aside: it is not told. */
  readonly dismiss: (change: VaultChange) => void;
  /** A message carried these: they are told. */
  readonly told: (changes: ReadonlyArray<VaultChange>) => void;
}

/**
 * The vault note for a Mate's conversation: holds the project's vault while it is drawn, so the
 * note knows what changed even with the Vault panel closed. `spokeAt` is when the agent last spoke
 * (`agentLastSpokeAt`); before it has, only the person's own writes are told.
 */
export function useVaultTurnNotes(
  environmentId: EnvironmentId | null,
  threadKey: string | null,
  spokeAt: string | undefined,
): VaultTurnNotes {
  const projectId = useZeropsEnvironmentProject(environmentId)?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const since = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          projectId === null || spokeAt === undefined
            ? NO_CHANGES
            : vaultChangesSince(get(vaultAtom(projectId)), spokeAt, []),
        ).pipe(Atom.withEquality(sameValue)),
      [projectId, spokeAt],
    ),
  );
  const own = useVaultTurnStore((state) =>
    projectId === null ? NO_CHANGES : (state.own[projectId] ?? NO_CHANGES),
  );
  const hidden = useVaultTurnStore((state) =>
    threadKey === null ? NO_IDS : (state.hidden[threadKey] ?? NO_IDS),
  );
  const changes = useMemo(
    () =>
      projectId === null || threadKey === null
        ? NO_CHANGES
        : vaultTurnChanges({
            own,
            since,
            hidden: new Set(hidden),
          }),
    [hidden, own, projectId, since, threadKey],
  );
  const note = useMemo(() => vaultNote(changes), [changes]);
  const dismiss = useCallback(
    (change: VaultChange) => {
      if (threadKey !== null && projectId !== null) hide(threadKey, projectId, [change]);
    },
    [projectId, threadKey],
  );
  const told = useCallback(
    (sent: ReadonlyArray<VaultChange>) => {
      if (threadKey !== null && projectId !== null && sent.length > 0)
        hide(threadKey, projectId, sent);
    },
    [projectId, threadKey],
  );
  return { changes, note, dismiss, told };
}
