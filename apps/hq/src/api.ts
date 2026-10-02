/**
 * HQ's API: JSON over HTTP, for the client origins only (CORS, `HQ_CLIENT_ORIGINS`).
 *
 * - `POST /api/door` `{ token }`: a throwaway through the door (`door.ts`) → `{ session, expiresAt }`.
 * - `DELETE /api/session`: revokes the presented session.
 * - `POST /api/apps` `{ name }` → the application.
 * - `POST /api/apps/:id/projects` `{ projectId, kind, mate? }`: attaches a project.
 * - `GET /api/structure` → `{ apps }`, as the caller sees them in Zerops.
 * - `GET /api/structure/ws?ticket=`: the same, then its changes, over a WebSocket (`stream.ts`);
 *   the ticket from `POST /api/stream-ticket` → `{ ticket, expiresIn }`.
 * - `PATCH /api/apps/:id` `{ name }` → the application.
 * - `PUT /api/projects/:projectId/app` `{ appId | null, kind }` → `{ projectId, appId, kind }`:
 *   moves a project into an application, or out of any.
 * - `POST /api/mates` `{ projectId, name, face }`, `PATCH /api/mates/:projectId` `{ name?, face? }`
 *   → `{ projectId, name, face }`: a Mate's record, in an application or not.
 * - The Mate's own door (`mateCredentials.ts`): `POST /api/mate/challenge` `{ projectId }` →
 *   `{ nonce, expiresIn }`; `POST /api/mate/credential` `{ projectId, nonce }` → `{ credential }`;
 *   `GET /api/mate/whoami` with `Authorization: Mate <credential>` → `{ projectId }`.
 *
 * Every call but the doors carries `Authorization: Bearer <session>`, of a session issued for this
 * HQ's org. Only the leading HQ answers: a standby or an HQ that is not the official one answers
 * `503 not_active`. A refusal answers one code; a refusal at the person's door says nothing of which
 * rule the token broke. Bodies are bounded (8 KiB at the doors, 64 KiB elsewhere: `413 too_large`), and each door
 * is limited per client address (`rateLimit.ts`: `429 too_many_requests`).
 *
 * @module api
 */
import * as ByteSize from "effect/ByteSize";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpIncomingMessage from "effect/unstable/http/HttpIncomingMessage";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { Door } from "./door.ts";
import { Leader, NotLeader } from "./leader.ts";
import { MateCredentials, MateRefused } from "./mateCredentials.ts";
import { DoorRateLimit } from "./rateLimit.ts";
import { Roles } from "./roles.ts";
import { Sessions } from "./sessions.ts";
import {
  type StreamOptions,
  StreamTickets,
  serveStructureSocket,
  structureMessages,
} from "./stream.ts";
import { Structure, StructureRefused } from "./structure.ts";

class SessionRequired extends Schema.TaggedError<SessionRequired>()("SessionRequired", {}) {}
class MateCredentialRequired extends Schema.TaggedError<MateCredentialRequired>()(
  "MateCredentialRequired",
  {},
) {}
class TooLarge extends Schema.TaggedError<TooLarge>()("TooLarge", {}) {}
class TooManyRequests extends Schema.TaggedError<TooManyRequests>()("TooManyRequests", {}) {}

const DOOR_BODY_LIMIT = 8 * 1024;
const BODY_LIMIT = 64 * 1024;

const DoorBody = Schema.Struct({ token: Schema.String });
const ChallengeBody = Schema.Struct({ projectId: Schema.String });
const CredentialBody = Schema.Struct({ projectId: Schema.String, nonce: Schema.String });
const AppBody = Schema.Struct({ name: Schema.String });
const MoveBody = Schema.Struct({
  appId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
});
const NewMateBody = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  face: Schema.String,
});
const MateBody = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  face: Schema.optionalKey(Schema.String),
});
const AttachBody = Schema.Struct({
  projectId: Schema.String,
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
  mate: Schema.optionalKey(Schema.Struct({ name: Schema.String, face: Schema.String })),
});

const STRUCTURE_STATUS = {
  forbidden: 403,
  app_not_found: 404,
  project_not_found: 404,
  mate_not_found: 404,
  invalid: 400,
  conflict: 409,
} as const;

