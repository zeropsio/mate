import { HqLifecycleIntent } from "@t3tools/shared/hqLifecycle";
import { Observation } from "./observation.ts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { RASTER_CONTENT_TYPES, rasterContentType } from "@t3tools/shared/hqAttachments";
/**
 * HQ's API: JSON over HTTP, answered to any origin without credentials (CORS): every call carries
 * a bearer or a one-use ticket, never a cookie, so a foreign page holds nothing a browser attaches.
 *
 * - `POST /api/door` `{ token }`: a throwaway through the door (`door.ts`) → `{ session, expiresAt }`.
 * - `DELETE /api/session`: revokes the presented session.
 * - `POST /api/apps` `{ name }` → the application; `DELETE /api/apps/:id` → `204`, only one that
 *   holds nothing (`409 conflict` `app_not_empty`), its repositories with it.
 * - Every event that asks for deploys answers, beside its own, `deploys`: where each job it asked
 *   for stands once HQ submitted it (`@t3tools/shared/hqDeploys`, `deploys.ts`); a deploy that did
 *   not go through never undoes the event.
 * - `POST /api/apps/:id/projects` `{ projectId, kind, mate?, environment?, created? }`: attaches a
 *   project, a Mate's record naming its zcp service where `mate.serviceId` does; a stage or a production is its application's environment, named `environment.name` or
 *   after its project (`environments.ts`); `created` says the person's client made it for HQ to
 *   deploy, whose services then get their subdomain on their first deploy (audit R1).
 * - `GET /api/structure` → `{ apps }`, as the caller sees them in Zerops: each with its projects,
 *   and its environments with their deploys.
 * - `GET /api/structure/ws?ticket=`: the same, then its changes, in 100 s WebSocket segments
 *   (`stream.ts`); close 4410 ("segment over") asks for a fresh ticket and the next snapshot;
 *   the ticket from `POST /api/stream-ticket` → `{ ticket, expiresIn }`.
 * - `PATCH /api/apps/:id` `{ name }` → the application.
 * - `PUT /api/projects/:projectId/app` `{ appId | null, kind }` → `{ projectId, appId, kind }`:
 *   moves a project into an application, or out of any.
 * - `PUT /api/apps/:appId/environments/:name/deploy-token` `{ token }` → `{ deploys }`: the
 *   environment's deploy token, minted by the client of whoever attaches it, kept sealed under
 *   HQ's key (`deployKeys.ts`; without one `409 conflict` `no_key_secret`); the structure says only
 *   `keyHeld`.
 * - `POST /api/apps/:appId/environments/:name/redeploy` `{ service, sha }` → `{ deploys }`: a
 *   person's "Run again" of the environment's newest deploy of that service, ended (`deploys.ts`).
 * - `POST /api/apps/:appId/environments/:name/services` `{ service }` → `{ deploys }`: a person's
 *   "Add <service>", one its tier declares and its project lacks (`409 conflict`
 *   `service_not_declared` for one it does not declare).
 * - `POST /api/mates` `{ projectId, face, standUp?, serviceId? }`, `PATCH /api/mates/:projectId`
 *   `{ face }` → `{ projectId, face }`: a Mate's record, in an application or not, naming its zcp
 *   service where its client knows it (one Mate per project); its name is its project's in Zerops
 *   (D3).
 * - The Mate's own door (`mateCredentials.ts`): `POST /api/mate/challenge` `{ projectId }` →
 *   `{ nonce, expiresIn }`; `POST /api/mate/credential` `{ projectId, nonce, keyTokenId?,
 *   serviceId? }` → `{ credential }`, refused `409 not_this_projects_mate` to a zcp service other
 *   than the one the Mate's record names (one Mate per project, audit D2); `GET /api/mate/whoami`
 *   with `Authorization: Mate <credential>` → `{ projectId }`; `PUT /api/mate/key` `{ keyTokenId }`,
 *   the same → `204`: the id of the key the Mate's container holds, which `GET
 *   /api/mates/:projectId/key` → `{ keyTokenId }` tells the project's admin; a named key that
 *   also reads other projects is never kept, and its Mate's record says `keyWider` — its id told
 *   by that read, for Finish setup's harden to narrow — until its admin, having finished its setup,
 *   asks `POST /api/mates/:projectId/key-check` → `204` to read it again;
 *   `GET /api/mate/self`, the same → the Mate's state (`@t3tools/shared/mateLink` `MateState`)
 *   with its changes (`@t3tools/shared/hqChanges` `MateChanges`).
 * - `POST /api/mates/:projectId/closed-off` → the Mate's state: its project closed off, recorded by
 *   the client that set it up. Its stand-up is asked in the write that records it (B3).
 * - A Mate's changes (`changes.ts`, the wire in `@t3tools/shared/hqChanges`): `POST /api/mate/repos`
 *   `{ name }` → the repository; `POST /api/mate/changes` `{ repo, title }` → `{ change, created }`;
 *   `PATCH /api/mate/changes/:repo/:n` `{ title?, body? }` → the change; `POST
 *   /api/mate/changes/:repo/:n/attachments`, a raster picture of at most 20 MiB → `{ id, path }`; and git
 *   itself at `/git/<appId>/<repo>.git`, Basic auth with the user `mate` and the Mate's credential
 *   (`gitHost.ts`).
 * - A person's side of the changes: `GET /api/apps/:appId/repos` → `{ repos }`, its repositories;
 *   `GET /api/apps/:appId/changes` → `{ changes }`; `GET
 *   /api/apps/:appId/changes/:repo/:n` → the change's review; `GET`, `POST …/comments`; `GET
 *   …/attachments/:id` → a picture; `POST …/merge` `{ expectedHead }` and `POST …/close` → the
 *   change, merged or closed. A tier of the application's recipe (`@t3tools/shared/hqRecipe`):
 *   `GET /api/apps/:appId/recipe/:tier`, and a Mate's own, `GET /api/mate/recipe/:tier`. And `GET
 *   /changes/:appId/:repo/:n`, a change's address at HQ,
 *   redirects to the change in the hosted client.
 * - An application's releases to production (`releases.ts`, the wire in
 *   `@t3tools/shared/hqRelease`): `GET /api/apps/:appId/releases` → `{ releases }`; `POST
 *   /api/apps/:appId/releases` `{ tag, groupHead, entries }` and `POST
 *   /api/apps/:appId/releases/:tag/rollback` `{ groupHead }` → `201`, the release made.
 *
 * Every call but the doors carries `Authorization: Bearer <session>`, of a session issued for this
 * HQ's org. Only the leading HQ answers: a standby or an HQ that is not the official one answers
 * `503 not_active` with `Retry-After`, as does a Zerops that cannot be read (`zerops_unavailable`) —
 * a deploy runs two Cores side by side for a while, and zcp tries again. A write whose roles Zerops
 * left unanswered answers `503 zerops_unanswered`: refused before it wrote anything. Zerops refusing
 * HQ outright answers `403 zerops_refused` with its reason, never a 503. A refusal answers one
 * code, and for the structure and a Mate's changes a reason code beside it (`zeropsPermissions.ts`'s
 * or their own) — the words for a person are the client's; a
 * refusal at the person's door says nothing of which rule the token broke. Bodies are bounded (8
 * KiB at the doors, 128 KiB for a change's words, 20 MiB for its picture, 64 KiB elsewhere: `413
 * too_large`), and each door is limited per client address, a person's door per person too
 * (`rateLimit.ts`: `429 too_many_requests`).
 *
 * @module api
 */
