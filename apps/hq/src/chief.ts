// @effect-diagnostics nodeBuiltinImport:off -- a credential is 256 bits from the system's CSPRNG.
/**
 * A person's Chief: their own Mate for the whole organization, a coding agent in its own project's
 * zcp container, whose project carries the tag {@link CHIEF_TAG}. One per person in an org — it
 * spends that person's agent subscription.
 *
 * A person registers their Chief's project (`register`) — one that opens for them (Basic user or
 * above there, `observe_mate`'s rule) and carries the tag — and is answered a Chief credential,
 * once: 256 random bits HQ keeps only as its SHA-256, as a Mate's (`mateCredentials.ts`). A project
 * is one person's Chief: another's registration of it is a conflict. A person's next registration,
 * of the same project or another, revokes the credential before it.
 *
 * The container holds that credential instead of a token, and reads Zerops through HQ's proxy
 * (`proxy`) as HQ, with HQ's own `HQ_ORG_TOKEN` (org Read only): only the reads zcp's org mode
 * makes (`chiefProxy.ts`), every search pinned to HQ's org, and every answer kept to the projects
 * the Chief's person reads (`read_project`: their grant there, else their org role, Read only or
 * above) — a search's items filtered, a read by id outside them refused. The person must be an
 * active member of the org on every call, over the view every reader shares (`roles.ts`, at most
 * 30 s old). A log access is Zerops' own answer, its log server's address and token passed on as
 * they are: zcp reads the log server itself.
 *
 * @module chief
 */
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";

import {
  ChiefUpstream,
  type UpstreamAnswer,
  chiefPath,
  chiefRead,
  keepIdentity,
  keepSearch,
  pinSearch,
} from "./chiefProxy.ts";
import { ChiefRefused, confirmingChiefRefusal } from "./chiefRefused.ts";
import { lockProject } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { CHIEF_LIMIT, DOOR_LIMIT, DoorRateLimit, TooManyRequests } from "./rateLimit.ts";
import { Roles } from "./roles.ts";
import { ZeropsApi, type ZeropsError, ZeropsRefused, ZeropsUnavailable } from "./zerops/api.ts";

/** The tag a Chief's project carries. */
export const CHIEF_TAG = "chief";

/** Where HQ serves the proxy, under its own address. */
export const CHIEF_PROXY_PATH = "/api/chief/zerops";

/** A person's Chief as HQ holds it. */
export interface ChiefRecord {
  readonly projectId: string;
  /** When it was registered, ISO. */
  readonly since: string;
}

/** A request to the proxy, as it arrived. */
export interface ProxyRequest {
  /** The credential its `Authorization: Bearer` presents; none without one. */
  readonly presented: string | undefined;
  /** Its client's address: a credential missed is limited per address. */
  readonly address: string;
  readonly method: string;
  /** The path after the proxy's own. */
  readonly path: string;
  /** Its query, without the `?`. */
  readonly query: string;
  /** Its body as JSON; none for a GET. */
  readonly body: unknown;
}

/** The proxy's answer: Zerops' own, as it sent it, or a search's kept to the person's reach. */
export type ProxyAnswer =
  | { readonly kind: "raw"; readonly answer: UpstreamAnswer }
  | { readonly kind: "json"; readonly status: number; readonly body: unknown };