const MATE_STATUS = {
  unknown_nonce: 401,
  expired: 401,
  env_mismatch: 401,
  project_not_in_org: 403,
  project_gone: 404,
} as const;

const json = (body: unknown, status: number) => HttpServerResponse.jsonUnsafe(body, { status });

const isStructureRefused = Schema.is(StructureRefused);
const isMateRefused = Schema.is(MateRefused);

/**
 * A JSON body of at most `limit` bytes. A declared `Content-Length` above it is refused before a
 * byte is read; past `MaxBodySize` the Node server stops reading a body that declared none (and
 * drops its connection); the check after the read holds for any other host.
 */
const jsonBody = <A, RD>(schema: Schema.Codec<A, unknown, RD>, limit: number) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (Number(request.headers["content-length"] ?? 0) > limit) return yield* new TooLarge();
    const text = yield* request.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(limit)),
    );
    if (text.length > limit) return yield* new TooLarge();
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(text);
  });

/** Every failure as one status and one code. */
const failure = (error: {
  readonly _tag: string;
}): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (isStructureRefused(error)) {
    return Effect.succeed(
      json({ code: error.code, message: error.message }, STRUCTURE_STATUS[error.code]),
    );
  }
  if (isMateRefused(error)) {
    return Effect.as(
      Effect.logInfo("mate refused", error),
      json({ code: error.code }, MATE_STATUS[error.code]),
    );
  }
  switch (error._tag) {
    case "DoorRefused":
      return Effect.as(
        Effect.logInfo("door refused", error),
        json({ code: "zerops_throwaway_required" }, 401),
      );
    case "SessionRequired":
      return Effect.succeed(json({ code: "session_required" }, 401));
    case "MateCredentialRequired":
      return Effect.succeed(json({ code: "mate_credential_required" }, 401));
    case "NotLeader":
      return Effect.succeed(json({ code: "not_active" }, 503));
    case "ZeropsUnavailable":
    case "ZeropsRefused":
      return Effect.as(
        Effect.logWarning("zerops read failed", error),
        json({ code: "zerops_unavailable" }, 503),
      );
    case "TooLarge":
      return Effect.succeed(json({ code: "too_large" }, 413));
    case "TooManyRequests":
      return Effect.succeed(json({ code: "too_many_requests" }, 429));
    case "SchemaError":
    case "HttpServerError":
      return Effect.succeed(json({ code: "invalid" }, 400));
    default:
      return Effect.as(Effect.logError("api failed", error), json({ code: "unavailable" }, 503));
  }
};

const handle = <E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const { state } = yield* (yield* Leader).status;
    if (state !== "active") return yield* new NotLeader({ reason: "standby" });
    return yield* effect;
  }).pipe(Effect.catch(failure));

const bearer = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => /^Bearer (\S+)$/u.exec(request.headers["authorization"] ?? "")?.[1],
);

/** The holder of the session `token`, while it lives and was issued for this HQ's org. */
const holderOf = (token: string | undefined) =>
  Effect.gen(function* () {
    const found = token === undefined ? Option.none() : yield* (yield* Sessions).resolve(token);
    if (Option.isNone(found)) return yield* new SessionRequired();
    const { orgId } = yield* (yield* Roles).view;
    return found.value.orgId === orgId ? found.value : yield* new SessionRequired();
  });

const principal = Effect.flatMap(bearer, holderOf);

/** A token of the client address's bucket at `door`; none left is `429`. */
const knock = (door: "person" | "mate") =>
  Effect.gen(function* () {
    // `X-Real-IP` is the client address the Zerops L7 balancer sets.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const address =
      request.headers["x-real-ip"] ?? Option.getOrElse(request.remoteAddress, () => "unknown");
    if (!(yield* (yield* DoorRateLimit).take(`${door} ${address}`))) {
      return yield* new TooManyRequests();
    }
  });

/** The project of the Mate credential presented as `Authorization: Mate <credential>`. */
const mate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const presented = /^Mate (\S+)$/u.exec(request.headers["authorization"] ?? "")?.[1];
  const found =
    presented === undefined ? Option.none() : yield* (yield* MateCredentials).whoami(presented);
  return Option.isSome(found) ? found.value : yield* new MateCredentialRequired();
});