import { GitError } from "@t3tools/hq-git";
import { upgradeSocket } from "./socketUpgrade.ts";
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
  ATTACHMENT_MAX_BYTES,
  ChangeNumber,
  ChangeDetailQuery,
  EditChangeRequest,
  EnsureRepoRequest,
  MergeChangeRequest,
  CloseChangeRequest,
  OpenChangeRequest,
  PostCommentRequest,
  RepoName,
  Sha,
  changeRoutePath,
} from "@t3tools/shared/hqChanges";

import { RepositoryQuery } from "@t3tools/shared/hqGit";
import { ChangeRefused, Changes } from "./changes.ts";
import { RecipeTier } from "@t3tools/shared/hqRecipe";
import { NO_DEPLOYS } from "@t3tools/shared/hqDeploys";
import { CreateReleaseRequest, RollbackRequest } from "@t3tools/shared/hqRelease";

import { DeployRefused, Deploys } from "./deploys.ts";
import { ReleaseRefused, Releases } from "./releases.ts";
import { Door } from "./door.ts";
import { GitHost } from "./gitHost.ts";
import { type LinkOptions, serveMateLink } from "./link.ts";
import { Leader, NotLeader, RETRY_AFTER } from "./leader.ts";
import { MateCredentials, MateRefused } from "./mateCredentials.ts";
import { DOOR_LIMIT, DoorRateLimit, PERSON_ADDRESS_LIMIT, TooManyRequests } from "./rateLimit.ts";
import { Writes } from "./writes.ts";
import { ROLES_UNANSWERED, Roles } from "./roles.ts";
import type { RolloutCause } from "./rollouts.ts";
import { PersonGitCredentials, type GitHolder } from "./personGitCredentials.ts";
import { Sessions } from "./sessions.ts";
import { MateLinkTickets, type StreamOptions, StreamTickets, serveHqSocket } from "./stream.ts";
import { Structure, StructureRefused } from "./structure.ts";

class SessionRequired extends Schema.TaggedError<SessionRequired>()("SessionRequired", {}) {}
class MateCredentialRequired extends Schema.TaggedError<MateCredentialRequired>()(
  "MateCredentialRequired",
  {},
) {}
class TooLarge extends Schema.TaggedError<TooLarge>()("TooLarge", {}) {}

