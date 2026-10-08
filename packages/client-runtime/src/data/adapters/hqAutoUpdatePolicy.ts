import * as Result from "effect/Result";
/** Read on settings demand and explicit retry; recovery uses the shared supervisor. */
import * as Queue from "effect/Queue";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";
import { autoUpdatePolicyScope } from "../families/hqAutoUpdatePolicy.ts";
import type { AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { superviseLink, type LinkSupervisor } from "../supervisor.ts";
import type { LinkKey } from "../model.ts";
import type { StreamFault } from "../streamMachine.ts";

export function policyFailure(cause: unknown): StreamFault {
  const message =
    cause instanceof Error ? cause.message : "HQ could not read the automatic-update policy.";
  if (cause instanceof HqError) {
    if (cause.code === "forbidden" || cause.code === "session_required")
      return { outcome: "authoritative-denial", message, code: cause.code };
    if (cause.kind === "refused")
      return { outcome: "definitive-refusal", message, code: cause.code };
  }
  return { outcome: "transient", message };
}

export function makeAutoUpdatePolicyReads(
  store: AccountStore,
  api: Pick<HqApi, "autoUpdatePolicy">,
) {
  let closed = false;
  const active = new Map<
    string,
    {
      count: number;
      wake?: () => void;
      supervisor?: LinkSupervisor;
      fiber: Fiber.Fiber<never>;
    }
  >();
  const demand = (orgId: string) => {
    if (closed) return () => {};
    const id = orgId;
    let entry = active.get(id);
    if (entry !== undefined) entry.count++;
    else {
      const scope = autoUpdatePolicyScope(orgId);
      const key: LinkKey = `hq:auto-update-${encodeURIComponent(id)}`;
      const signal = (
        target: LinkKey | typeof scope,
        event: import("../streamMachine.ts").StreamEvent,
      ) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      const made = {
        count: 1,
      } as { count: number; wake?: () => void; supervisor?: LinkSupervisor };
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
                    // Read on demand and explicit retry; HQ has no policy change stream.
                    {
                      const answer = yield* Effect.result(
                        Effect.tryPromise({
                          try: (signal) => api.autoUpdatePolicy(signal),
                          catch: policyFailure,
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
                            family: "hqAutoUpdatePolicy",
                            id,
                            access: "denied",
                          });
                        }
                        return yield* Effect.fail(answer.failure);
                      }
                      const value = answer.success;
                      if (value.orgId !== orgId)
                        return yield* Effect.fail({
                          outcome: "definitive-refusal",
                          message: "HQ answered for another organization.",
                        } satisfies StreamFault);
                      store.dispatch({ kind: "baseline-begin", scope, generation });
                      store.dispatch({
                        kind: "baseline-commit",
                        scope,
                        generation,
                        via: "hq-stream",
                        members: [id],
                        rows: [
                          {
                            family: "hqAutoUpdatePolicy",
                            id,
                            value,
                            revision: {
                              kind: "hq",
                              incarnation: `auto-update/${orgId}`,
                              revision: value.revision,
                            },
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
    again: (orgId: string) => {
      const entry = active.get(orgId);
      if (entry === undefined || closed) return;
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

/** PUT answers and GET observations share HQ's durable revision ordering. */
export function observeAutoUpdatePolicy(
  store: AccountStore,
  policy: import("@t3tools/shared/mateAutoUpdatePolicy").HqAutoUpdatePolicy,
) {
  const scope = autoUpdatePolicyScope(policy.orgId);
  store.dispatch({
    kind: "rows",
    scope,
    generation: streamOf(store.state(), scope).generation,
    method: "read",
    via: "hq-stream",
    rows: [
      {
        family: "hqAutoUpdatePolicy",
        id: policy.orgId,
        value: policy,
        revision: {
          kind: "hq",
          incarnation: `auto-update/${policy.orgId}`,
          revision: policy.revision,
        },
      },
    ],
  });
}