export class Chiefs extends Context.Service<
  Chiefs,
  {
    /** `userId`'s Chief in this org; none unregistered. */
    readonly mine: (userId: string) => Effect.Effect<ChiefRecord | null, SqlError | ZeropsError>;
    /** Registers `projectId` as `userId`'s Chief: its credential, once, and the proxy's address. */
    readonly register: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<
      { readonly chief: ChiefRecord; readonly credential: string; readonly proxyUrl: string },
      ChiefRefused | NotLeader | SqlError | ZeropsError
    >;
    /** One read through the proxy. */
    readonly proxy: (
      request: ProxyRequest,
    ) => Effect.Effect<ProxyAnswer, ChiefRefused | TooManyRequests | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/chief/Chiefs") {}

/** A credential's hash, the only form HQ keeps it in. */
export const chiefCredentialHash = (credential: string) =>
  NodeCrypto.createHash("sha256").update(credential).digest("hex");

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const chiefsLayer = (options: {
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
}): Layer.Layer<
  Chiefs,
  never,
  ChiefUpstream | DoorRateLimit | Leader | Roles | SqlClient.SqlClient | ZeropsApi
> =>
  Layer.effect(
    Chiefs,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const api = yield* ZeropsApi;
      const upstream = yield* ChiefUpstream;
      const limits = yield* DoorRateLimit;
      const since = sql.literal(ISO("since"));
      const own = Effect.fromOption(options.credential).pipe(
        Effect.mapError(
          () =>
            new ZeropsRefused({
              operation: "chief",
              reason: "unauthorized",
              status: 0,
              code: "noCredential",
            }),
        ),
      );
      const refused = (code: ChiefRefused["code"], reason?: string) =>
        Effect.fail(new ChiefRefused({ code, ...(reason === undefined ? {} : { reason }) }));
      const forward = (request: Parameters<ChiefUpstream["Service"]["forward"]>[0]) =>
        Effect.flatMap(own, upstream.forward(request));
      /** Zerops' answer as it sent it, unless a 2xx's body is to be kept to the person's reach. */
      const kept = (
        answer: UpstreamAnswer,
        keep: (body: unknown) => Option.Option<unknown>,
      ): Effect.Effect<ProxyAnswer, ZeropsUnavailable> => {
        if (answer.status < 200 || answer.status >= 300) {
          return Effect.succeed({ kind: "raw", answer });
        }
        const body = Option.flatMap(decodeJson(new TextDecoder().decode(answer.body)), keep);
        return Option.isSome(body)
          ? Effect.succeed({ kind: "json", status: answer.status, body: body.value })
          : Effect.fail(
              new ZeropsUnavailable({
                operation: "chief",
                message: "The Zerops API answered an unexpected shape.",
              }),
            );
      };

      return Chiefs.of({
        mine: (userId) =>
          Effect.gen(function* () {
            const { orgId } = yield* roles.view;
            const [row] = yield* sql<{ readonly project_id: string; readonly since: string }>`
              SELECT project_id, ${since} AS since FROM hq_chief
              WHERE org_id = ${orgId} AND user_id = ${userId} AND revoked_at IS NULL`;
            return row === undefined ? null : { projectId: row.project_id, since: row.since };
          }),
        register: (userId, projectId) =>
          confirmingChiefRefusal(
            Effect.gen(function* () {
              const view = yield* roles.forWrite;
              const decision = can({ kind: "person", userId }, "observe_mate", { projectId }, view);
              if (!decision.allow) return yield* refused("forbidden", decision.reason);
              const project = view.projects.find((candidate) => candidate.id === projectId);
              if (project === undefined || !project.tags.includes(CHIEF_TAG)) {
                return yield* refused("forbidden", "not_chief_project");
              }
              const hq = view.projects.find((candidate) => candidate.id === options.hqProjectId);
              if (hq === undefined) {
                return yield* new ZeropsUnavailable({
                  operation: "chief",
                  message: "HQ's own project is not in its org's view.",
                });
              }
              const credential = NodeCrypto.randomBytes(32).toString("base64url");
              const chief = yield* leader.write(
                Effect.gen(function* () {
                  // The project first, then the person: two registrations of either are decided
                  // one after the other, each on what the one before left.
                  yield* lockProject(sql, projectId);
                  yield* lockProject(sql, `chief-person:${view.orgId}:${userId}`);
                  const [holder] = yield* sql<{ readonly user_id: string }>`
                    SELECT user_id FROM hq_chief
                    WHERE project_id = ${projectId} AND revoked_at IS NULL`;
                  if (holder !== undefined && holder.user_id !== userId) {
                    return yield* refused("conflict", "another_persons_chief");
                  }
                  yield* sql`
                    UPDATE hq_chief SET revoked_at = now()
                    WHERE org_id = ${view.orgId} AND user_id = ${userId} AND revoked_at IS NULL`;
                  const [row] = yield* sql<{ readonly since: string }>`
                    INSERT INTO hq_chief (credential_hash, org_id, user_id, project_id)
                    VALUES (${chiefCredentialHash(credential)}, ${view.orgId}, ${userId},
                      ${projectId})
                    RETURNING ${since} AS since`;
                  return { projectId, since: row!.since };
                }),
              );
              return {
                chief,
                credential,
                proxyUrl: `https://${hq.publicZone}${CHIEF_PROXY_PATH}`,
              };
            }),
          ),
        proxy: (request) =>
          Effect.gen(function* () {
            const hash =
              request.presented === undefined ? undefined : chiefCredentialHash(request.presented);
            const [holder] =
              hash === undefined
                ? []
                : yield* sql<{
                    readonly org_id: string;
                    readonly user_id: string;
                    readonly project_id: string;
                  }>`
                    SELECT org_id, user_id, project_id FROM hq_chief
                    WHERE credential_hash = ${hash} AND revoked_at IS NULL`;
            const view = yield* roles.view;
            if (holder === undefined || hash === undefined || holder.org_id !== view.orgId) {
              // A credential presented and missed is a guess: limited per client address.
              if (
                request.presented !== undefined &&
                !(yield* limits.take(`chief ${request.address}`, DOOR_LIMIT))
              ) {
                return yield* new TooManyRequests();
              }
              return yield* refused("chief_credential_required");
            }
            if (!(yield* limits.take(`chief-credential ${hash}`, CHIEF_LIMIT))) {
              return yield* new TooManyRequests();
            }
            const userId = holder.user_id;
            if (
              !view.members.some(
                (member) =>
                  member.userId === userId && member.status === ZEROPS_ACTIVE_MEMBER_STATUS,
              )
            ) {
              return yield* refused("forbidden", "not_active_member");
            }
            // A credential is its Chief's only while that project stands, tagged a Chief's.
            const chiefProject = view.projects.find((project) => project.id === holder.project_id);
            if (chiefProject === undefined || !chiefProject.tags.includes(CHIEF_TAG)) {
              return yield* refused("forbidden", "not_chief_project");
            }
            const reaches = (projectId: string) =>
              can({ kind: "person", userId }, "read_project", { projectId }, view).allow;
            const read = chiefRead(request.method, request.path);
            if ("refused" in read) {
              return yield* read.refused === "method"
                ? refused("method_not_allowed")
                : refused("forbidden", "not_allowed");
            }
            const path = chiefPath(request.path);
            switch (read.kind) {
              case "identity":
                return yield* kept(
                  yield* forward({ method: "GET", path, query: request.query }),
                  (body) => keepIdentity(body, view.orgId),
                );
              case "catalogue":
                return {
                  kind: "raw",
                  answer: yield* forward({
                    method: "POST",
                    path,
                    query: request.query,
                    body: request.body,
                  }),
                };
              case "search": {
                const pinned = pinSearch(request.body, view.orgId);
                if (Option.isNone(pinned)) return yield* refused("invalid", "not_a_search");
                return yield* kept(
                  yield* forward({
                    method: "POST",
                    path,
                    query: request.query,
                    body: pinned.value,
                  }),
                  (body) => keepSearch(body, { orgId: view.orgId, of: read.of, reaches }),
                );
              }
              case "project":
                if (!reaches(read.projectId)) return yield* refused("forbidden", "not_in_reach");
                return {
                  kind: "raw",
                  answer: yield* forward({ method: "GET", path, query: request.query }),
                };
              case "service": {
                // Its project read by its id with HQ's own credential: one Zerops will not show
                // HQ is no service the person reads.
                const projectId = yield* Effect.flatMap(own, api.service(read.serviceId)).pipe(
                  Effect.map((service) => service.projectId),
                  Effect.catchTags({
                    ZeropsRefused: (error) =>
                      error.reason === "not_found" || error.reason === "forbidden"
                        ? Effect.succeed(undefined)
                        : Effect.fail(error),
                  }),
                );
                if (projectId === undefined || !reaches(projectId)) {
                  return yield* refused("forbidden", "not_in_reach");
                }
                return {
                  kind: "raw",
                  answer: yield* forward({ method: "GET", path, query: request.query }),
                };
              }
            }
          }),
      });
    }),
  );
