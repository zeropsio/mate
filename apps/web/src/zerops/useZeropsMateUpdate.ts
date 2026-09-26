/**
 * The one verb next to the update line (spec-mate.md §2.9, MU-2): calls
 * `zerops.mate.update`, and from its acceptance the Mate's container shows
 * `updating` (DESIGN §4.5, C8) until a read fact proves it back — a connect
 * after the update began, or its descriptor on another version. The container
 * machine owns that wait and its budget; this hook only says where the verb
 * stands. A Mate no container of this account follows (its project is not in
 * the organization's inventory) is followed by its own `serverVersion`
 * instead, within the same budget.
 *
 * `idle → updating → updated/already-current → idle`, or `→ failed` from an
 * `exec:operate` refusal, the RPC's own `ZeropsMateUpdateResult.error`, or an
 * update past its budget. `already-current`/`updated` settle back to `idle`
 * on their own after a few seconds — nothing here is dismissable, nothing is
 * stored (MU-1).
 *
 * **The person is asked before the call, in the app's confirm dialog** —
 * never in a state of its own here. A confirmation drawn on the line lived
 * only where the line was drawn, and the Mate menus that offer *Update to
 * x.y.z* draw no line: the click armed a question nobody could see, and
 * nothing ever updated (the owner, 2026-09-26).
 *
 * **An update belongs to the Mate it was started on.** The verb's state lives
 * in a map keyed by environment rather than in the component, because the
 * surfaces that show it — the thread header, the Mate card — are single
 * components reused across Mates: held in React, one Mate's "Updating…" was
 * shown over every other Mate the person opened, and so was one Mate's update
 * check (`verified.md`, 2026-09-19).
 *
 * **A dropped socket is what an update looks like from here.** Updating
 * restarts the server, which closes the connection the answer would have come
 * back on, so a transport failure is not a failure of the update — it is the
 * update happening, and the container follows it the same way.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { CONTAINER_CAPS_MS, type TargetKey } from "@t3tools/client-runtime/zerops/environments";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";
import type { MateUpdateState } from "./mateUpdate";
import { intendContainer, useEnvironmentContainer } from "./zeropsContainers";

const SETTLE_DISPLAY_MS = 4_000;

export interface MateUpdate {
  readonly state: MateUpdateState;
  /** Updates this Mate to `to` now; the caller asked the person first. */
  readonly update: (to: string) => void;
  /**
   * The last `zerops.mate.checkUpdate` answer for this Mate (spec-mate.md
   * §2.9, "on demand" — MU-1 still holds: nothing here compares versions, it
   * only relays what the RPC answered). `undefined` until a check has run;
   * `null` when a check ran and found nothing to report.
   */
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  /**
   * Asks the server again, past its caches. Resolves with its answer, or to
   * nothing when the check failed or another action overtook it.
   */
  readonly check: () => Promise<ExecutionEnvironmentUpdate | null | undefined>;
}

interface MateUpdateEntry {
  readonly state: MateUpdateState;
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  /**
   * What an accepted update is followed by: the container carrying its
   * intent, or — when no container takes it — the version it started on;
   * null while none is followed. Kept beside the phase rather than inside it,
   * because the following outlives what the line says — a Mate that comes
   * back after its budget ran out has still updated, and says so.
   */
  readonly following:
    | { readonly kind: "container"; readonly key: TargetKey }
    | { readonly kind: "version"; readonly from: string }
    | null;
  /** Bumped by every action, so an answer from an abandoned one is dropped. */
  readonly generation: number;
}

const NOTHING: MateUpdateEntry = {
  state: { phase: "idle" },
  checked: undefined,
  following: null,
  generation: 0,
};

// Replaced, never mutated, so a surface listing several Mates reads a new
// snapshot on every change.
let entries: ReadonlyMap<EnvironmentId, MateUpdateEntry> = new Map();
let states: ReadonlyMap<EnvironmentId, MateUpdateState> = new Map();
const listeners = new Set<() => void>();
const timers = new Map<EnvironmentId, ReturnType<typeof setTimeout>>();

function entryFor(environmentId: EnvironmentId): MateUpdateEntry {
  return entries.get(environmentId) ?? NOTHING;
}

function write(environmentId: EnvironmentId, entry: MateUpdateEntry): void {
  entries = new Map(entries).set(environmentId, entry);
  states = new Map([...entries].map(([id, { state }]) => [id, state]));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NOT_BACK = "The server has not come back yet. Check the connection again.";

/** The one timer a Mate has at a time: the display settling back to idle, or a budget. */
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

/**
 * What to say about a call that failed, or `null` when the answer is only that
 * the connection went away — the container restarting, or a moment of network.
 * `SocketCloseError: 1006` is not a sentence anyone can act on, and it is not
 * what went wrong with the thing the person asked for.
 */
function describeFailure(cause: unknown, fallback: string): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (isTransportConnectionErrorMessage(message)) return null;
  return cause instanceof Error && message.trim().length > 0 ? message : fallback;
}

function settle(environmentId: EnvironmentId, generation: number, state: MateUpdateState): void {
  const entry = entryFor(environmentId);
  if (entry.generation !== generation) return;
  clearTimer(environmentId);
  write(environmentId, { ...entry, state, following: null });
  if (state.phase === "already-current" || state.phase === "updated") {
    settleToIdleAfter(environmentId, generation);
  }
}

