/**
 * The one Stop every control of a Mate's conversation sends (`conversationStop.logic`): the press,
 * held in this tab for as long as its words are true, and the engine's Stop with no run named —
 * the engine stops whatever runs, its turn and the work it started.
 *
 * @module zerops/conversationStop
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { create } from "zustand";

import { threadEnvironment } from "~/state/threads";

import { useMateCommand } from "./accountEnvironments";
import { onAccountLifetimeClose } from "./accountLifetime";
import { stopRefusal, type StopPress } from "./conversationStop.logic";

interface StopPressState {
  readonly presses: Readonly<Record<string, StopPress>>;
  readonly press: (threadKey: string, press: StopPress) => void;
  readonly clear: (threadKey: string) => void;
}

export const useStopPressStore = create<StopPressState>((set) => ({
  presses: {},
  press: (threadKey, press) => {
    set((state) => ({ presses: { ...state.presses, [threadKey]: press } }));
  },
  clear: (threadKey) => {
    set((state) => {
      if (state.presses[threadKey] === undefined) return state;
      const { [threadKey]: _cleared, ...presses } = state.presses;
      return { presses };
    });
  },
}));

onAccountLifetimeClose(() => {
  useStopPressStore.setState({ presses: {} });
});

/** The Stop pressed in this tab on a conversation, by its scoped thread key. */
export function useStopPress(threadKey: string | null | undefined): StopPress | null {
  return useStopPressStore((state) =>
    threadKey == null ? null : (state.presses[threadKey] ?? null),
  );
}

export type StopAnswer =
  | { readonly kind: "taken" }
  | { readonly kind: "refused"; readonly reason: string }
  /** It never reached the Mate: nothing was asked, nothing is said. */
  | { readonly kind: "dropped" };

export interface StopTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The conversation's latest turn as the control drew it: its Stop's words belong to it. */
  readonly turnId: string | null;
}

/** Stops a conversation's turn and everything it started, from any control. */
export function useStopConversation(): (target: StopTarget) => Promise<StopAnswer> {
  const interrupt = useMateCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  return useCallback(
    async (target) => {
      const store = useStopPressStore.getState();
      const key = scopedThreadKey(scopeThreadRef(target.environmentId, target.threadId));
      store.press(key, { turnId: target.turnId, refused: null });
      const result = await interrupt({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag !== "Failure") return { kind: "taken" };
      if (isAtomCommandInterrupted(result)) {
        store.clear(key);
        return { kind: "dropped" };
      }
      const reason = stopRefusal(squashAtomCommandFailure(result));
      if (reason === null) return { kind: "taken" };
      store.press(key, { turnId: target.turnId, refused: reason });
      return { kind: "refused", reason };
    },
    [interrupt],
  );
}