/** How long an application's creation waits for git to open after a takeover. */
const GIT_OPEN_WAIT = Duration.seconds(10);

const DOOR_BODY_LIMIT = 8 * 1024;
const BODY_LIMIT = 64 * 1024;
/**
 * A change's description or a comment: 20 000 characters, which JSON may spell in up to six bytes
 * each (`\u0001`).
 */
const TEXT_BODY_LIMIT = 128 * 1024;

const DoorBody = Schema.Struct({ token: Schema.String });
const ChallengeBody = Schema.Struct({ projectId: Schema.String });
/** A Zerops token's id, as the platform spells one — never a token's value. */
const TokenId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/u));
/** A Zerops service's id, as the platform spells one. */
const ServiceId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/u));
const CredentialBody = Schema.Struct({
  projectId: Schema.String,
  nonce: Schema.String,
  keyTokenId: Schema.optionalKey(TokenId),
  serviceId: Schema.optionalKey(ServiceId),
});
const LogLimit = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
);
const decodeLogLimit = Schema.decodeUnknownEffect(LogLimit);
const KeyBody = Schema.Struct({ keyTokenId: TokenId });
const AppBody = Schema.Struct({ name: Schema.String });
const MoveBody = Schema.Struct({
  appId: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
});
// A Mate's name is its project's in Zerops (D3): a body that still names it, as a client before
// D3 sends one, is read without it.
const NewMateBody = Schema.Struct({
  projectId: Schema.String,
  face: Schema.String,
  standUp: Schema.optionalKey(Schema.Boolean),
  serviceId: Schema.optionalKey(ServiceId),
});
const MateBody = Schema.Struct({ face: Schema.String });
const AttachBody = Schema.Struct({
  projectId: Schema.String,
  kind: Schema.Literals(["mate", "devstage", "stage", "production"]),
  mate: Schema.optionalKey(
    Schema.Struct({
      face: Schema.String,
      standUp: Schema.optionalKey(Schema.Boolean),
      serviceId: Schema.optionalKey(ServiceId),
    }),
  ),
  environment: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  birth: Schema.optionalKey(Schema.String),
  created: Schema.optionalKey(Schema.Boolean),
});
/** A press held, or renewed, by the browser running it (`holdPress`). */
const PressBody = Schema.Struct({
  owner: Schema.String,
  kind: Schema.Literals(["mate", "stage", "production"]),
  appId: Schema.optionalKey(Schema.String),
  importProcessId: Schema.optionalKey(Schema.String),
  /** A renewal of its own live hold, never a first hold (`Structure.holdPress`). */
  renew: Schema.optionalKey(Schema.Boolean),
});
const BirthBody = Schema.Struct({
  appId: Schema.String,
  face: Schema.String,
  standUp: Schema.optionalKey(Schema.Boolean),
});
/**
 * A Zerops token as the platform spells one, at most 512 characters: one HQ sends on as a bearer
 * header, so a character no header may carry is refused here, never by the HTTP client later.
 */
const RedeployBody = Schema.Struct({ service: Schema.String, sha: Sha });
const AddServiceBody = Schema.Struct({ service: Schema.String });
const DeployTokenBody = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~+/=-]{1,512}$/u)),
});

const STRUCTURE_STATUS = {
  forbidden: 403,
  app_not_found: 404,
  project_not_found: 404,
  mate_not_found: 404,
  environment_not_found: 404,
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
  mate_credential_required: 401,
  key_not_its_own: 409,
  not_this_projects_mate: 409,
} as const;

const CHANGE_STATUS = {
  forbidden: 403,
  project_not_found: 404,
  app_not_found: 404,
  repo_not_found: 404,
  change_not_found: 404,
  attachment_not_found: 404,
  commit_not_found: 404,
  conflict: 409,
  invalid: 400,
  too_large: 413,
} as const;

const json = (body: unknown, status: number) => HttpServerResponse.jsonUnsafe(body, { status });

/** Try again: this Core does not lead now, Zerops did not answer, or a failure HQ cannot name. */
const unavailable = (code: string) =>
  HttpServerResponse.jsonUnsafe({ code }, { status: 503, headers: RETRY_AFTER });

const DEPLOY_STATUS = {
  forbidden: 403,
  environment_not_found: 404,
  deploy_not_found: 404,
  conflict: 409,
} as const;

const RELEASE_STATUS = {
  forbidden: 403,
  app_not_found: 404,
  release_not_found: 404,
  conflict: 409,
} as const;

