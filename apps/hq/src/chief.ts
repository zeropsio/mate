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
 * they are: zcp reads the log server itself. The org's costs answer whole a person who sees its
 * finances (`canViewFinances`), and anyone else their projects alone; resource use answers only
 * the person's projects. Who the person is — their name, org role and what it lets them do — is
 * HQ's own answer (`chief/person`), so the Chief never takes HQ's read-only token for its person.
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
  keepCosts,
  keepGroupBy,
  keepIdentity,
  keepSearch,
  pinGroupBy,
  pinSearch,
} from "./chiefProxy.ts";
import { ChiefRefused, confirmingChiefRefusal } from "./chiefRefused.ts";
import { CHIEF_TAG, chiefOfPerson, readsChiefProject } from "./chiefOwnership.ts";
import { type MateRecordState, Structure } from "./structure.ts";
import { lockProject } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { CHIEF_LIMIT, DOOR_LIMIT, DoorRateLimit, TooManyRequests } from "./rateLimit.ts";
import { Roles } from "./roles.ts";
import { type MateOverviewEntry, MateOverviews } from "./mateOverviews.ts";
import { mateOwner, recordedMateOwner } from "./usageAccess.ts";
import {
  ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  ZeropsRefused,
  ZeropsUnavailable,
  ZeropsUnexpectedAnswer,
} from "./zerops/api.ts";

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
    /** The source Mate's person and registered Chief, never a reader's. */
    readonly forMate: (projectId: string) => Effect.Effect<
      {
        readonly ownerUserId: string;
        readonly projectId: string;
      } | null,
      SqlError | ZeropsError
    >;
    /**
     * The person HQ records as the Mate's owner (`recordedMateOwner`) over HQ's last good view of
     * its org, or none: what the Mate's own link names, so its server refuses everyone else's acts.
     * Its signers are those of `mate`, the record the link sends beside it, as `overview` reports.
     */
    readonly ownerOf: (
      mate: MateRecordState,
      overview: MateOverviewEntry["overview"] | undefined,
    ) => Effect.Effect<string | null, SqlError | ZeropsError>;
    /** Binds an offer to its authenticated source Mate and current Chief. Sends nothing. */
    readonly propose: (
      projectId: string,
    ) => Effect.Effect<{ readonly id: string }, ChiefRefused | NotLeader | SqlError | ZeropsError>;
    /** Verifies an original Chief offer against current ownership before accepting a decision. */
    readonly authorizeProposal: (
      userId: string,
      id: string,
      sourceProjectId: string,
      chiefKind: boolean,
    ) => Effect.Effect<void, ChiefRefused | SqlError | ZeropsError>;
    /**
     * Marks `projectId` as the organisation's Chief, or moves the mark to it; its `since` stays
     * while it names the same project. Only an Owner or Admin, of a project the org has.
     */
    readonly mark: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<ChiefRecord, ChiefRefused | NotLeader | SqlError | ZeropsError>;
    /** Removes the organisation's mark: only an Owner or Admin. */
    readonly unmark: (
      userId: string,
    ) => Effect.Effect<void, ChiefRefused | NotLeader | SqlError | ZeropsError>;
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

/**
 * The person a Chief acts for, as HQ's view of the org has them (`chief/person`): what its own
 * reads, as HQ's read-only token, never say. A proposal they approve runs as them, by this role.
 */