const routes = (options: StreamOptions) =>
  Layer.mergeAll(
    HttpRouter.add(
      "POST",
      "/api/door",
      handle(
        Effect.gen(function* () {
          yield* knock("person");
          const { token } = yield* jsonBody(DoorBody, DOOR_BODY_LIMIT);
          const caller = yield* (yield* Door).admit(Redacted.make(token));
          const session = yield* (yield* Sessions).issue(caller, caller.doorTokenId);
          return json(
            { session: session.token, expiresAt: session.expiresAt, userId: caller.userId },
            200,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/challenge",
      handle(
        Effect.gen(function* () {
          yield* knock("mate");
          const { projectId } = yield* jsonBody(ChallengeBody, DOOR_BODY_LIMIT);
          return json(yield* (yield* MateCredentials).challenge(projectId), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/credential",
      handle(
        Effect.gen(function* () {
          yield* knock("mate");
          const { projectId, nonce } = yield* jsonBody(CredentialBody, DOOR_BODY_LIMIT);
          return json(yield* (yield* MateCredentials).issue(projectId, nonce), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/whoami",
      handle(Effect.map(mate, (found) => json(found, 200))),
    ),
    HttpRouter.add(
      "DELETE",
      "/api/session",
      handle(
        Effect.gen(function* () {
          yield* principal;
          const token = yield* bearer;
          if (token !== undefined) yield* (yield* Sessions).revoke(token);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const { name } = yield* jsonBody(AppBody, BODY_LIMIT);
          return json(yield* (yield* Structure).createApp(userId, name), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:id/projects",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["id"] ?? "";
          const input = yield* jsonBody(AttachBody, BODY_LIMIT);
          yield* (yield* Structure).attachProject(userId, appId, input);
          return json({ appId, projectId: input.projectId, kind: input.kind }, 201);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/stream-ticket",
      handle(
        Effect.gen(function* () {
          yield* principal;
          const minted = yield* (yield* StreamTickets).mint((yield* bearer) ?? "");
          return json({ ticket: minted.ticket, expiresIn: 60 }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/structure/ws",
      handle(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const ticket = new URL(request.url, "http://hq").searchParams.get("ticket");
          const token =
            ticket === null
              ? undefined
              : Option.getOrUndefined(yield* (yield* StreamTickets).take(ticket));
          const { userId } = yield* holderOf(token);
          const leader = yield* Leader;
          const ending = Effect.gen(function* () {
            if ((yield* leader.status).state !== "active") return "lead" as const;
            return (yield* Effect.isSuccess(holderOf(token))) ? undefined : ("session" as const);
          });
          const socket = yield* request.upgrade;
          yield* serveStructureSocket(
            socket,
            structureMessages(userId, ending, options.recheck ?? Duration.seconds(30)),
            options.pingEvery ?? Duration.seconds(20),
          );
          return HttpServerResponse.empty();
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/apps/:id",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["id"] ?? "";
          const { name } = yield* jsonBody(AppBody, BODY_LIMIT);
          return json(yield* (yield* Structure).renameApp(userId, appId, name), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/api/projects/:projectId/app",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
          const target = yield* jsonBody(MoveBody, BODY_LIMIT);
          return json(yield* (yield* Structure).moveProject(userId, projectId, target), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mates",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const mate = yield* jsonBody(NewMateBody, BODY_LIMIT);
          return json(yield* (yield* Structure).createMate(userId, mate), 201);
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/mates/:projectId",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
          const patch = yield* jsonBody(MateBody, BODY_LIMIT);
          return json(yield* (yield* Structure).patchMate(userId, projectId, patch), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/structure",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          return json(yield* (yield* Structure).read(userId), 200);
        }),
      ),
    ),
  );

export const apiRoutes = (
  options: { readonly clientOrigins: ReadonlyArray<string> } & StreamOptions,
) =>
  Layer.mergeAll(
    routes(options),
    HttpRouter.cors({
      allowedOrigins: options.clientOrigins,
      allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["authorization", "content-type"],
      maxAge: 600,
    }),
  );
