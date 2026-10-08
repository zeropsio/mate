/**
 * A WorkspaceHistory that captures nothing and remembers what it was asked, in order: the
 * engine's tests read when a run's workspace was captured, bound and released.
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkspaceHistory, type CaptureGap } from "../../../checkpointing/WorkspaceHistory.ts";

export interface FakeHistoryControls {
  /** The next capture waits on this before it returns. */
  gate: Deferred.Deferred<void> | undefined;
  /** The next capture breaks with these words. */
  breaks: string | undefined;
  /** The services the captures cannot snapshot, and why. */
  gaps: ReadonlyArray<CaptureGap>;
}

export const makeFakeWorkspaceHistory = () => {
  const calls: Array<string> = [];
  const controls: FakeHistoryControls = { gate: undefined, breaks: undefined, gaps: [] };
  const layer = Layer.succeed(
    WorkspaceHistory,
    WorkspaceHistory.of({
      prepare: (input) =>
        Effect.gen(function* () {
          calls.push(`prepare ${input.runId}`);
          const gate = controls.gate;
          controls.gate = undefined;
          if (gate !== undefined) yield* Deferred.await(gate);
          const breaks = controls.breaks;
          controls.breaks = undefined;
          if (breaks !== undefined) return yield* Effect.die(new Error(breaks));
        }),
      gapsOf: () => Effect.sync(() => controls.gaps),
      bindTurn: (_thread, turn) => Effect.sync(() => void calls.push(`bind ${turn}`)),
      markDispatched: () => Effect.void,
      sentTo: (_thread, run, turn) => Effect.sync(() => void calls.push(`sent ${run} → ${turn}`)),
      finish: (input) =>
        Effect.sync(() => {
          calls.push(`finish ${input.turnId}`);
          return {
            runId: "",
            roots: [],
            semantics: "observed-workspace",
            representation: "git-normalized",
            policyVersion: "git-v1",
            coverage: "unknown",
          } as const;
        }),
      release: (_thread, _turn, run) => Effect.sync(() => void calls.push(`release ${run}`)),
      read: () => Effect.die("not faked"),
      cleanup: () => Effect.void,
    }),
  );
  return { calls, controls, layer };
};
