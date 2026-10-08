import { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import { RpcUpdateAdmission } from "../RpcUpdateAdmission.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { MateEngine } from "../engine/MateEngine.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { ProviderUpdateSafety } from "../spi/ProviderUpdateSafety.ts";
import { V1UpdateDrain } from "../update/V1UpdateDrain.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { MateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import { drainMateUpdate, joinUpdateIdleFacts } from "./mateUpdateDrain.ts";

const DrainInput = Schema.Struct({
  version: Schema.String,
  deadlineMs: Schema.Literal(600000),
  automatic: Schema.Boolean,
});

/** nginx always stamps these headers. Only direct loopback zcp may hold admission. */
export function isLocalUpdateRequest(
  address: string | undefined,
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") &&
    headers["x-forwarded-for"] === undefined &&
    headers["x-real-ip"] === undefined &&
    headers.origin === undefined
  );
}
const local = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return isLocalUpdateRequest(Option.getOrUndefined(request.remoteAddress), request.headers);
});
const refused = HttpServerResponse.empty({ status: 403 });
/** The drain and its loopback readiness report read the same actual owners. */
export const readMateUpdateIdleFacts = Effect.gen(function* () {
  const engine = yield* MateEngine;
  const terminals = yield* TerminalManager;
  const legacy = Option.getOrUndefined(yield* Effect.serviceOption(V1UpdateDrain));
  const engineDrain = engine.live ? engine.updateDrain : legacy;
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

const drainRoute = HttpRouter.add(
  "POST",
  "/api/mate/update/drain",
  Effect.gen(function* () {
    if (!(yield* local)) return refused;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const input = yield* request.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(DrainInput)),
      Effect.option,
    );
    if (Option.isNone(input)) return HttpServerResponse.empty({ status: 400 });
    const engine = yield* MateEngine;
    const terminals = yield* TerminalManager;
    const environment = yield* ServerEnvironment;
    const safety = Option.getOrUndefined(yield* Effect.serviceOption(ProviderUpdateSafety));
    const legacyDrain = Option.getOrUndefined(yield* Effect.serviceOption(V1UpdateDrain));
    const engineDrain = engine.live ? engine.updateDrain : legacyDrain;
    const policyOption = yield* Effect.serviceOption(MateAutoUpdatePolicy);
    const policy = Option.getOrUndefined(policyOption);
    const { bootId } = yield* environment.getDescriptor;
    const subscribeChanges = engineDrain?.subscribeChanges;
    if (
      engineDrain === undefined ||
      terminals.updateDrain === undefined ||
      safety === undefined ||
      subscribeChanges === undefined
    ) {
      return HttpServerResponse.jsonUnsafe({ protocol: 1, drained: false, bootId });
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
    const drained = yield* Effect.scoped(
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
        const facts = readMateUpdateIdleFacts;
        return yield* drainMateUpdate({
          allowed: input.value.automatic
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
        });
      }),
    );
    return HttpServerResponse.jsonUnsafe({ protocol: 1, drained, bootId });
  }),
);
const readinessRoute = HttpRouter.add(
  "GET",
  "/api/mate/update/readiness",
  Effect.gen(function* () {
    if (!(yield* local)) return refused;
    const readiness = yield* Effect.serviceOption(ServerCommandReadiness);
    if (Option.isSome(readiness)) yield* readiness.value.await;
    const environment = yield* ServerEnvironment;
    const { serverVersion: version, bootId } = yield* environment.getDescriptor;
    const facts = yield* readMateUpdateIdleFacts;
    return HttpServerResponse.jsonUnsafe({
      protocol: 1,
      version,
      bootId,
      ready: Option.isSome(readiness) && facts.idle,
      blockers: facts.blockers,
    });
  }),
);
const releaseRoute = (path: `/${string}`) =>
  HttpRouter.add(
    "POST",
    path,
    Effect.gen(function* () {
      if (!(yield* local)) return refused;
      const engine = yield* MateEngine;
      const terminals = yield* TerminalManager;
      const legacyDrain = Option.getOrUndefined(yield* Effect.serviceOption(V1UpdateDrain));
      yield* (engine.live ? engine.updateDrain : legacyDrain)?.cancel ?? Effect.void;
      yield* terminals.updateDrain?.cancel ?? Effect.void;
      const rpcAdmission = yield* Effect.serviceOption(RpcUpdateAdmission);
      if (Option.isSome(rpcAdmission)) yield* rpcAdmission.value.cancel;
      return HttpServerResponse.jsonUnsafe({ protocol: 1, reopened: true });
    }),
  );
export const mateUpdateRouteLayer = Layer.mergeAll(
  drainRoute,
  readinessRoute,
  releaseRoute("/api/mate/update/cancel"),
  releaseRoute("/api/mate/update/commit"),
);
