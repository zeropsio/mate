import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ServerCommandReadiness } from "../spi/serverCommandReadiness.ts";
import {
  makeMateUpdateDrain,
  readMateUpdateIdleFacts,
  reopenMateUpdateAdmission,
} from "./mateUpdateDrainLive.ts";

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
    const { bootId } = yield* (yield* ServerEnvironment).getDescriptor;
    const drain = yield* makeMateUpdateDrain;
    const drained = yield* drain({ automatic: input.value.automatic });
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
      yield* yield* reopenMateUpdateAdmission;
      return HttpServerResponse.jsonUnsafe({ protocol: 1, reopened: true });
    }),
  );
export const mateUpdateRouteLayer = Layer.mergeAll(
  drainRoute,
  readinessRoute,
  releaseRoute("/api/mate/update/cancel"),
  releaseRoute("/api/mate/update/commit"),
);
