/** Bounded status wire ordering, published into the account rather than an environment query cache. */
import { WS_METHODS } from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { vcsId, vcsScope, type VcsKey } from "../projections/mateVcs.ts";
import type { AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { workspaceFailure } from "./mateWorkspace.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import type { StreamFault } from "../streamMachine.ts";
import type { LinkKey } from "../model.ts";

export const makeVcsWire = (registry: EnvironmentRegistry["Service"]) => (target: VcsKey) =>
  registry.followStream(
    target.environmentId,
    Stream.unwrap(
      Effect.map(EnvironmentSupervisor, (supervisor) =>
        SubscriptionRef.changes(supervisor.session).pipe(
          Stream.switchMap(
            Option.match({
              onNone: (): Stream.Stream<
                import("@t3tools/contracts").VcsStatusResult,
                StreamFault
              > =>
                Stream.fail({
                  outcome: "transient",
                  message: "The Mate is not connected.",
                } satisfies StreamFault),
              onSome: (session) =>
                session.client[WS_METHODS.subscribeVcsStatus](target.input).pipe(
                  Stream.mapAccum(
                    () => null as import("@t3tools/contracts").VcsStatusResult | null,
                    (current, event) => {
                      const value = applyGitStatusStreamEvent(current, event);
                      return [value, [value]] as const;
                    },
                  ),
                  Stream.catchCause((cause) => Stream.fail(workspaceFailure(Cause.squash(cause)))),
                ),
            }),
          ),
        ),
      ),
    ),
  );
export function makeVcsReads(store: AccountStore, wire: ReturnType<typeof makeVcsWire>) {
  let closed = false;
  const held = new Map<
    string,
    { count: number; fiber: Fiber.Fiber<never>; supervisor?: LinkSupervisor }
  >();
  return {
    demand: (target: VcsKey) => {
      if (closed) return () => {};
      const id = vcsId(target);
      const scope = vcsScope(target);
      const key: LinkKey = `mate:vcs-${encodeURIComponent(id)}`;
      let entry = held.get(id);
      if (entry) entry.count++;
      else {
        const made: { count: number; supervisor?: LinkSupervisor } = { count: 1 };
        const fiber = Effect.runFork(
          Effect.scoped(
            Effect.gen(function* () {
              const signal = (
                target: LinkKey | typeof scope,
                event: import("../streamMachine.ts").StreamEvent,
              ) =>
                Effect.map(Clock.currentTimeMillis, (now) =>
                  store.dispatch({ kind: "stream", key: target, now, event }),
                );
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
                    yield* signal(key, { kind: "handshake" });
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    yield* Stream.runForEach(wire(target), (value) =>
                      Effect.gen(function* () {
                        if (
                          closed ||
                          held.get(id) !== made ||
                          streamOf(store.state(), scope).generation !== generation
                        )
                          return;
                        const prior = store.state().facts.get(`mateVcs:${id}`)?.revision;
                        const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
                        store.dispatch({ kind: "baseline-begin", scope, generation });
                        store.dispatch({
                          kind: "baseline-commit",
                          scope,
                          generation,
                          via: "mate-direct",
                          members: [id],
                          rows: [
                            {
                              family: "mateVcs",
                              id,
                              value,
                              revision: { kind: "mate-link", sequence },
                            },
                          ],
                        });
                        yield* signal(scope, { kind: "baseline-committed" });
                        yield* signal(key, { kind: "baseline-committed" });
                      }),
                    ).pipe(
                      Effect.catchCause((cause) => {
                        const fault = workspaceFailure(Cause.squash(cause));
                        if (
                          !closed &&
                          held.get(id) === made &&
                          streamOf(store.state(), scope).generation === generation &&
                          fault.outcome === "authoritative-denial"
                        )
                          store.dispatch({
                            kind: "access",
                            family: "mateVcs",
                            id,
                            access: "denied",
                          });
                        return Effect.fail(fault);
                      }),
                    );
                    return yield* Effect.fail({
                      outcome: "transient",
                      message: "The Git status stream ended.",
                    } satisfies StreamFault);
                  }),
              });
              made.supervisor = supervisor;
              return yield* supervisor.run;
            }),
          ),
        );
        entry = Object.assign(made, { fiber });
        held.set(id, entry);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = held.get(id);
        if (!current || --current.count > 0) return;
        held.delete(id);
        if (current.supervisor) Effect.runSync(current.supervisor.release);
        Effect.runFork(Fiber.interrupt(current.fiber));
      };
    },
    close: () => {
      closed = true;
      for (const entry of held.values()) {
        if (entry.supervisor) Effect.runSync(entry.supervisor.release);
        Effect.runFork(Fiber.interrupt(entry.fiber));
      }
      held.clear();
    },
  };
}