const isStructureRefused = Schema.is(StructureRefused);
const isReleaseRefused = Schema.is(ReleaseRefused);
const isDeployRefused = Schema.is(DeployRefused);
const isChangeRefused = Schema.is(ChangeRefused);
const isMateRefused = Schema.is(MateRefused);
const isGitError = Schema.is(GitError);

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
  if (isReleaseRefused(error)) {
    return Effect.succeed(
      json({ code: error.code, reason: error.reason }, RELEASE_STATUS[error.code]),
    );
  }
  if (isDeployRefused(error)) {
    return Effect.succeed(
      json({ code: error.code, reason: error.reason }, DEPLOY_STATUS[error.code]),
    );
  }
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
  // A repository git quarantined (`gitHost.ts`): withheld until it converges, and why.
  if (isGitError(error) && error.reason === "unavailable") {
    return Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { code: "repo_unavailable", reason: error.message },
        { status: 503, headers: RETRY_AFTER },
      ),
    );
  }
  if (isMateRefused(error)) {
    return Effect.as(
      Effect.logInfo("mate refused", error),
      json({ code: error.code }, MATE_STATUS[error.code]),
    );
  }
  if (error._tag === "ObservationRefused" && "reason" in error) {
    const reason = String(error.reason);
    return Effect.succeed(
      json(
        { code: "observation_refused", reason },
        reason === "deploy_key_unavailable" ? 409 : 403,
      ),
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
      return Effect.as(
        Effect.logWarning("zerops read failed", error),
        // A write whose roles Zerops left unanswered wrote nothing: refused, never uncertain.
        unavailable(
          "operation" in error && error.operation === ROLES_UNANSWERED
            ? "zerops_unanswered"
            : "zerops_unavailable",
        ),
      );
    case "ZeropsRefused":
      // Zerops said no: no outage, so nothing tells the caller to try again.
      return Effect.as(
        Effect.logWarning("zerops refused", error),
        json({ code: "zerops_refused", reason: "reason" in error ? error.reason : undefined }, 403),
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

/**
 * A write's work, outliving its client (F22, 2026-10-03: a release whose client gave up at 20 s
 * went with it — Node's server interrupts a request's fiber when its client closes). Run once its
 * body is read, so nothing of the request is touched after the client left; its result is there
 * to read whether or not anybody hears its answer.
 */
const outliving = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* (yield* Writes).outliving(write);
  });

/**
 * The deploys an event its write made asks for, run (`Deploys.runOf`): an event done stays done,
 * so a run HQ could not finish answers why, and its jobs wait for the leading Core.
 */
const deploysOf = (event: RolloutCause) =>
  Effect.gen(function* () {
    return yield* (yield* Deploys).runOf(event);
  }).pipe(
    Effect.catch((error) =>
      Effect.as(Effect.logWarning("an event's deploys not run", { event, error }), {
        jobs: [],
        note: `HQ could not submit the deploys now (${error._tag}); they wait for the leading HQ`,
      }),
    ),
  );

/** A token of the client address's bucket at `door`; none left is `429`. */
const knock = (door: "person" | "mate" | "git") =>
  Effect.gen(function* () {
    // `X-Real-IP` is the client address the Zerops L7 balancer sets.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const address =
      request.headers["x-real-ip"] ?? Option.getOrElse(request.remoteAddress, () => "unknown");
    const limit = door === "person" ? PERSON_ADDRESS_LIMIT : DOOR_LIMIT;
    if (!(yield* (yield* DoorRateLimit).take(`${door} ${address}`, limit))) {
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

/** A repository as a path names it, `:repo`, and a comparison as its query asks it. */
const decodeRepositoryQuery = Schema.decodeUnknownEffect(RepositoryQuery);
const decodeRepoName = Schema.decodeUnknownEffect(RepoName);
const decodeChangeDetailQuery = Schema.decodeUnknownEffect(ChangeDetailQuery);

/** A recipe's tier as a path names it, `:tier`: `mate`, `stage` or `production`. */
const decodeRecipeTier = Schema.decodeUnknownEffect(RecipeTier);
const recipeTierOf = Effect.flatMap(HttpRouter.params, (params) =>
  decodeRecipeTier(params["tier"]),
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
 * A picture as a Mate sends it: the body itself, a supported raster Content-Type, at most 20 MiB — a
 * declared length above it refused before a byte is read.
 */
const pictureBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > ATTACHMENT_MAX_BYTES) {
    return yield* new TooLarge();
  }
  const declaredType = request.headers["content-type"]?.split(";")[0]?.trim();
  if (!RASTER_CONTENT_TYPES.some((type) => type === declaredType)) {
    return yield* new ChangeRefused({ code: "invalid", reason: "not_raster" });
  }
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(ATTACHMENT_MAX_BYTES)),
  );
  if (body.byteLength > ATTACHMENT_MAX_BYTES) return yield* new TooLarge();
  const content = new Uint8Array(body);
  if (rasterContentType(content) !== declaredType)
    return yield* new ChangeRefused({ code: "invalid", reason: "not_raster" });
  return content;
});

