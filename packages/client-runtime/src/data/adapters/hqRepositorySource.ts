import * as Result from "effect/Result";
/** Explicit repository demand, supervised by the common retry/refusal policy. */
import * as Queue from "effect/Queue";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import {
  repositorySourceId,
  repositorySourceScope,
  type RepositorySourceKey,
} from "../families/hqRepositorySource.ts";
import type { AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import type { LinkKey } from "../model.ts";
import type { StreamFault } from "../streamMachine.ts";

export function repositoryFailure(cause: unknown): StreamFault {
  const message = cause instanceof Error ? cause.message : "HQ could not read this repository.";
  if (cause instanceof HqError) {
    if (cause.code === "forbidden" || cause.code === "session_required")
      return { outcome: "authoritative-denial", message, code: cause.code };
    if (cause.kind === "refused")
      return { outcome: "definitive-refusal", message, code: cause.code };
  }
  return { outcome: "transient", message };
}

export function makeRepositorySourceReads(
  store: AccountStore,
  api: Pick<HqApi, "repositorySource">,
) {
  let closed = false;
  const active = new Map<
    string,
    {
      count: number;
      wake?: () => void;
      supervisor?: LinkSupervisor;
      fiber: Fiber.Fiber<never>;
      again: boolean;
    }
  >();
  const demand = (identity: RepositorySourceKey) => {
    if (closed) return () => {};
    const id = repositorySourceId(identity);
    let entry = active.get(id);
    if (entry !== undefined) entry.count++;
    else {
      const scope = repositorySourceScope(identity);
      const key: LinkKey = `hq:repository-${encodeURIComponent(id)}`;
      const prior = store.state().facts.get(`hqRepositorySource:${id}`)?.revision;
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
        again:
          identity.target.query.rev === undefined || streamOf(store.state(), scope).fault !== null,
      } as { count: number; again: boolean; wake?: () => void; supervisor?: LinkSupervisor };
      const fiber = Effect.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* Queue.unbounded<void>();
            const supervisor = yield* superviseLink({
              store,
              key,
              scopes: [scope],
              repairSession: Effect.fail({
                outcome: "definitive-refusal",
                message: "Sign in to HQ again.",
              } satisfies StreamFault),
              attempt: () =>
                Effect.gen(function* () {
                  yield* Queue.clear(changes);
                  yield* signal(key, { kind: "handshake" });
                  while (true) {
                    yield* signal(scope, { kind: "attempt" });
                    yield* signal(scope, { kind: "handshake" });
                    const generation = streamOf(store.state(), scope).generation;
                    const held = store.state().facts.get(`hqRepositorySource:${id}`);
                    // Immutable reads survive remount; an explicit Again requests a new owner answer.
                    if (held?.content.kind !== "value" || made.again) {
                      const answer = yield* Effect.result(
                        Effect.tryPromise({
                          try: (signal) =>
                            api.repositorySource(
                              identity.target.appId,
                              identity.target.repo,
                              identity.target.query,
                              signal,
                            ),
                          catch: repositoryFailure,
                        }),
                      );
                      if (closed || active.get(id) !== made) return yield* Effect.never;
                      if (streamOf(store.state(), scope).generation !== generation) {
                        yield* Queue.take(changes);
                        continue;
                      }
                      if (Result.isFailure(answer)) {
                        if (answer.failure.outcome === "authoritative-denial") {
                          store.dispatch({
                            kind: "access",
                            family: "hqRepositorySource",
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
                        via: "hq-stream",
                        partial: value.truncated || value.branchesTruncated,
                        members: [id],
                        rows: [
                          {
                            family: "hqRepositorySource",
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
            return yield* supervisor.run;
          }),
        ),
      );
      entry = Object.assign(made, { fiber });
      active.set(id, entry);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = active.get(id);
      if (held === undefined || --held.count > 0) return;
      active.delete(id);
      if (held.supervisor) Effect.runSync(held.supervisor.release);
      Effect.runFork(Fiber.interrupt(held.fiber));
    };
  };
  return {
    demand,
    again: (key: RepositorySourceKey) => {
      const entry = active.get(repositorySourceId(key));
      if (entry === undefined || closed) return;
      entry.again = true;
      entry.wake?.();
    },
    close: () => {
      closed = true;
      for (const entry of active.values()) {
        if (entry.supervisor) Effect.runSync(entry.supervisor.release);
        Effect.runFork(Fiber.interrupt(entry.fiber));
      }
      active.clear();
    },
  };
}