export function useZeropsMateUpdate(
  environmentId: EnvironmentId,
  serverVersion: string | undefined,
): MateUpdate {
  const entry = useSyncExternalStore(subscribe, () => entryFor(environmentId));
  const container = useEnvironmentContainer(environmentId);
  const runUpdate = useAtomCommand(zeropsCommands.mateUpdate, {
    label: "zerops mate update",
    reportFailure: false,
  });
  const runCheckUpdate = useAtomCommand(zeropsCommands.mateCheckUpdate, {
    label: "zerops mate check update",
    reportFailure: false,
  });

  // The container machine decides when the update is over; any surface showing
  // this Mate reads its verdict, and none has to be left open for the update to
  // finish — an update the person walked away from is finished the moment they
  // look again.
  const verdict = container.verdict;
  const updating = verdict.level === "updating";
  const overdue = updating && verdict.overdue;
  useEffect(() => {
    const current = entryFor(environmentId);
    const following = current.following;
    if (following === null) return;
    if (following.kind === "container") {
      if (following.key !== container.key) return;
      if (updating) {
        if (overdue && current.state.phase === "updating") {
          write(environmentId, { ...current, state: { phase: "failed", message: NOT_BACK } });
        }
        return;
      }
    } else if (serverVersion === following.from) {
      return;
    }
    if (serverVersion === undefined) return;
    // A check held from before the update has been overtaken by it; the
    // descriptor's own field is the current answer again.
    write(environmentId, {
      ...current,
      checked: undefined,
      following: null,
      state: { phase: "updated", to: serverVersion },
    });
    settleToIdleAfter(environmentId, current.generation);
  }, [container.key, environmentId, overdue, serverVersion, updating]);

  const update = useCallback(
    (to: string) => {
      const current = entryFor(environmentId);
      const phase = current.state.phase;
      if (phase === "checking" || phase === "updating") return;
      const generation = current.generation + 1;
      clearTimer(environmentId);
      write(environmentId, {
        ...current,
        state: { phase: "updating", to },
        following: null,
        generation,
      });

      // The update was accepted, or the socket closed under it: its container
      // follows it from here, from the version it was started on.
      const follow = () => {
        const accepted = entryFor(environmentId);
        if (accepted.generation !== generation) return;
        const key = container.key;
        if (key !== null && intendContainer(key, { kind: "update", from: serverVersion ?? null })) {
          write(environmentId, { ...accepted, following: { kind: "container", key } });
          return;
        }
        if (serverVersion === undefined) {
          settle(environmentId, generation, {
            phase: "failed",
            message: "This Mate cannot be followed from here. Check the connection again.",
          });
          return;
        }
        write(environmentId, { ...accepted, following: { kind: "version", from: serverVersion } });
        schedule(environmentId, CONTAINER_CAPS_MS.updating, () => {
          const waited = entryFor(environmentId);
          if (waited.generation !== generation || waited.state.phase !== "updating") return;
          write(environmentId, { ...waited, state: { phase: "failed", message: NOT_BACK } });
        });
      };

      void (async () => {
        const result = await runUpdate({ environmentId, input: {} });
        if (entryFor(environmentId).generation !== generation) return;
        if (result._tag === "Failure") {
          const message = describeFailure(
            squashAtomCommandFailure(result),
            "The update could not be started.",
          );
          // The update restarts the server, so the connection closing is the
          // thing working, not failing.
          if (message === null) {
            follow();
            return;
          }
          settle(environmentId, generation, { phase: "failed", message });
          return;
        }
        const value = result.value;
        if (value.error) {
          settle(environmentId, generation, { phase: "failed", message: value.error });
          return;
        }
        // An update the RPC answers as already current creates no intent (§4.5).
        if (value.action === "none") {
          settle(environmentId, generation, { phase: "already-current" });
          return;
        }
        follow();
      })();
    },
    [container.key, environmentId, runUpdate, serverVersion],
  );

  const check = useCallback(async () => {
    const current = entryFor(environmentId);
    const phase = current.state.phase;
    if (phase !== "idle" && phase !== "failed" && phase !== "already-current") return undefined;
    const generation = current.generation + 1;
    clearTimer(environmentId);
    write(environmentId, { ...current, state: { phase: "checking" }, following: null, generation });

    const result = await runCheckUpdate({ environmentId, input: {} });
    const answered = entryFor(environmentId);
    if (answered.generation !== generation) return undefined;
    if (result._tag === "Failure") {
      const message = describeFailure(
        squashAtomCommandFailure(result),
        "The check could not be started.",
      );
      // Nothing was asked of the Mate that a closed connection could have
      // half-done, so unlike an update this says so and stops.
      settle(environmentId, generation, {
        phase: "failed",
        message: message ?? "This Mate is not reachable right now.",
      });
      return undefined;
    }
    write(environmentId, { ...answered, checked: result.value });
    settle(
      environmentId,
      generation,
      result.value?.available === true ? { phase: "idle" } : { phase: "already-current" },
    );
    return result.value;
  }, [environmentId, runCheckUpdate]);

  return { state: entry.state, update, checked: entry.checked, check };
}

/**
 * Every Mate's update state, for a surface that lists several — the projects
 * page, a project's page — where a hook per Mate cannot be called. A Mate
 * nothing was asked of is absent.
 */
export function useZeropsMateUpdateStates(): ReadonlyMap<EnvironmentId, MateUpdateState> {
  return useSyncExternalStore(subscribe, () => states);
}
