/**
 * D10 on the server: a new conversation's first turn runs on Extra High when
 * it names no effort (`@t3tools/shared/zeropsEffort`) — a phone task queued
 * before the catalog arrived, the stand-up — and the thread stores what its
 * first turn ran on. The server changes a thread's model only on its creation
 * and a meta update (a turn's selection is not stored), so without the store a
 * reload reads the selection the thread was created with.
 *
 * A conversation that ran keeps what it sends, a person's own pick wins, and a
 * crewmate's thread keeps the crew's rule.
 */
import type {
  ModelSelection,
  OrchestrationCommand,
  OrchestrationThreadShell,
  ServerProvider,
} from "@t3tools/contracts";
import { isUnstartedThread, selectionWithPreferredEffort } from "@t3tools/shared/zeropsEffort";

export type TurnStart = Extract<OrchestrationCommand, { type: "thread.turn.start" }>;

export type FirstTurnThread = Pick<
  OrchestrationThreadShell,
  "latestTurn" | "crew" | "modelSelection"
>;

export interface FirstTurnPlan {
  /** The turn as it goes out. */
  readonly turn: TurnStart;
  /** The selection the thread stores before the turn, when it holds another. */
  readonly store: ModelSelection | undefined;
}

const sameSelection = (a: ModelSelection, b: ModelSelection): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function planFirstTurnEffort(input: {
  readonly turn: TurnStart;
  /** The thread as it stands; absent when the turn creates it. */
  readonly thread: FirstTurnThread | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
}): FirstTurnPlan {
  const { turn, providers } = input;
  const created = turn.bootstrap?.createThread;
  if (created !== undefined) {
    const modelSelection = selectionWithPreferredEffort(providers, created.modelSelection);
    return {
      turn: {
        ...turn,
        ...(turn.modelSelection !== undefined
          ? { modelSelection: selectionWithPreferredEffort(providers, turn.modelSelection) }
          : {}),
        bootstrap: { ...turn.bootstrap, createThread: { ...created, modelSelection } },
      },
      store: undefined,
    };
  }
  const thread = input.thread;
  if (thread === undefined || !isUnstartedThread(thread)) return { turn, store: undefined };
  const modelSelection = selectionWithPreferredEffort(
    providers,
    turn.modelSelection ?? thread.modelSelection,
  );
  return {
    turn: { ...turn, modelSelection },
    store: sameSelection(modelSelection, thread.modelSelection) ? undefined : modelSelection,
  };
}