/** Git presents Basic auth: `mate:<credential>` or `person:<Git password>`. */
const gitCredential = (authorization: string | undefined) => {
  const encoded = /^Basic ([A-Za-z0-9+/=]+)$/u.exec(authorization ?? "")?.[1];
  const decoded = encoded === undefined ? "" : Buffer.from(encoded, "base64").toString("utf8");
  if (decoded.startsWith("mate:")) return { kind: "mate" as const, token: decoded.slice(5) };
  if (decoded.startsWith("person:")) return { kind: "person" as const, token: decoded.slice(7) };
  return undefined;
};

/**
 * HTTPS Git serves Mates and people. A person's independent, expiring password is scoped to its
 * application; every request asks the person's read/write rule, and never accepts a client
 * session as a Git password. Mate admission and write policy are unchanged.
 */
const serveGit = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const presented = gitCredential(request.headers["authorization"]);
  const holder: Option.Option<
    | { readonly kind: "mate"; readonly projectId: string }
    | (GitHolder & { readonly kind: "person" })
  > =
    presented === undefined
      ? Option.none()
      : presented.kind === "mate"
        ? Option.map(yield* (yield* MateCredentials).whoami(presented.token), (mate) => ({
            ...mate,
            kind: "mate" as const,
          }))
        : Option.map(yield* (yield* PersonGitCredentials).resolve(presented.token), (person) => ({
            ...person,
            kind: "person" as const,
          }));
  const found =
    Option.isSome(holder) &&
    (holder.value.kind === "mate" || holder.value.orgId === (yield* (yield* Roles).view).orgId);
  if (!found || Option.isNone(holder)) {
    // A credential presented and missed is a guess: limited per client address, like the doors.
    // git's first request of every command presents none, to be asked: that guesses nothing.
    if (presented !== undefined) yield* knock("git");
    return HttpServerResponse.text("Authentication required\n", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="HQ"' },
    });
  }
  const changes = yield* Changes;
  const own = holder.value;
  if (own.kind === "person") {
    const access = (appId: string, write = false) =>
      own.appId === appId
        ? changes.personGit(own.userId, appId, write)
        : Effect.fail(new ChangeRefused({ code: "forbidden", reason: "not_your_app" }));
    yield* (yield* GitHost).serve(
      request,
      ({ repo, service }) =>
        Effect.gen(function* () {
          const write = service === "git-receive-pack";
          yield* access(repo.appId, write);
          if (write) return { kind: "person", userId: own.userId, appId: own.appId } as const;
          return { kind: "reader", userId: own.userId } as const;
        }),
      (repo) => Effect.isSuccess(access(repo.appId)),
    );
  } else {
    const { projectId } = own;
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
  }
  return HttpServerResponse.empty();
});

