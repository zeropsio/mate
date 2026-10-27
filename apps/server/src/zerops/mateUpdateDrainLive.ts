import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { MateEngine } from "../engine/MateEngine.ts";
import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { RpcUpdateAdmission } from "../RpcUpdateAdmission.ts";
import { ProviderUpdateSafety } from "../spi/ProviderUpdateSafety.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { MateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import { drainMateUpdate, joinUpdateIdleFacts } from "./mateUpdateDrain.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";

/** The drain and its loopback readiness report read the same actual owners. */
export const readMateUpdateIdleFacts = Effect.gen(function* () {
  const engine = yield* MateEngine;
  const terminals = yield* TerminalManager;
  const engineDrain = engine.updateDrain;
  const safety = Option.getOrUndefined(yield* Effect.serviceOption(ProviderUpdateSafety));
  const rpc = Option.getOrUndefined(yield* Effect.serviceOption(RpcUpdateAdmission));
  const clones = Option.getOrUndefined(yield* Effect.serviceOption(ProjectCloneTracker));
  const crew = Option.getOrUndefined(yield* Effect.serviceOption(CrewEngine));
  const logins = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsAgentLogin));
  const unknown = (owner: string) =>
    Effect.succeed({ idle: false, blockers: [`${owner} state unknown`] });
  const owners = yield* Effect.all([
    engineDrain?.facts ?? unknown("engine"),
    terminals.updateDrain?.facts ?? unknown("terminal"),
    safety?.facts ?? unknown("provider"),
    rpc?.facts ?? unknown("client admission"),
    clones?.updateFacts ?? unknown("clone"),
    crew?.updateFacts ?? unknown("crew"),
  ]);
  const loginBlockers =
    logins === undefined
      ? ["agent login state unknown"]
      : Object.values(yield* logins.latest).flatMap((login) =>
          login !== undefined && !["succeeded", "failed", "cancelled"].includes(login.phase)
            ? ["agent login in progress"]
            : [],
        );
  return joinUpdateIdleFacts(...owners, {
    idle: loginBlockers.length === 0,
    blockers: loginBlockers,
  });
});

/**
 * The one update drain over the Mate's actual owners: zcp's loopback `drain` route runs it for
 * `mate update`, and the Mate's own restart runs it before `zcp self restart`. Built where the
 * owners are provided; each run reads them from there.
 */
export const makeMateUpdateDrain = Effect.gen(function* () {
  const owners = yield* Effect.context<MateEngine | TerminalManager>();
  return (input: { readonly automatic: boolean }): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const engine = yield* MateEngine;
      const terminals = yield* TerminalManager;
      const safety = Option.getOrUndefined(yield* Effect.serviceOption(ProviderUpdateSafety));
      const engineDrain = engine.updateDrain;
      const policyOption = yield* Effect.serviceOption(MateAutoUpdatePolicy);
      const policy = Option.getOrUndefined(policyOption);
      const subscribeChanges = engineDrain?.subscribeChanges;
      if (
        engineDrain === undefined ||
        terminals.updateDrain === undefined ||
        safety === undefined ||
        subscribeChanges === undefined
      ) {
        return false;
      }
      const clones = Option.getOrUndefined(yield* Effect.serviceOption(ProjectCloneTracker));
      const crew = Option.getOrUndefined(yield* Effect.serviceOption(CrewEngine));
      const logins = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsAgentLogin));
      const rpcAdmission = Option.getOrUndefined(yield* Effect.serviceOption(RpcUpdateAdmission));
      const terminalDrain = terminals.updateDrain;
      const changed = yield* Queue.unbounded<void>();
      const offer = Effect.sync(() => {
        Queue.offerUnsafe(changed, undefined);
      });
      return yield* Effect.scoped(
        Effect.gen(function* () {
          if (clones?.subscribeUpdateChanges !== undefined)
            yield* (yield* clones.subscribeUpdateChanges).changes.pipe(
              Stream.runForEach(() => offer),
              Effect.forkChild,
            );
          if (crew?.subscribeUpdateChanges !== undefined)
            yield* (yield* crew.subscribeUpdateChanges).changes.pipe(
              Stream.runForEach(() => offer),
              Effect.forkChild,
            );
          if (logins !== undefined)
            yield* logins.changes.pipe(
              Stream.runForEach(() => offer),
              Effect.forkChild,
            );
          yield* (yield* safety.subscribeChanges).changes.pipe(
            Stream.runForEach(() => offer),
            Effect.forkChild,
          );
          if (rpcAdmission !== undefined)
            yield* (yield* rpcAdmission.subscribeChanges).changes.pipe(
              Stream.runForEach(() => offer),
              Effect.forkChild,
            );
          yield* (yield* subscribeChanges).changes.pipe(
            Stream.runForEach(() => offer),
            Effect.forkChild,
          );
          if (policy !== undefined)
            yield* policy.changes.pipe(
              Stream.changesWith(
                (left, right) =>
                  left._tag === right._tag &&
                  (Option.isNone(left) ||
                    (Option.isSome(right) &&
                      left.value.orgId === right.value.orgId &&
                      left.value.revision === right.value.revision &&
                      left.value.enabled === right.value.enabled)),
              ),
              Stream.runForEach(() => offer),
              Effect.forkChild,
            );
          yield* Effect.acquireRelease(
            terminals.subscribe(() => offer),
            (unsubscribe) => Effect.sync(unsubscribe),
          );
          const facts = readMateUpdateIdleFacts.pipe(
            Effect.provideService(MateEngine, engine),
            Effect.provideService(TerminalManager, terminals),
          );
          return yield* drainMateUpdate({
            allowed: input.automatic
              ? (policy?.verify ?? Effect.succeedNone).pipe(
                  Effect.map((value) => Option.isSome(value) && value.value.enabled),
                )
              : Effect.succeed(true),
            begin: (rpcAdmission?.begin ?? Effect.void).pipe(
              Effect.andThen(engineDrain.begin),
              Effect.andThen(terminalDrain.begin),
            ),
            cancel: engineDrain.cancel.pipe(
              Effect.andThen(terminalDrain.cancel),
              Effect.andThen(rpcAdmission?.cancel ?? Effect.void),
            ),
            facts: terminalDrain.quiesce.pipe(Effect.andThen(facts)),
            quiesce: engineDrain.quiesce.pipe(
              Effect.flatMap((native) =>
                facts.pipe(Effect.map((process) => joinUpdateIdleFacts(native, process))),
              ),
            ),
            changed: Queue.take(changed),
            // Only the organization's automatic update waits for quiet: the person's own runs now.
            ...(input.automatic
              ? {
                  quiet: Effect.all([
                    facts,
                    engineDrain.lastTurnEndedAt ?? Effect.succeed(undefined),
                  ]).pipe(Effect.map(([idle, lastTurnEndedAt]) => ({ ...idle, lastTurnEndedAt }))),
                }
              : {}),
          });
        }),
      );
    }).pipe(Effect.provideContext(owners));
});

/** Opens admission an update drain closed: the engine's, the terminals' and the clients'. */
export const reopenMateUpdateAdmission = Effect.map(
  Effect.all([MateEngine, TerminalManager, Effect.serviceOption(RpcUpdateAdmission)]),
  ([engine, terminals, rpcAdmission]) =>
    (engine.updateDrain?.cancel ?? Effect.void).pipe(
      Effect.andThen(terminals.updateDrain?.cancel ?? Effect.void),
      Effect.andThen(Option.isSome(rpcAdmission) ? rpcAdmission.value.cancel : Effect.void),
    ),
);
