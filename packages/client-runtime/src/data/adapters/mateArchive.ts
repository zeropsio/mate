/** Connected-Mate archive demand shares account retention and the common refusal/retry policy. */
import type { EnvironmentId, OrchestrationShellSnapshot } from "@t3tools/contracts";
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Cause from "effect/Cause";
import * as Queue from "effect/Queue";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { request } from "../../rpc/client.ts";
import { archiveScope } from "../families/mateArchive.ts";
import type { AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import type { LinkKey } from "../model.ts";
import type { StreamFault } from "../streamMachine.ts";
import { workspaceFailure } from "./mateWorkspace.ts";

export interface ArchiveWire {
  readonly read: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<OrchestrationShellSnapshot, StreamFault>;
}
export const makeArchiveWire = (registry: EnvironmentRegistry["Service"]): ArchiveWire => ({
  read: (environmentId) =>
    registry
      .run(environmentId, request(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, {}))
      .pipe(Effect.catchCause((cause) => Effect.fail(workspaceFailure(Cause.squash(cause))))),
});

export function makeArchiveReads(store: AccountStore, wire: ArchiveWire) {
  let closed = false;
  const invalidated = new Set<EnvironmentId>();
  const active = new Map<
    string,
    {
      count: number;
      wake?: () => void;
      supervisor?: LinkSupervisor;
      fiber?: Fiber.Fiber<never>;
      again: boolean;
    }
  >();
  const demand = (identity: EnvironmentId) => {
    if (closed) return () => {};
    const id = identity;
    let entry = active.get(id);
    if (entry !== undefined) entry.count++;
    else {
      const scope = archiveScope(identity);
      const key: LinkKey = `mate:archive-${encodeURIComponent(id)}`;
      const prior = store.state().facts.get(`mateArchive:${id}`)?.revision;
      let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
      const signal = (
        target: LinkKey | typeof scope,
        event: import("../streamMachine.ts").StreamEvent,
      ) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      const made = {
        count: 1,
        again: streamOf(store.state(), scope).fault !== null,
      } as {
        count: number;
        again: boolean;
        wake?: () => void;
        supervisor?: LinkSupervisor;
        fiber?: Fiber.Fiber<never>;
      };
      entry = made;
      active.set(id, made);
      made.fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor = yield* superviseLink({
              store,
              key,
              scopes: [scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Reconnect to this Mate.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(key, { kind: "handshake" });
                  while (true) {
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    const held = store.state().facts.get(`mateArchive:${id}`);
                    // Remount retains the sampled answer; an archive action or explicit retry asks the owner again.
                    if (
                      held?.content.kind !== "value" ||
                      held.access !== "allowed" ||
                      made.again ||
                      invalidated.has(id)
                    ) {
                      invalidated.delete(id);
                      const answer = yield* Effect.result(wire.read(identity));
                      if (closed || active.get(id) !== made) return yield* Effect.never;
                      if (streamOf(store.state(), scope).generation !== generation) {
                        yield* Queue.take(changes);
                        continue;
                      }
                      if (Result.isFailure(answer)) {
                        if (answer.failure.outcome === "authoritative-denial") {
                          store.dispatch({
                            kind: "access",
                            family: "mateArchive",
                            id,
                            access: "denied",
                          });
                        }
                        return yield* Effect.fail(answer.failure);
                      }
                      const value = answer.success;
                      made.again = false;
                      store.dispatch({ kind: "baseline-begin", scope, generation });
                      store.dispatch({
                        kind: "baseline-commit",
                        scope,
                        generation,
                        via: "mate-direct",
                        members: [id],
                        rows: [
                          {
                            family: "mateArchive",
                            id,
                            value,
                            revision: { kind: "mate-link", sequence: ++sequence },
                          },
                        ],
                      });
                    }
                    yield* signal(scope, { kind: "baseline-committed" });
                    yield* signal(key, { kind: "baseline-committed" });
                    yield* Queue.take(changes);
                  }
                }),
            });
            made.supervisor = supervisor;
            made.wake = () => {
              const phase = streamOf(store.state(), key).phase;
              if (["refused", "recovering", "paused"].includes(phase))
                Effect.runFork(supervisor.signal("manual-retry"));
              else {
                Effect.runSync(signal(scope, { kind: "attempt" }));
                Queue.offerUnsafe(changes, undefined);
              }
            };
            if (invalidated.has(id)) yield* supervisor.signal("input-changed");
            return yield* supervisor.run;
          }),
        ),
      );
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = active.get(id);
      if (held === undefined || --held.count > 0) return;
      active.delete(id);
      if (held.supervisor) Effect.runSync(held.supervisor.release);
      if (held.fiber) Effect.runFork(Fiber.interrupt(held.fiber));
    };
  };
  return {
    demand,
    again: (key: EnvironmentId) => {
      if (closed) return;
      invalidated.add(key);
      const entry = active.get(key);
      if (entry === undefined) return;
      entry.again = true;
      entry.wake?.();
    },
    close: () => {
      closed = true;
      for (const entry of active.values()) {
        if (entry.supervisor) Effect.runSync(entry.supervisor.release);
        if (entry.fiber) Effect.runFork(Fiber.interrupt(entry.fiber));
      }
      active.clear();
    },
  };
}
