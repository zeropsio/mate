/**
 * The one verb next to the update line (spec-mate.md §2.9, MU-2): calls
 * `zerops.mate.update`, then waits for the Mate to come back on a new
 * version — the same proof `restartAndVerifyMate` waits for on the
 * pre-connection door, read here off the live `serverVersion` the caller
 * already holds (the descriptor subscription behind `useEnvironment`).
 *
 * `idle → confirm → updating → updated/already-current → idle`, or
 * `→ failed` from an `exec:operate` refusal or the RPC's own
 * `ZeropsMateUpdateResult.error`. `already-current`/`updated` settle back to
 * `idle` on their own after a few seconds — nothing here is dismissable,
 * nothing is stored (MU-1).
 *
 * **An update belongs to the Mate it was started on.** The state lives in a
 * map keyed by environment rather than in the component, because the surfaces
 * that show it — the thread header, the Mate card — are single components
 * reused across Mates: held in React, one Mate's "Updating…" was shown over
 * every other Mate the person opened, and so was one Mate's update check
 * (`verified.md`, 2026-09-19). Keyed this way an update also survives leaving
 * the conversation and coming back, which is the truth of it: the container
 * is restarting either way.
 *
 * **A dropped socket is what an update looks like from here.** Updating
 * restarts the server, which closes the connection the answer would have come
 * back on, so a transport failure is not a failure of the update — it is the
 * update happening. The wait for the new version is the same either way, and
 * only a Mate that never comes back is reported as one that did not.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

const SETTLE_DISPLAY_MS = 4_000;
const VERIFY_ATTEMPTS = 60;
const VERIFY_INTERVAL_MS = 2_000;

export type MateUpdateState =
  | { readonly phase: "idle" }
  | { readonly phase: "confirm" }
  | { readonly phase: "updating" }
  | { readonly phase: "checking" }
  | { readonly phase: "already-current" }
  | { readonly phase: "updated"; readonly to: string }
  | { readonly phase: "failed"; readonly message: string };

export interface MateUpdate {
  readonly state: MateUpdateState;
  readonly request: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
  /**
   * The last `zerops.mate.checkUpdate` answer for this Mate (spec-mate.md
   * §2.9, "on demand" — MU-1 still holds: nothing here compares versions, it
   * only relays what the RPC answered). `undefined` until a check has run;
   * `null` when a check ran and found nothing to report.
   */
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  readonly check: () => void;
}

interface MateUpdateEntry {
  readonly state: MateUpdateState;
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  /**
   * What an update in flight is waiting for: the version the Mate was on, and
   * the one the RPC promised if it answered before the restart closed the
   * socket. Kept beside the phase rather than inside it, because the waiting
   * outlives what the line says — a Mate that comes back after the window ran
   * out has still updated, and says so.
   */
  readonly waiting: { readonly from: string | undefined; readonly to: string | undefined } | null;
  /** Bumped by every action, so an answer from an abandoned one is dropped. */
  readonly generation: number;
}

const NOTHING: MateUpdateEntry = {
  state: { phase: "idle" },
  checked: undefined,
  waiting: null,
  generation: 0,
};

const entries = new Map<EnvironmentId, MateUpdateEntry>();
const listeners = new Set<() => void>();
const timers = new Map<EnvironmentId, ReturnType<typeof setTimeout>>();

function entryFor(environmentId: EnvironmentId): MateUpdateEntry {
  return entries.get(environmentId) ?? NOTHING;
}

