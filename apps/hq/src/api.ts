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
 *   `GET /api/mate/whoami` with `Authorization: Mate <credential>` → `{ projectId }`;
 *   `GET /api/mate/self`, the same → the Mate's state (`@t3tools/shared/mateLink` `MateState`)
 *   with its changes (`@t3tools/shared/hqChanges` `MateChanges`).
 * - `POST /api/mates/:projectId/standup`, `POST /api/mates/:projectId/closed-off` → the Mate's state:
 *   its birth, recorded by the client that set it up (the caller asks for the stand-up).
 * - A Mate's changes (`changes.ts`, the wire in `@t3tools/shared/hqChanges`): `POST /api/mate/repos`
 *   `{ name }` → the repository; `POST /api/mate/changes` `{ repo, title }` → `{ change, created }`;
 *   `PATCH /api/mate/changes/:repo/:n` `{ title?, body? }` → the change; `POST
 *   /api/mate/changes/:repo/:n/attachments`, a PNG of at most 20 MiB → `{ id, path }`; and git
 *   itself at `/git/<appId>/<repo>.git`, Basic auth with the user `mate` and the Mate's credential
 *   (`gitHost.ts`).
 * - A person's side of the changes: `GET /api/apps/:appId/changes` → `{ changes }`; `GET
 *   /api/apps/:appId/changes/:repo/:n` → the change's review; `GET`, `POST …/comments`; `GET
 *   …/attachments/:id` → a picture. And `GET /changes/:appId/:repo/:n`, a change's address at HQ,
 *   redirects to the change in the first client origin.
 *
 * Every call but the doors carries `Authorization: Bearer <session>`, of a session issued for this
 * HQ's org. Only the leading HQ answers: a standby or an HQ that is not the official one answers
 * `503 not_active` with `Retry-After`, as does a Zerops that cannot be read (`zerops_unavailable`) —
 * a deploy runs two Cores side by side for a while, and zcp tries again. A refusal answers one
 * code, and for the structure and a Mate's changes a reason code beside it (`zeropsPermissions.ts`'s
 * or their own) — the words for a person are the client's; a
 * refusal at the person's door says nothing of which rule the token broke. Bodies are bounded (8
 * KiB at the doors, 128 KiB for a change's words, 20 MiB for its picture, 64 KiB elsewhere: `413
 * too_large`), and each door is limited per client address (`rateLimit.ts`: `429
 * too_many_requests`).
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

import {
  ATTACHMENT_CONTENT_TYPE,
  ATTACHMENT_MAX_BYTES,
  ChangeNumber,
  EditChangeRequest,
  EnsureRepoRequest,
  OpenChangeRequest,
  PostCommentRequest,
  RepoName,
  changeRoutePath,
} from "@t3tools/shared/hqChanges";

import { ChangeRefused, Changes } from "./changes.ts";
import { Door } from "./door.ts";
import { GitHost } from "./gitHost.ts";
import { type LinkOptions, serveMateLink } from "./link.ts";
import { Leader, NotLeader, RETRY_AFTER } from "./leader.ts";
import { MateCredentials, MateRefused } from "./mateCredentials.ts";
import { DoorRateLimit } from "./rateLimit.ts";
import { Roles } from "./roles.ts";
import { Sessions } from "./sessions.ts";
import {
  MateLinkTickets,
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
/**
 * A change's description or a comment: 20 000 characters, which JSON may spell in up to six bytes
 * each (`\u0001`).
 */
const TEXT_BODY_LIMIT = 128 * 1024;

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
  not_a_mate: 403,
} as const;

const CHANGE_STATUS = {
  forbidden: 403,
  project_not_found: 404,
  app_not_found: 404,
  repo_not_found: 404,
  change_not_found: 404,
  attachment_not_found: 404,
  conflict: 409,
  invalid: 400,
} as const;

const json = (body: unknown, status: number) => HttpServerResponse.jsonUnsafe(body, { status });

/** Try again: this Core does not lead now, Zerops did not answer, or a failure HQ cannot name. */
const unavailable = (code: string) =>
  HttpServerResponse.jsonUnsafe({ code }, { status: 503, headers: RETRY_AFTER });

const isStructureRefused = Schema.is(StructureRefused);
const isChangeRefused = Schema.is(ChangeRefused);
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
export const failure = (error: {
  readonly _tag: string;
}): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (isStructureRefused(error)) {
    return Effect.succeed(
      json({ code: error.code, reason: error.reason }, STRUCTURE_STATUS[error.code]),
    );
  }
  if (isChangeRefused(error)) {
    return Effect.succeed(
      json({ code: error.code, reason: error.reason }, CHANGE_STATUS[error.code]),
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
      return Effect.succeed(unavailable("not_active"));
    case "ZeropsUnavailable":
    case "ZeropsRefused":
      return Effect.as(
        Effect.logWarning("zerops read failed", error),
        unavailable("zerops_unavailable"),
      );
    case "TooLarge":
      return Effect.succeed(json({ code: "too_large" }, 413));
    case "TooManyRequests":
      return Effect.succeed(json({ code: "too_many_requests" }, 429));
    case "SchemaError":
    case "HttpServerError":
      return Effect.succeed(json({ code: "invalid" }, 400));
    default:
      return Effect.as(Effect.logError("api failed", error), unavailable("unavailable"));
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
const knock = (door: "person" | "mate" | "git") =>
  Effect.gen(function* () {
    // `X-Real-IP` is the client address the Zerops L7 balancer sets.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const address =
      request.headers["x-real-ip"] ?? Option.getOrElse(request.remoteAddress, () => "unknown");
    if (!(yield* (yield* DoorRateLimit).take(`${door} ${address}`))) {
      return yield* new TooManyRequests();
    }
  });

/** The project a live Mate credential is bound to; the credential presented. */
const mateHolding = (presented: string | undefined) =>
  Effect.gen(function* () {
    const found =
      presented === undefined ? Option.none() : yield* (yield* MateCredentials).whoami(presented);
    return Option.isSome(found) && presented !== undefined
      ? { projectId: found.value.projectId, credential: presented }
      : yield* new MateCredentialRequired();
  });

/** The Mate presenting `Authorization: Mate <credential>`. */
const mate = Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
  mateHolding(/^Mate (\S+)$/u.exec(request.headers["authorization"] ?? "")?.[1]),
);

/** A change as a path names it, `:repo/:n`: a repository's name and a change's number. */
const decodeChangePath = Schema.decodeUnknownEffect(
  Schema.Struct({
    repo: RepoName,
    n: Schema.NumberFromString.pipe(Schema.decodeTo(ChangeNumber)),
  }),
);
const changePath = Effect.map(
  Effect.flatMap(HttpRouter.params, decodeChangePath),
  ({ repo, n }) => ({ repo, number: n }),
);

/**
 * A change of an application as a person's path names it, `/api/apps/:appId/changes/:repo/:n`.
 * The application's id is taken as given: HQ compares it as text, so any spelling is no match.
 */
const appChangePath = Effect.gen(function* () {
  const appId = (yield* HttpRouter.params)["appId"] ?? "";
  return { appId, ...(yield* changePath) };
});

/**
 * HQ's address of a change, `/changes/:appId/:repo/:n`, as it leads into the client: an
 * application's id meets the git layer's id pattern, as a repository's name does.
 */
const decodeChangeAddress = Schema.decodeUnknownEffect(
  Schema.Struct({
    appId: RepoName,
    repo: RepoName,
    n: Schema.NumberFromString.pipe(Schema.decodeTo(ChangeNumber)),
  }),
);

/**
 * A picture as a Mate sends it: the body itself, `Content-Type: image/png`, at most 20 MiB — a
 * declared length above it refused before a byte is read.
 */
const pngBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > ATTACHMENT_MAX_BYTES) {
    return yield* new TooLarge();
  }
  if (request.headers["content-type"]?.split(";")[0]?.trim() !== ATTACHMENT_CONTENT_TYPE) {
    return yield* new ChangeRefused({ code: "invalid", reason: "not_png" });
  }
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(ATTACHMENT_MAX_BYTES)),
  );
  if (body.byteLength > ATTACHMENT_MAX_BYTES) return yield* new TooLarge();
  return new Uint8Array(body);
});

/** The credential git presents for the user `mate`: `Authorization: Basic base64(mate:<credential>)`. */
const gitCredential = (authorization: string | undefined) => {
  const encoded = /^Basic ([A-Za-z0-9+/=]+)$/u.exec(authorization ?? "")?.[1];
  const decoded = encoded === undefined ? "" : Buffer.from(encoded, "base64").toString("utf8");
  return decoded.startsWith("mate:") ? decoded.slice("mate:".length) : undefined;
};

/**
 * git at `/git/<appId>/<repo>.git` for a Mate, decided before the git layer serves the request:
 * its credential (a `401` asks git for it, and a client address's misses are limited as a door's
 * knocks are); then, on the service as the layer reads the request (`gitHost.ts`), a push by
 * `can`'s `open_change` over the org read now; and any request by `fetch_repo` on the repository's
 * application, which also decides every repository the layer serves it.
 */
const serveGit = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const presented = gitCredential(request.headers["authorization"]);
  const holder =
    presented === undefined ? Option.none() : yield* (yield* MateCredentials).whoami(presented);
  if (Option.isNone(holder)) {
    // A credential presented and missed is a guess: limited per client address, like the doors.
    // git's first request of every command presents none, to be asked: that guesses nothing.
    if (presented !== undefined) yield* knock("git");
    return HttpServerResponse.text("Authentication required\n", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="HQ"' },
    });
  }
  const { projectId } = holder.value;
  const changes = yield* Changes;
  yield* (yield* GitHost).serve(
    request,
    ({ repo, service }) =>
      Effect.gen(function* () {
        if (service === "git-receive-pack") yield* changes.mateApp(projectId, "open_change");
        const appId = yield* changes.mateFetch(projectId, repo.appId);
        return { kind: "mate", mateId: projectId, appId } as const;
      }),
    (repo) => Effect.isSuccess(changes.mateFetch(projectId, repo.appId)),
  );
  return HttpServerResponse.empty();
});

const routes = (
  options: { readonly clientOrigins: ReadonlyArray<string> } & StreamOptions & {
      readonly link?: LinkOptions;
    },
) =>
  Layer.mergeAll(
    // No state is read, so any Core answers it, standby or not.
    HttpRouter.add(
      "GET",
      "/changes/:appId/:repo/:n",
      Effect.flatMap(HttpRouter.params, decodeChangeAddress).pipe(
        Effect.map(({ appId, repo, n }) =>
          HttpServerResponse.redirect(
            `${options.clientOrigins[0] ?? ""}${changeRoutePath(appId, repo, n)}`,
            { status: 302 },
          ),
        ),
        Effect.orElseSucceed(() => HttpServerResponse.text("No such change\n", { status: 404 })),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/changes",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["appId"] ?? "";
          return json({ changes: yield* (yield* Changes).listChanges(userId, appId) }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/changes/:repo/:n",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const { appId, repo, number } = yield* appChangePath;
          return json(yield* (yield* Changes).changeDetail(userId, appId, repo, number), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/changes/:repo/:n/comments",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const { appId, repo, number } = yield* appChangePath;
          const comments = yield* (yield* Changes).listComments(userId, appId, repo, number);
          return json({ comments }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/changes/:repo/:n/comments",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const { appId, repo, number } = yield* appChangePath;
          const { body } = yield* jsonBody(PostCommentRequest, TEXT_BODY_LIMIT);
          return json(yield* (yield* Changes).postComment(userId, appId, repo, number, body), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/changes/:repo/:n/attachments/:id",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const { appId, repo, number } = yield* appChangePath;
          const id = (yield* HttpRouter.params)["id"] ?? "";
          const png = yield* (yield* Changes).attachment(userId, appId, repo, number, id);
          // A picture is kept once and never changes; nosniff keeps it a picture.
          return HttpServerResponse.uint8Array(png, {
            contentType: ATTACHMENT_CONTENT_TYPE,
            headers: {
              "cache-control": "private, max-age=31536000, immutable",
              "x-content-type-options": "nosniff",
            },
          });
        }),
      ),
    ),
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
    HttpRouter.add("*", "/git/*", handle(serveGit)),
    HttpRouter.add(
      "POST",
      "/api/mate/repos",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const { name } = yield* jsonBody(EnsureRepoRequest, BODY_LIMIT);
          return json(yield* (yield* Changes).ensureRepo(projectId, name), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/changes",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const { repo, title } = yield* jsonBody(OpenChangeRequest, BODY_LIMIT);
          return json(yield* (yield* Changes).openChange(projectId, repo, title), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/mate/changes/:repo/:n",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const { repo, number } = yield* changePath;
          const edit = yield* jsonBody(EditChangeRequest, TEXT_BODY_LIMIT);
          return json(yield* (yield* Changes).editChange(projectId, repo, number, edit), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/changes/:repo/:n/attachments",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const { repo, number } = yield* changePath;
          const png = yield* pngBody;
          return json(yield* (yield* Changes).attach(projectId, repo, number, png), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/whoami",
      handle(Effect.map(mate, ({ projectId }) => json({ projectId }, 200))),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/link-ticket",
      handle(
        Effect.gen(function* () {
          const { credential } = yield* mate;
          const minted = yield* (yield* MateLinkTickets).mint(credential);
          return json({ ticket: minted.ticket, expiresIn: 60 }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/link",
      handle(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const ticket = new URL(request.url, "http://hq").searchParams.get("ticket");
          const presented =
            ticket === null
              ? undefined
              : Option.getOrUndefined(yield* (yield* MateLinkTickets).take(ticket));
          const { projectId, credential } = yield* mateHolding(presented);
          const socket = yield* request.upgrade;
          yield* serveMateLink(socket, projectId, credential, options.link ?? {});
          return HttpServerResponse.empty();
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/self",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const state = yield* (yield* Structure).mateState(projectId);
          return Option.isSome(state)
            ? json({ ...state.value, ...(yield* (yield* Changes).mateChanges(projectId)) }, 200)
            : json({ code: "mate_not_found", reason: "mate_not_found" }, 404);
        }),
      ),
    ),
    ...(["standup", "closed-off"] as const).map((path) =>
      HttpRouter.add(
        "POST",
        `/api/mates/:projectId/${path}`,
        handle(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
            const mark = path === "standup" ? "standup" : "closed_off";
            return json(yield* (yield* Structure).markBirth(userId, projectId, mark), 200);
          }),
        ),
      ),
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
  options: { readonly clientOrigins: ReadonlyArray<string> } & StreamOptions & {
      readonly link?: LinkOptions;
    },
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
