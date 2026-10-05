/**
 * The one verb next to the update line (spec-mate.md §2.9, MU-2): calls
 * `zerops.mate.update`, and from its acceptance the Mate's container shows
 * `updating` (DESIGN §4.5, C8) until a read fact proves it back — a connect
 * after the update began, or its descriptor on another version. The container
 * machine owns that wait and its budget; this hook only says where the verb
 * stands. A Mate no container of this account follows (its project is not in
 * the organization's inventory) is followed by its socket alone, within the
 * same budget.
 *
 * **What the update came to is the server it comes back as**, by its
 * descriptor's version and boot (`bootId`): another version, it updated; the
 * version it left on another boot, the server restarted without it — the
 * update did not take, and Update is offered again; the boot it was pressed in,
 * the server has not restarted yet — a socket that only blinked, or a
 * container back sooner than its socket — and it is still updating. A server
 * that names no boot cannot say it restarted, so the version it left is no
 * answer there.
 *
 * `idle → updating → updated/already-current → idle`, or `→ failed` from an
 * `exec:operate` refusal, the RPC's own `ZeropsMateUpdateResult.error`, or a
 * server back on the version it left. An
 * update past its budget is still updating, taking longer than usual: its
 * outcome is the server it comes back as, never a clock, and Update stays off
 * meanwhile. `already-current`/`updated` settle back to `idle` on their own
 * after a few seconds — nothing here is dismissable, nothing is stored (MU-1).
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

import type {
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentUpdate,
} from "@t3tools/contracts";

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

/** The Mate's server as its descriptor names it: its version and its boot; null while none stands. */
export type MateServer = Pick<ExecutionEnvironmentDescriptor, "serverVersion" | "bootId">;

interface MateUpdateEntry {
  readonly state: MateUpdateState;
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  /**
   * What an accepted update is followed by: the container carrying its
   * intent, or the socket alone when no container takes it — with the
   * server's version and boot when the update was pressed; null
   * while none is followed. Kept beside the phase rather than inside it,
   * because the following outlives what the line says — a Mate that comes
   * back after its budget ran out has still updated, and says so.
   */
  readonly following: {
    readonly container: TargetKey | null;
    readonly from: string;
    readonly bootId: string | undefined;
  } | null;
  /** Bumped by every action, so an answer from an abandoned one is dropped. */
  readonly generation: number;
  /**
   * The Mate's container, once an update has started: while it restarts into
   * the update its socket is down, and a list knows it by its container only.
   */
  readonly containerKey: TargetKey | null;
}

const NOTHING: MateUpdateEntry = {
  state: { phase: "idle" },
  checked: undefined,
  following: null,
  generation: 0,
  containerKey: null,
};

/** Every Mate's update state, for a surface that lists several. */
export interface MateUpdateStates {
  /**
   * The state of the Mate at `environmentId` — or, while its socket is down,
   * restarting into an update, at its container `key`; absent where nothing
   * was asked of it.
   */
  readonly of: (mate: {
    readonly environmentId?: EnvironmentId | undefined;
    readonly key: string;
  }) => MateUpdateState | undefined;
}

function statesOf(all: ReadonlyMap<EnvironmentId, MateUpdateEntry>): MateUpdateStates {
  const byEnvironment = new Map<EnvironmentId, MateUpdateState>();
  const byContainer = new Map<string, MateUpdateState>();
  for (const [environmentId, entry] of all) {
    byEnvironment.set(environmentId, entry.state);
    if (entry.containerKey !== null) byContainer.set(entry.containerKey, entry.state);
  }
  return {
    of: ({ environmentId, key }) =>
      (environmentId === undefined ? undefined : byEnvironment.get(environmentId)) ??
      byContainer.get(key),
  };
}

// Replaced, never mutated, so a surface listing several Mates reads a new
// snapshot on every change.
let entries: ReadonlyMap<EnvironmentId, MateUpdateEntry> = new Map();
let states: MateUpdateStates = statesOf(entries);
const listeners = new Set<() => void>();
const timers = new Map<EnvironmentId, ReturnType<typeof setTimeout>>();