function write(environmentId: EnvironmentId, entry: MateUpdateEntry): void {
  entries.set(environmentId, entry);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The one timer a Mate has at a time: the display settling back to idle, or
 * the window an update has to bring the server back.
 */
function schedule(environmentId: EnvironmentId, ms: number, run: () => void): void {
  clearTimer(environmentId);
  timers.set(
    environmentId,
    setTimeout(() => {
      timers.delete(environmentId);
      run();
    }, ms),
  );
}

function clearTimer(environmentId: EnvironmentId): void {
  const timer = timers.get(environmentId);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(environmentId);
}

function settleToIdleAfter(environmentId: EnvironmentId, generation: number): void {
  schedule(environmentId, SETTLE_DISPLAY_MS, () => {
    const entry = entryFor(environmentId);
    if (entry.generation !== generation) return;
    write(environmentId, { ...entry, state: { phase: "idle" } });
  });
}

function settle(
  environmentId: EnvironmentId,
  generation: number,
  state: MateUpdateState,
  options: { readonly keepWaiting?: boolean } = {},
): void {
  const entry = entryFor(environmentId);
  if (entry.generation !== generation) return;
  clearTimer(environmentId);
  write(environmentId, {
    ...entry,
    state,
    waiting: options.keepWaiting === true ? entry.waiting : null,
  });
  if (state.phase === "already-current" || state.phase === "updated") {
    settleToIdleAfter(environmentId, generation);
  }
}

export function useZeropsMateUpdate(
  environmentId: EnvironmentId,
  serverVersion: string | undefined,
  options: { readonly verifyAttempts?: number; readonly verifyIntervalMs?: number } = {},
): MateUpdate {
  const entry = useSyncExternalStore(subscribe, () => entryFor(environmentId));
  const runUpdate = useAtomCommand(zeropsCommands.mateUpdate, {
    label: "zerops mate update",
    reportFailure: false,
  });
  const runCheckUpdate = useAtomCommand(zeropsCommands.mateCheckUpdate, {
    label: "zerops mate check update",
    reportFailure: false,
  });
  const waitMs =
    (options.verifyAttempts ?? VERIFY_ATTEMPTS) * (options.verifyIntervalMs ?? VERIFY_INTERVAL_MS);

  // The proof, wherever it is seen from: a Mate that is updating has come
  // back once its descriptor reports a version it did not have before. Any
  // surface showing this Mate can close it, and none has to be left open for
  // the update to finish — an update the person walked away from is finished
  // the moment they look again.
  useEffect(() => {
    const current = entryFor(environmentId);
    const waiting = current.waiting;
    if (waiting === null || serverVersion === undefined) return;
    const landed =
      waiting.to !== undefined
        ? serverVersion === waiting.to
        : waiting.from !== undefined && serverVersion !== waiting.from;
    if (!landed) return;
    clearTimer(environmentId);
    // A check held from before the update has been overtaken by it; the
    // descriptor's own field is the current answer again.
    write(environmentId, {
      ...current,
      checked: undefined,
      waiting: null,
      state: { phase: "updated", to: serverVersion },
    });
    settleToIdleAfter(environmentId, current.generation);
  }, [environmentId, serverVersion]);

  const request = useCallback(() => {
    const current = entryFor(environmentId);
    const phase = current.state.phase;
    if (
      phase !== "idle" &&
      phase !== "failed" &&
      phase !== "already-current" &&
      phase !== "updated"
    ) {
      return;
    }
    clearTimer(environmentId);
    write(environmentId, {
      ...current,
      state: { phase: "confirm" },
      waiting: null,
      generation: current.generation + 1,
    });
  }, [environmentId]);

  const cancel = useCallback(() => {
    const current = entryFor(environmentId);
    if (current.state.phase !== "confirm") return;
    write(environmentId, {
      ...current,
      state: { phase: "idle" },
      waiting: null,
      generation: current.generation + 1,
    });
  }, [environmentId]);

  const confirm = useCallback(() => {
    const current = entryFor(environmentId);
    if (current.state.phase !== "confirm") return;
    const generation = current.generation + 1;
    write(environmentId, {
      ...current,
      state: { phase: "updating" },
      waiting: { from: serverVersion, to: undefined },
      generation,
    });
    // However this goes, a Mate that never comes back is eventually said to
    // have not come back.
    schedule(environmentId, waitMs, () => {
      settle(
        environmentId,
        generation,
        {
          phase: "failed",
          message: "The server has not come back yet. Check the connection again.",
        },
        // Still waiting: a Mate that comes back late has updated all the same.
        { keepWaiting: true },
      );
    });

    void (async () => {
      const result = await runUpdate({ environmentId, input: {} });
      if (entryFor(environmentId).generation !== generation) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        const message = cause instanceof Error ? cause.message : String(cause);
        // The update restarts the server, so the connection closing is the
        // thing working, not failing: keep waiting for the version.
        if (isTransportConnectionErrorMessage(message)) return;
        settle(environmentId, generation, {
          phase: "failed",
          message: cause instanceof Error ? message : "The update could not be started.",
        });
        return;
      }
      const value = result.value;
      if (value.error) {
        settle(environmentId, generation, { phase: "failed", message: value.error });
        return;
      }
      if (value.action === "none") {
        settle(environmentId, generation, { phase: "already-current" });
        return;
      }
      // The version the RPC promised sharpens the wait that is already
      // running; the deadline it was given stands.
      const waiting = entryFor(environmentId);
      if (waiting.waiting === null) return;
      write(environmentId, {
        ...waiting,
        waiting: { from: waiting.waiting.from, to: value.to },
      });
    })();
  }, [environmentId, runUpdate, serverVersion, waitMs]);

  const check = useCallback(() => {
    const current = entryFor(environmentId);
    const phase = current.state.phase;
    if (phase !== "idle" && phase !== "failed" && phase !== "already-current") return;
    const generation = current.generation + 1;
    clearTimer(environmentId);
    write(environmentId, { ...current, state: { phase: "checking" }, waiting: null, generation });

    void (async () => {
      const result = await runCheckUpdate({ environmentId, input: {} });
      const answered = entryFor(environmentId);
      if (answered.generation !== generation) return;
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        settle(environmentId, generation, {
          phase: "failed",
          message: cause instanceof Error ? cause.message : "The check could not be started.",
        });
        return;
      }
      write(environmentId, { ...answered, checked: result.value });
      settle(
        environmentId,
        generation,
        result.value?.available === true ? { phase: "idle" } : { phase: "already-current" },
      );
    })();
  }, [environmentId, runCheckUpdate]);

  return { state: entry.state, request, confirm, cancel, checked: entry.checked, check };
}