const personOf = (member: ZeropsMember) => ({
  name: member.name,
  roleCode: member.roleCode,
  canViewFinances: member.canViewFinances === true,
  canEditFinances: member.canEditFinances === true,
  canCreateProjects: member.canCreateProjects,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const chiefsLayer = (options: {
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
}): Layer.Layer<
  Chiefs,
  never,
  | ChiefUpstream
  | DoorRateLimit
  | Leader
  | Roles
  | Structure
  | MateOverviews
  | SqlClient.SqlClient
  | ZeropsApi
> =>
  Layer.effect(
    Chiefs,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const structure = yield* Structure;
      const api = yield* ZeropsApi;
      const overviews = yield* MateOverviews;
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
      /**
       * Each of the org's services by its project, read as HQ: what keeps a person's costs to
       * their projects' services. Unread, it is empty, and every service's cost is dropped.
       */
      const servicesOfOrg = (orgId: string) =>
        forward({
          method: "POST",
          path: "service-stack/search",
          query: "",
          body: { search: [{ name: "clientId", operator: "eq", value: orgId }], limit: 1000 },
        }).pipe(
          Effect.map((answer) => {
            const projects = new Map<string, string>();
            if (answer.status < 200 || answer.status >= 300) return projects;
            const body = Option.getOrUndefined(decodeJson(new TextDecoder().decode(answer.body)));
            const items = isRecord(body) && Array.isArray(body["items"]) ? body["items"] : [];
            for (const item of items as ReadonlyArray<unknown>) {
              if (
                isRecord(item) &&
                item["clientId"] === orgId &&
                typeof item["id"] === "string" &&
                typeof item["projectId"] === "string"
              ) {
                projects.set(item["id"], item["projectId"]);
              }
            }
            return projects;
          }),
        );
      /** Zerops' answer as it sent it, unless a 2xx's body is to be kept to the person's reach. */
      const kept = (
        answer: UpstreamAnswer,
        keep: (body: unknown) => Option.Option<unknown>,
      ): Effect.Effect<ProxyAnswer, ZeropsUnexpectedAnswer> => {
        if (answer.status < 200 || answer.status >= 300) {
          return Effect.succeed({ kind: "raw", answer });
        }
        const body = Option.flatMap(decodeJson(new TextDecoder().decode(answer.body)), keep);
        return Option.isSome(body)
          ? Effect.succeed({ kind: "json", status: answer.status, body: body.value })
          : Effect.fail(
              new ZeropsUnexpectedAnswer({
                operation: "chief",
                message: "The Zerops API answered an unexpected shape.",
              }),
            );
      };

      const forMate = (projectId: string) =>
        Effect.gen(function* () {
          const facts = yield* roles.forWrite;
          const [mate] = yield* sql<{
            readonly signers: Readonly<Record<string, string>>;
            readonly madeBy: string | null;
            readonly standupRequestedBy: string | null;
          }>`SELECT signers, made_by AS "madeBy", standup_requested_by AS "standupRequestedBy"
          FROM hq_mate WHERE project_id = ${projectId}`;
          const ownerUserId = mateOwner({
            facts,
            projectId,
            mate,
            overview: (yield* overviews.all).get(projectId)?.overview,
          });
          if (ownerUserId === null) return null;
          const [chief] = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_chief WHERE org_id = ${facts.orgId}
          AND user_id = ${ownerUserId} AND revoked_at IS NULL`;
          return chiefOfPerson(
            facts,
            ownerUserId,
            new Map(chief === undefined ? [] : [[chief.project_id, ownerUserId]]),
          );
        });

      const ownerOf = (
        mate: MateRecordState,
        overview: MateOverviewEntry["overview"] | undefined,
      ) =>
        Effect.gen(function* () {
          const facts = yield* roles.view;
          const [row] = yield* sql<{
            readonly madeBy: string | null;
            readonly chiefOf: string | null;
          }>`SELECT m.made_by AS "madeBy",
            (SELECT c.user_id FROM hq_chief c WHERE c.org_id = ${facts.orgId}
              AND c.project_id = m.project_id AND c.revoked_at IS NULL LIMIT 1) AS "chiefOf"
          FROM hq_mate m WHERE m.project_id = ${mate.projectId}`;
          if (row === undefined) return null;
          return recordedMateOwner({
            chiefOf: row.chiefOf ?? undefined,
            facts,
            projectId: mate.projectId,
            mate: { ...mate, madeBy: row.madeBy },
            overview,
          });
        });

      return Chiefs.of({
        forMate,
        ownerOf,
        propose: (projectId) =>
          Effect.gen(function* () {
            const chief = yield* forMate(projectId);
            if (chief === null) return yield* refused("forbidden", "no_chief");
            const id = NodeCrypto.randomUUID();
            yield* leader.write(sql`INSERT INTO hq_chief_proposal (id, project_id, user_id, chief_project_id)
            VALUES (${id}, ${projectId}, ${chief.ownerUserId}, ${chief.projectId})`);
            return { id };
          }),
        authorizeProposal: (userId, id, projectId, chiefKind) =>
          Effect.gen(function* () {
            const [offer] = yield* sql<{
              readonly project_id: string;
              readonly user_id: string;
              readonly chief_project_id: string;
            }>`
            SELECT project_id, user_id, chief_project_id FROM hq_chief_proposal WHERE id = ${id}`;
            if (offer === undefined) {
              if (chiefKind) return yield* refused("forbidden", "unregistered_chief_proposal");
              return;
            }
            const chief = yield* forMate(projectId);
            if (
              offer.project_id !== projectId ||
              offer.user_id !== userId ||
              chief === null ||
              chief.ownerUserId !== userId ||
              chief.projectId !== offer.chief_project_id
            ) {
              return yield* refused("forbidden", "not_chiefs_person");
            }
          }),
        mine: (userId) =>
          Effect.gen(function* () {
            const facts = yield* roles.view;
            const { orgId } = facts;
            const [row] = yield* sql<{ readonly project_id: string; readonly since: string }>`
              SELECT project_id, ${since} AS since FROM hq_chief
              WHERE org_id = ${orgId} AND user_id = ${userId} AND revoked_at IS NULL`;
            return row === undefined ||
              chiefOfPerson(facts, userId, new Map([[row.project_id, userId]])) === null
              ? null
              : { projectId: row.project_id, since: row.since };
          }),
        mark: (userId, projectId) =>
          confirmingChiefRefusal(
            Effect.gen(function* () {
              const view = yield* roles.forWrite;
              const decision = can({ kind: "person", userId }, "mark_chief", null, view);
              if (!decision.allow) return yield* refused("forbidden", decision.reason);
              if (!view.projects.some((project) => project.id === projectId)) {
                return yield* refused("project_not_found", "project_gone");
              }
              const [row] = yield* leader.write(
                sql<{ readonly since: string }>`
                  INSERT INTO hq_chief_mark (org_id, project_id) VALUES (${view.orgId}, ${projectId})
                  ON CONFLICT (org_id) DO UPDATE SET project_id = EXCLUDED.project_id,
                    since = CASE WHEN hq_chief_mark.project_id = EXCLUDED.project_id
                      THEN hq_chief_mark.since ELSE now() END
                  RETURNING ${since} AS since`,
              );
              yield* structure.touched;
              return { projectId, since: row!.since };
            }),
          ),
        unmark: (userId) =>
          confirmingChiefRefusal(
            Effect.gen(function* () {
              const view = yield* roles.forWrite;
              const decision = can({ kind: "person", userId }, "mark_chief", null, view);
              if (!decision.allow) return yield* refused("forbidden", decision.reason);
              yield* leader.write(sql`DELETE FROM hq_chief_mark WHERE org_id = ${view.orgId}`);
              yield* structure.touched;
            }),
          ),
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
                    INSERT INTO hq_chief (credential_hash, org_id, user_id, project_id, app_id)
                    VALUES (${chiefCredentialHash(credential)}, ${view.orgId}, ${userId},
                      ${projectId}, (SELECT app_id FROM hq_app_project WHERE project_id = ${projectId}))
                    RETURNING ${since} AS since`;
                  return { projectId, since: row!.since };
                }),
              );
              yield* structure.mateTouched(projectId);
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
            const person = view.members.find(
              (member) => member.userId === userId && member.status === ZEROPS_ACTIVE_MEMBER_STATUS,
            );
            if (person === undefined) return yield* refused("forbidden", "not_active_member");
            // A credential is its Chief's only while that project stands, tagged a Chief's.
            const chiefProject = view.projects.find((project) => project.id === holder.project_id);
            if (chiefProject === undefined || !chiefProject.tags.includes(CHIEF_TAG)) {
              return yield* refused("forbidden", "not_chief_project");
            }
            const chiefs = new Map(
              (yield* sql<{ readonly project_id: string; readonly user_id: string }>`
              SELECT project_id, user_id FROM hq_chief WHERE org_id = ${view.orgId} AND revoked_at IS NULL`).map(
                (row) => [row.project_id, row.user_id] as const,
              ),
            );
            const mark =
              (yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_chief_mark WHERE org_id = ${view.orgId}`)[0]?.project_id ??
              null;
            const reaches = (projectId: string) =>
              readsChiefProject(view, userId, projectId, chiefs, mark);
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
              case "person":
                return { kind: "json", status: 200, body: personOf(person) };
              case "costs": {
                const pinned = pinSearch(request.body, view.orgId);
                if (Option.isNone(pinned)) return yield* refused("invalid", "not_a_search");
                const answer = yield* forward({
                  method: "POST",
                  path,
                  query: request.query,
                  body: pinned.value,
                });
                const all = person.canViewFinances === true;
                // Another person's services are kept by their projects: the org's, read as HQ.
                const serviceProject = all
                  ? new Map<string, string>()
                  : yield* servicesOfOrg(view.orgId);
                return yield* kept(answer, (body) =>
                  keepCosts(body, { reaches, all, serviceProject }),
                );
              }
              case "groupBy": {
                const pinned = pinGroupBy(request.body, view.orgId);
                if (Option.isNone(pinned)) return yield* refused("invalid", "not_a_search");
                return yield* kept(
                  yield* forward({
                    method: "POST",
                    path,
                    query: request.query,
                    body: pinned.value,
                  }),
                  (body) =>
                    keepGroupBy(body, {
                      reaches,
                      all: read.of === "cost" && person.canViewFinances === true,
                    }),
                );
              }
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