function entryFor(environmentId: EnvironmentId): MateUpdateEntry {
  return entries.get(environmentId) ?? NOTHING;
}

function write(environmentId: EnvironmentId, entry: MateUpdateEntry): void {
  entries = new Map(entries).set(environmentId, entry);
  states = statesOf(entries);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The one timer a Mate has at a time: the display settling back to idle, or a budget's label. */
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

/**
 * What the server says of an update pressed while it ran `from` in boot `bootId`: updated on
 * another version, not taken on another boot of the same one, and nothing while it is the same
 * boot — or a boot it does not name.
 */
function cameBackAs(
  pressed: { readonly from: string; readonly bootId: string | undefined },
  serverVersion: string | undefined,
  bootId: string | undefined,
): MateUpdateState | null {
  if (serverVersion === undefined) return null;
  if (serverVersion !== pressed.from) return { phase: "updated", to: serverVersion };
  if (bootId === undefined || bootId === pressed.bootId) return null;
  return {
    phase: "failed",
    message: `The update did not take: this Mate is still on ${pressed.from}.`,
  };
}

export function useZeropsMateUpdate(
  environmentId: EnvironmentId,
  server: MateServer | null,
): MateUpdate {
  const serverVersion = server?.serverVersion;
  const bootId = server?.bootId;
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
  const containerVersion = container.serverVersion;
  useEffect(() => {
    const current = entryFor(environmentId);
    const following = current.following;
    if (following === null) return;
    const followed = following.container !== null && following.container === container.key;
    // The server's own descriptor answers it, whatever the container says; with no answer there
    // yet, a container back on another version does.
    let state = cameBackAs(following, serverVersion, bootId);
    if (state === null && followed) {
      if (updating) {
        if (overdue && current.state.phase === "updating" && current.state.overdue !== true) {
          write(environmentId, { ...current, state: { ...current.state, overdue: true } });
        }
        return;
      }
      if (containerVersion !== undefined && containerVersion !== following.from) {
        state = { phase: "updated", to: containerVersion };
      }
    }
    if (state === null) return;
    clearTimer(environmentId);
    // A check held from before the update has been overtaken by it; the
    // descriptor's own field is the current answer again.
    write(environmentId, { ...current, checked: undefined, following: null, state });
    if (state.phase === "updated") settleToIdleAfter(environmentId, current.generation);
  }, [bootId, container.key, containerVersion, environmentId, overdue, serverVersion, updating]);

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
        containerKey: container.key ?? current.containerKey,
      });

      // The update was accepted, or the socket closed under it: its container
      // follows it from here, or its socket alone — from the server's version and
      // boot when it was pressed, so a server restarted before the answer still counts.
      const follow = () => {
        const accepted = entryFor(environmentId);
        if (accepted.generation !== generation) return;
        if (serverVersion === undefined) {
          settle(environmentId, generation, {
            phase: "failed",
            message: "This Mate cannot be followed from here. Check the connection again.",
          });
          return;
        }
        const key = container.key;
        const pressedUnder = { from: serverVersion, bootId };
        if (key !== null && intendContainer(key, { kind: "update", from: serverVersion })) {
          write(environmentId, { ...accepted, following: { container: key, ...pressedUnder } });
          return;
        }
        write(environmentId, { ...accepted, following: { container: null, ...pressedUnder } });
        schedule(environmentId, CONTAINER_CAPS_MS.updating, () => {
          const waited = entryFor(environmentId);
          if (waited.generation !== generation || waited.state.phase !== "updating") return;
          write(environmentId, { ...waited, state: { ...waited.state, overdue: true } });
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
    [bootId, container.key, environmentId, runUpdate, serverVersion],
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
 * page, a project's page — where a hook per Mate cannot be called.
 */
export function useZeropsMateUpdateStates(): MateUpdateStates {
  return useSyncExternalStore(subscribe, () => states);
}