const routes = (
  options: StreamOptions & {
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
            `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(appId, repo, n)}`,
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
          const search = new URL((yield* HttpServerRequest.HttpServerRequest).url, "http://hq")
            .searchParams;
          const query = yield* decodeChangeDetailQuery(Object.fromEntries(search));
          return json(
            yield* (yield* Changes).changeDetail(userId, appId, repo, number, query),
            200,
          );
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
          const { body } = yield* jsonBody(PostCommentRequest, TEXT_BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const { appId, repo, number } = yield* appChangePath;
              return json(
                yield* (yield* Changes).postComment(userId, appId, repo, number, body),
                200,
              );
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/changes/:repo/:n/merge",
      handle(
        Effect.gen(function* () {
          const { expectedHead } = yield* jsonBody(MergeChangeRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const { appId, repo, number } = yield* appChangePath;
              const change = yield* (yield* Changes).mergeChange(
                userId,
                appId,
                repo,
                number,
                expectedHead,
              );
              const deploys =
                change.mergedSha === null
                  ? NO_DEPLOYS
                  : yield* deploysOf({ cause: "merge", appId, repo, sha: change.mergedSha });
              return json({ ...change, deploys }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/changes/:repo/:n/close",
      handle(
        Effect.gen(function* () {
          const { expectedHead } = yield* jsonBody(CloseChangeRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const { appId, repo, number } = yield* appChangePath;
              return json(
                yield* (yield* Changes).closeChange(userId, appId, repo, number, expectedHead),
                200,
              );
            }),
          );
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
          const picture = yield* (yield* Changes).attachment(userId, appId, repo, number, id);
          // A picture is kept once and never changes; nosniff keeps it a picture.
          return HttpServerResponse.uint8Array(picture.content, {
            contentType: picture.contentType,
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
          const { projectId, nonce, ...named } = yield* jsonBody(CredentialBody, DOOR_BODY_LIMIT);
          const { credential, keyWiderMoved } = yield* (yield* MateCredentials).issue(
            projectId,
            nonce,
            named,
          );
          if (keyWiderMoved) yield* (yield* Structure).mateTouched(projectId);
          return json({ credential }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/git-credentials",
      handle(
        Effect.gen(function* () {
          const own = yield* principal;
          const appId = (yield* HttpRouter.params)["appId"] ?? "";
          return json(
            { credentials: yield* (yield* PersonGitCredentials).list({ ...own, appId }) },
            200,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/git-credentials",
      handle(
        outliving(
          Effect.gen(function* () {
            const own = yield* principal;
            const appId = (yield* HttpRouter.params)["appId"] ?? "";
            yield* (yield* Changes).personGit(own.userId, appId);
            return HttpServerResponse.jsonUnsafe(
              yield* (yield* PersonGitCredentials).issue({ ...own, appId }),
              { status: 201, headers: { "cache-control": "no-store" } },
            );
          }),
        ),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/api/apps/:appId/git-credentials/:id",
      handle(
        outliving(
          Effect.gen(function* () {
            const own = yield* principal;
            const params = yield* HttpRouter.params;
            yield* (yield* PersonGitCredentials).revoke(
              { ...own, appId: params["appId"] ?? "" },
              params["id"] ?? "",
            );
            return HttpServerResponse.empty({ status: 204 });
          }),
        ),
      ),
    ),
    HttpRouter.add("*", "/git/*", handle(serveGit)),
    HttpRouter.add(
      "POST",
      "/api/mate/repos",
      handle(
        Effect.gen(function* () {
          const { name } = yield* jsonBody(EnsureRepoRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { projectId } = yield* mate;
              return json(yield* (yield* Changes).ensureRepo(projectId, name), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/changes",
      handle(
        Effect.gen(function* () {
          const { repo, title, tree } = yield* jsonBody(OpenChangeRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { projectId } = yield* mate;
              return json(yield* (yield* Changes).openChange(projectId, repo, title, tree), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/mate/changes/:repo/:n",
      handle(
        Effect.gen(function* () {
          const edit = yield* jsonBody(EditChangeRequest, TEXT_BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { projectId } = yield* mate;
              const { repo, number } = yield* changePath;
              return json(yield* (yield* Changes).editChange(projectId, repo, number, edit), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mate/changes/:repo/:n/attachments",
      handle(
        Effect.gen(function* () {
          const content = yield* pictureBody;
          return yield* outliving(
            Effect.gen(function* () {
              const { projectId } = yield* mate;
              const { repo, number } = yield* changePath;
              return json(yield* (yield* Changes).attach(projectId, repo, number, content), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/recipe/:tier",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const tier = yield* recipeTierOf;
          return json(yield* (yield* Changes).mateRecipe(projectId, tier), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/recipe/:tier",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["appId"] ?? "";
          const tier = yield* recipeTierOf;
          return json(yield* (yield* Changes).readRecipe(userId, appId, tier), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/whoami",
      handle(Effect.map(mate, ({ projectId }) => json({ projectId }, 200))),
    ),
    HttpRouter.add(
      "PUT",
      "/api/mate/key",
      handle(
        Effect.gen(function* () {
          const { keyTokenId } = yield* jsonBody(KeyBody, DOOR_BODY_LIMIT);
          const { credential, projectId } = yield* mate;
          if (yield* (yield* MateCredentials).keepKey(credential, keyTokenId)) {
            yield* (yield* Structure).mateTouched(projectId);
          }
          return HttpServerResponse.empty();
        }),
      ),
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
          const socket = yield* upgradeSocket(request);
          const ended = yield* serveMateLink(socket, projectId, credential, options.link ?? {});
          yield* Effect.logInfo(
            `mate link of ${projectId} closed by ${ended.by} (${String(ended.code)})`,
          );
          return HttpServerResponse.empty();
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/environments/:projectId/services/:serviceId/logs",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const params = yield* HttpRouter.params;
          const url = new URL((yield* HttpServerRequest.HttpServerRequest).url, "http://hq");
          const limit = yield* decodeLogLimit(Number(url.searchParams.get("limit") ?? "100"));
          return json(
            yield* (yield* Observation).logs(
              projectId,
              params["projectId"] ?? "",
              params["serviceId"] ?? "",
              limit,
            ),
            200,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/environments",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          return json(yield* (yield* Observation).environments(projectId), 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mate/environments/:projectId",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* mate;
          const target = (yield* HttpRouter.params)["projectId"] ?? "";
          return json(yield* (yield* Observation).status(projectId, target), 200);
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
            ? json(
                {
                  ...state.value,
                  signers: state.value.signers ?? {},
                  ...(yield* (yield* Changes).mateChanges(projectId)),
                },
                200,
              )
            : json({ code: "mate_not_found", reason: "mate_not_found" }, 404);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mates/:projectId/closed-off",
      handle(
        outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
            return json(yield* (yield* Structure).markClosedOff(userId, projectId), 200);
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
          return HttpServerResponse.empty();
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps",
      handle(
        Effect.gen(function* () {
          const { name } = yield* jsonBody(AppBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              // Its recipe repository comes with it, and HQ answers once it is made: git, opening a
              // moment after the lead, is waited for before anything is written (`503 not_active`
              // past the wait, for the client to ask again). One that still fails is made on first
              // need.
              yield* (yield* GitHost).opened(GIT_OPEN_WAIT);
              const app = yield* (yield* Structure).createApp(userId, name);
              yield* (yield* Changes)
                .ensureGroupRepo(app.id)
                .pipe(
                  Effect.catch((error) => Effect.logWarning("recipe repository not made", error)),
                );
              return json(app, 201);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/api/apps/:id",
      handle(
        Effect.gen(function* () {
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const appId = (yield* HttpRouter.params)["id"] ?? "";
              yield* (yield* Structure).deleteApp(userId, appId);
              // Its repositories go after it; should they not now, they are only on disk, unnamed.
              yield* (yield* Changes)
                .removeAppRepos(appId)
                .pipe(
                  Effect.catch((error) => Effect.logWarning("repositories not removed", error)),
                );
              return HttpServerResponse.empty();
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:id/projects",
      handle(
        Effect.gen(function* () {
          const input = yield* jsonBody(AttachBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const appId = (yield* HttpRouter.params)["id"] ?? "";
              yield* (yield* Structure).attachProject(userId, appId, input);
              const deploys =
                input.kind === "stage" || input.kind === "production"
                  ? yield* deploysOf({ cause: "env_added", projectId: input.projectId, by: userId })
                  : NO_DEPLOYS;
              return json({ appId, projectId: input.projectId, kind: input.kind, deploys }, 201);
            }),
          );
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
            // Only a session HQ no longer takes ends it: one it cannot check now is still held.
            return yield* holderOf(token).pipe(
              Effect.as(undefined),
              Effect.catchTag("SessionRequired", () => Effect.succeed("session" as const)),
              Effect.orElseSucceed(() => undefined),
            );
          });
          const socket = yield* upgradeSocket(request);
          const ended = yield* serveHqSocket(socket, userId, ending, {
            ...options,
            ...(token === undefined ? {} : { sessionId: token }),
          });
          // Which side ended it says whether a cut was HQ's or the way's (F26).
          yield* Effect.logInfo(`structure socket closed by ${ended.by} (${String(ended.code)})`);
          return HttpServerResponse.empty();
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/apps/:id",
      handle(
        Effect.gen(function* () {
          const { name } = yield* jsonBody(AppBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const appId = (yield* HttpRouter.params)["id"] ?? "";
              return json(yield* (yield* Structure).renameApp(userId, appId, name), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/environments/:name/redeploy",
      handle(
        Effect.gen(function* () {
          const { service, sha } = yield* jsonBody(RedeployBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const params = yield* HttpRouter.params;
              const deploys = yield* (yield* Deploys).redeploy(
                userId,
                params["appId"] ?? "",
                params["name"] ?? "",
                service,
                sha,
              );
              return json({ deploys }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/environments/:name/services",
      handle(
        Effect.gen(function* () {
          const { service } = yield* jsonBody(AddServiceBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const params = yield* HttpRouter.params;
              const deploys = yield* (yield* Deploys).addService(
                userId,
                params["appId"] ?? "",
                params["name"] ?? "",
                service,
              );
              return json({ deploys }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/repos",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["appId"] ?? "";
          return json({ repos: yield* (yield* Changes).listRepos(userId, appId) }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/repos/:repo/source",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const params = yield* HttpRouter.params;
          const repo = yield* decodeRepoName(params["repo"]);
          const search = new URL((yield* HttpServerRequest.HttpServerRequest).url, "http://hq")
            .searchParams;
          const rev = search.get("rev");
          const query = yield* decodeRepositoryQuery({
            ...(rev === null ? {} : { rev }),
            path: search.get("path") ?? "",
            kind: search.get("kind") ?? "tree",
          });
          return json(
            yield* (yield* Changes).repositorySource(userId, params["appId"] ?? "", repo, query),
            200,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/apps/:appId/releases",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const appId = (yield* HttpRouter.params)["appId"] ?? "";
          return json({ releases: yield* (yield* Releases).list(userId, appId) }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/releases",
      handle(
        Effect.gen(function* () {
          const request = yield* jsonBody(CreateReleaseRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const appId = (yield* HttpRouter.params)["appId"] ?? "";
              const release = yield* (yield* Releases).release(userId, appId, request);
              const deploys = yield* deploysOf({
                cause: "release",
                appId,
                tag: release.tag,
                by: userId,
              });
              return json({ ...release, deploys }, 201);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/apps/:appId/releases/:tag/rollback",
      handle(
        Effect.gen(function* () {
          const request = yield* jsonBody(RollbackRequest, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const params = yield* HttpRouter.params;
              const appId = params["appId"] ?? "";
              const release = yield* (yield* Releases).rollback(
                userId,
                appId,
                params["tag"] ?? "",
                request,
              );
              const deploys = yield* deploysOf({
                cause: "release",
                appId,
                tag: release.tag,
                by: userId,
              });
              return json({ ...release, deploys }, 201);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/api/apps/:appId/environments/:name/deploy-token",
      handle(
        Effect.gen(function* () {
          const { token } = yield* jsonBody(DeployTokenBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const params = yield* HttpRouter.params;
              const { projectId } = yield* (yield* Structure).keepDeployToken(
                userId,
                params["appId"] ?? "",
                params["name"] ?? "",
                Redacted.make(token),
              );
              const deploys = yield* deploysOf({ cause: "key_kept", projectId, by: userId });
              return json({ deploys }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/lifecycle/:requestId",
      handle(
        Effect.gen(function* () {
          const intent = yield* jsonBody(HqLifecycleIntent, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const requestId = (yield* HttpRouter.params)["requestId"] ?? "";
              return json(yield* (yield* Structure).lifecycleWrite(userId, requestId, intent), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/lifecycle/:requestId",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const requestId = (yield* HttpRouter.params)["requestId"] ?? "";
          return json(
            { record: yield* (yield* Structure).lifecycleReceipt(userId, requestId) },
            200,
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/projects/:projectId/deletion",
      handle(
        outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
            return json(
              { completion: yield* (yield* Structure).prepareProjectDeletion(userId, projectId) },
              200,
            );
          }),
        ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/projects/:projectId/deleted",
      handle(
        Effect.gen(function* () {
          const { completion } = yield* jsonBody(
            Schema.Struct({ completion: Schema.String }),
            BODY_LIMIT,
          );
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
              yield* (yield* Structure).completeProjectDeletion(userId, projectId, completion);
              return json({ projectId }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/api/projects/:projectId/app",
      handle(
        Effect.gen(function* () {
          const target = yield* jsonBody(MoveBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
              return json(yield* (yield* Structure).moveProject(userId, projectId, target), 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/api/presses/:projectId",
      handle(
        Effect.gen(function* () {
          const press = yield* jsonBody(PressBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
              return json(yield* (yield* Structure).holdPress(userId, projectId, press), 200);
            }),
          );
        }),
      ),
    ),
    // A press that finished leaves no record; one that stopped ends its hold and keeps it.
    ...(
      [
        ["DELETE", "/api/presses/:projectId/:owner", true],
        ["POST", "/api/presses/:projectId/:owner/stopped", false],
      ] as const
    ).map(([method, path, finished]) =>
      HttpRouter.add(
        method,
        path,
        handle(
          outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const params = yield* HttpRouter.params;
              yield* (yield* Structure).endPress(userId, params["projectId"] ?? "", {
                owner: params["owner"] ?? "",
                finished,
              });
              return json({}, 200);
            }),
          ),
        ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/births",
      handle(
        Effect.gen(function* () {
          const birth = yield* jsonBody(BirthBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              return json(yield* (yield* Structure).recordBirth(userId, birth), 201);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "PUT",
      "/api/births/:birthId/project",
      handle(
        Effect.gen(function* () {
          const { projectId } = yield* jsonBody(
            Schema.Struct({ projectId: Schema.String }),
            BODY_LIMIT,
          );
          const birthId = (yield* HttpRouter.params)["birthId"] ?? "";
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              yield* (yield* Structure).bindBirth(userId, birthId, projectId);
              return json({ projectId }, 200);
            }),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/api/mates",
      handle(
        Effect.gen(function* () {
          const mate = yield* jsonBody(NewMateBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              return json(yield* (yield* Structure).createMate(userId, mate), 201);
            }),
          );
        }),
      ),
    ),
    // Finish setup took a widened key's sibling grants off: HQ reads the key again.
    HttpRouter.add(
      "POST",
      "/api/mates/:projectId/key-check",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
          if (yield* (yield* MateCredentials).recheckKey(userId, projectId)) {
            yield* (yield* Structure).mateTouched(projectId);
          }
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/api/mates/:projectId/key",
      handle(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
          const keyTokenId = yield* (yield* MateCredentials).keyFor(userId, projectId);
          return json({ keyTokenId }, 200);
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/api/mates/:projectId",
      handle(
        Effect.gen(function* () {
          const patch = yield* jsonBody(MateBody, BODY_LIMIT);
          return yield* outliving(
            Effect.gen(function* () {
              const { userId } = yield* principal;
              const projectId = (yield* HttpRouter.params)["projectId"] ?? "";
              return json(yield* (yield* Structure).patchMate(userId, projectId, patch), 200);
            }),
          );
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
  options: StreamOptions & {
    readonly link?: LinkOptions;
  },
) => Layer.mergeAll(routes(options), corsRoutes);

/**
 * The same CORS door on every route, including preflights that need no session: any origin, never
 * credentials.
 */
export const corsRoutes = HttpRouter.cors({
  allowedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["authorization", "content-type"],
  maxAge: 7200,
});
