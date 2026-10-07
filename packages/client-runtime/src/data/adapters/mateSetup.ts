/** Public pre-session setup, sampled under the common stream policy. Demand and attempt
 * bookkeeping hold no source values: the account reducer is the only writer. */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import { readMateSetup } from "../../zerops/mateSetup.ts";
import {
  mateSetupOwner,
  mateSetupScope,
  mateSetupSettled,
  type MateSetupValue,
} from "../families/mateSetup.ts";
import type { LinkKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";

export function makeMateSetupDemand(
  store: AccountStore,
  whenReadable?: (resume: () => void) => () => void,
) {
  let closed = false;
  const inputs = new Map<string, string>();
  const demands = new Map<
    string,
    {
      count: number;
      epoch: string | undefined;
      release: () => void;
      signal: (kind: "manual-retry" | "input-changed") => void;
    }
  >();
  const start = (orgId: string, origin: string, epoch: string | undefined) => {
    const ownerId = mateSetupOwner(orgId, origin);
    const scope = mateSetupScope(ownerId);
    const key = `mate:${ownerId}` as LinkKey;
    const moved = Effect.runSync(Queue.sliding<void>(1));
    const signal = (target: typeof scope | typeof key, event: StreamEvent) =>
      store.dispatch({
        kind: "stream",
        key: target,
        now: Effect.runSync(Clock.currentTimeMillis),
        event,
      });
    const supervisor = Effect.runSync(
      superviseLink({
        key,
        scopes: [scope],
        store,
        childMoved: () => {
          Queue.offerUnsafe(moved, undefined);
        },
        repairSession: Effect.fail({
          outcome: "definitive-refusal",
          message: "This setup read was refused.",
        } satisfies StreamFault),
        attempt: (generation) =>
          Effect.gen(function* () {
            yield* Queue.poll(moved);
            signal(key, { kind: "handshake" });
            signal(key, { kind: "baseline-committed" });
            signal(scope, { kind: "attempt" });
            while (true) {
              yield* Queue.poll(moved);
              signal(scope, { kind: "handshake" });
              const child = streamOf(store.state(), scope);
              if (whenReadable !== undefined)
                yield* Effect.callback<void>((resume) => {
                  const stop = whenReadable(() => resume(Effect.void));
                  return Effect.sync(stop);
                });
              const answer = yield* Effect.promise((abort) =>
                readMateSetup(origin, undefined, abort),
              );
              if (closed || streamOf(store.state(), key).generation !== generation)
                return yield* Effect.never;
              if (streamOf(store.state(), scope).generation !== child.generation) continue;
              if (answer.kind === "unreachable")
                return yield* Effect.fail({
                  outcome: "transient",
                  message: "This Mate's setup is not answering.",
                } satisfies StreamFault);
              if (answer.kind === "refused" || answer.kind === "invalid")
                return yield* Effect.fail({
                  outcome: "definitive-refusal",
                  code: answer.kind,
                  message:
                    answer.kind === "invalid"
                      ? "This Mate returned an invalid setup document."
                      : "This Mate refused its setup read.",
                } satisfies StreamFault);
              const value: MateSetupValue = answer.kind === "setup" ? answer : { kind: "absent" };
              const prior = store.state().facts.get(`mateSetup:${ownerId}`)?.revision;
              const sequence = prior?.kind === "mate-link" ? prior.sequence + 1 : 1;
              store.dispatch({ kind: "baseline-begin", scope, generation: child.generation });
              store.dispatch({
                kind: "baseline-commit",
                scope,
                generation: child.generation,
                via: "mate-direct",
                members: [ownerId],
                rows: [
                  {
                    family: "mateSetup",
                    id: ownerId,
                    value,
                    revision: { kind: "mate-link", sequence },
                  },
                ],
              });
              signal(scope, { kind: "baseline-committed" });
              const next = streamOf(store.state(), scope).next;
              if (
                value.kind === "setup" &&
                !mateSetupSettled(value.setup) &&
                next.kind === "revalidate"
              ) {
                yield* Effect.timeoutOrElse(Queue.take(moved), {
                  duration: Math.max(0, next.at - (yield* Clock.currentTimeMillis)),
                  orElse: () => Effect.void,
                });
                signal(scope, { kind: "revalidate" });
              } else {
                yield* Queue.take(moved);
                signal(scope, { kind: "revalidate" });
              }
            }
          }),
      }),
    );
    const fiber = Effect.runFork(supervisor.run);
    return {
      count: 0,
      epoch,
      release: () => {
        Effect.runSync(supervisor.release);
        Effect.runFork(Fiber.interrupt(fiber));
      },
      signal: (kind: "manual-retry" | "input-changed") => {
        Effect.runFork(supervisor.signal(kind));
      },
    };
  };
  return {
    demand(orgId: string, origin: string, epoch?: string) {
      if (closed) return () => undefined;
      const ownerId = mateSetupOwner(orgId, origin);
      let demand = demands.get(ownerId);
      if (demand === undefined) {
        demand = start(orgId, origin, epoch);
        demands.set(ownerId, demand);
      }
      if (epoch !== undefined) {
        const before = inputs.get(ownerId);
        if (before !== undefined && before !== epoch) demand.signal("input-changed");
        inputs.set(ownerId, epoch);
      }
      demand.count++;
      const held = demand;
      return () => {
        if (closed || demands.get(ownerId) !== held) return;
        if (--held.count === 0) {
          held.release();
          demands.delete(ownerId);
        }
      };
    },
    refresh(origin: string) {
      if (closed) return;
      for (const [id, demand] of demands) {
        const identity: unknown = JSON.parse(decodeURIComponent(id));
        if (Array.isArray(identity) && identity[1] === origin) demand.signal("manual-retry");
      }
    },
    close() {
      closed = true;
      for (const demand of demands.values()) demand.release();
      demands.clear();
    },
  };
}
