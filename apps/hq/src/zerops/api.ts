import type { ObservationLogEntry } from "@t3tools/shared/hqObservation";
/**
 * The Zerops REST calls Core makes, and nothing else: the reads ({@link ZeropsApi}), and an
 * environment's deploy ({@link ZeropsDeploy}, SPEC §3.2b). Every call takes the credential it runs as
 * and ends in one of two errors: {@link ZeropsRefused} when the platform said no (a verdict), or
 * {@link ZeropsUnavailable} when it could not be asked or did not answer usably (no verdict). A
 * failed read is never an empty answer.
 *
 * Two implementations pass one contract suite (`contract.test.ts`): the HTTP one (`http.ts`) and
 * the in-memory fake (`test/harness/zeropsFake.ts`). The deploy's calls are the rig's own flow
 * (`nastroje/rig/hq-deploy.mjs`), measured with an environment's Basic user token on 2026-10-02.
 *
 * @module zerops/api
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** A member of the org; an integration token is one too (`kind: "token"`), named by its token name. */
export interface ZeropsMember {
  readonly avatarUrl?: string | null;
  readonly name: string;
  readonly kind: "person" | "token";
  readonly roleCode: string;
  readonly status: string;
  readonly userId: string;
  /** The member row's own id: what a project's `userRoles` name. */
  readonly clientUserId: string;
  readonly canCreateProjects: boolean;
}

export interface ZeropsProject {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly status: string;
  readonly tags: ReadonlyArray<string>;
  /** Project grants: the member row (`clientUserId`) and its role on the project. */
  readonly userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
  /**
   * The project's own domain (`<id>.<region>-zerops.zone`), the CNAME target every project has:
   * it resolves to the project's IPv6 and the shared IPv4, and serves once a public HTTP routing
   * names it.
   */
  readonly publicZone: string;
}

/** What the credential itself is, as its own token record says. */
export interface ZeropsOwnToken {
  readonly id: string;
  readonly name: string;
  readonly orgId: string;
  readonly roleCode: string;
  readonly canCreateProjects: boolean;
  readonly canViewFinances: boolean;
  readonly canEditFinances: boolean;
  readonly projects: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>;
  readonly createdMs: number;
  /** The user who minted it. */
  readonly createdByUser: string | null;
  /** The API's own clock (its `Date` header) on the answer that carried the record. */
  readonly readAtMs: number | undefined;
}

/**
 * A service of a project, as its own record reads (`GET /service-stack/{id}`): what it runs is the
 * version its last deploy named in its own variables (`appVersionId`, `appVersionName`) once that
 * version is the active one — they switch as the build starts, the active version when it runs.
 */
export interface ZeropsService {
  readonly id: string;
  readonly projectId: string;
  /** Its hostname. */
  readonly name: string;
  readonly status: string;
  /** The platform's own: every project's `core`, a build's stacks. */
  readonly isSystem: boolean;
  /** Whether it answers on its `zerops.app` subdomain. */
  readonly subdomainAccess: boolean;
  /** Whether it serves HTTP: a port of the scheme `http` or `https`, or routed as HTTP. */
  readonly http: boolean;
  /** The version whose build started last, as its deploy named it; none before any. */
  readonly named: { readonly id: string; readonly name: string } | null;
  /** The version it runs; none before it ran any. */
  readonly activeVersionId: string | null;
}

/** A platform job, as its record reads: a deploy's, a subdomain's. */
export interface ZeropsProcess {
  readonly status: "PENDING" | "RUNNING" | "FINISHED" | "FAILED" | "CANCELED";
  /** Why it failed, as the platform says it; none unless it did. */
  readonly failure: string | null;
}

export class ZeropsRefused extends Schema.TaggedError<ZeropsRefused>()("ZeropsRefused", {
  operation: Schema.String,
  reason: Schema.Literals(["unauthorized", "forbidden", "not_found", "invalid"]),
  status: Schema.Number,
  code: Schema.String,
}) {}

export class ZeropsUnavailable extends Schema.TaggedError<ZeropsUnavailable>()(
  "ZeropsUnavailable",
  { operation: Schema.String, message: Schema.String },
) {}

export type ZeropsError = ZeropsRefused | ZeropsUnavailable;

type Read<A> = (credential: Redacted.Redacted) => Effect.Effect<A, ZeropsError>;
type Write<A> = Read<A>;

export class ZeropsApi extends Context.Service<
  ZeropsApi,
  {
    /** `GET /client/{org}/user/list`: people and integration tokens. */
    readonly members: (orgId: string) => Read<ReadonlyArray<ZeropsMember>>;
    /** `GET /client/{org}/project`, every page. */
    readonly projects: (orgId: string) => Read<ReadonlyArray<ZeropsProject>>;
    readonly project: (projectId: string) => Read<ZeropsProject>;
    /** The project's env as the credential reads it: a sensitive value is `REDACTED` to Read only. */
    readonly projectEnv: (projectId: string) => Read<ReadonlyMap<string, string>>;
    /** Presence only, read by key; no variable content leaves this boundary. */
    readonly mateSetupMarker: (
      orgId: string,
      projectId: string,
      serviceId: string | null,
    ) => Read<boolean | null>;
    /** `GET /user/info`, then the token's own record. Refused for a credential that is no token. */
    readonly ownToken: Read<ZeropsOwnToken>;
    /**
     * `GET /client/{org}/integration-token/{id}`: what one token of the org grants, read by its id —
     * never its value. An org Read only token may read it (measured on KRLS 2026-10-03).
     */
    readonly tokenProjects: (
      orgId: string,
      tokenId: string,
    ) => Read<ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>>;
    /** `GET /project/{id}/service-stack`: the project's services, the platform's own among them. */
    readonly services: (projectId: string) => Read<ReadonlyArray<ZeropsService>>;
    /** `GET /service-stack/{id}`: one service, read directly — never from a search's index. */
    readonly service: (serviceId: string) => Read<ZeropsService>;
  }
>()("@t3tools/hq/zerops/api/ZeropsApi") {}

/**
 * An environment's deploy, with its own deploy token: an app version named for the commit, the
 * commit's archive uploaded to it, then built and deployed with the tier's setup; the job read
 * until it ends; the subdomain turned on after. A write is asked once: a retry could make a second
 * version; an answer lost is read back from the version HQ made (`deploys.ts`).
 */
export class ZeropsDeploy extends Context.Service<
  ZeropsDeploy,
  {
    /** `POST /service-stack/{id}/app-version` `{ name }`. */
    readonly createAppVersion: (serviceId: string, name: string) => Write<{ readonly id: string }>;
    /** `PUT /app-version/{id}/upload`: the archive, `application/octet-stream`. */
    readonly upload: (appVersionId: string, archive: Uint8Array) => Write<void>;
    /** `PUT /app-version/{id}/build-and-deploy` `{ zeropsYaml, zeropsYamlSetup }`: its job. */
    readonly buildAndDeploy: (
      appVersionId: string,
      zeropsYaml: string,
      setup: string,
    ) => Write<{ readonly processId: string }>;
    /** `GET /process/{id}`. */
    readonly process: (processId: string) => Read<ZeropsProcess>;
    /**
     * `GET /app-version/{id}`: where a version stands, by its `status` — `UPLOADING` until its build
     * is submitted, then building and deploying, `ACTIVE` once it runs (the one before goes
     * `BACKUP`), or one of the failures (measured 2026-09-16; the vocabulary is the SDK's).
     */
    readonly appVersion: (appVersionId: string) => Read<{ readonly status: string }>;
    /** `PUT /service-stack/{id}/enable-subdomain-access`: its job. */
    readonly enableSubdomainAccess: (serviceId: string) => Write<{ readonly processId: string }>;
    /**
     * `POST /project/{id}/service-stack/import` `{ yaml }`: services added to the project — what a
     * recipe delta imports (main D15); an environment's Basic user token may, as measured. The
     * services it made, by hostname, each with the processes bringing it up (measured
     * 2026-09-05): the handles its import is followed by.
     */
    readonly importServices: (
      projectId: string,
      yaml: string,
    ) => Write<{
      readonly services: ReadonlyArray<{
        readonly name: string;
        readonly processes: ReadonlyArray<string>;
      }>;
    }>;
  }
>()("@t3tools/hq/zerops/api/ZeropsDeploy") {}

/** Narrow observation reads: no platform environment or credential leaves HQ. */
export class ZeropsObservation extends Context.Service<
  ZeropsObservation,
  {
    readonly logs: (
      projectId: string,
      serviceId: string,
      limit: number,
    ) => Read<ReadonlyArray<ObservationLogEntry>>;
    readonly activeVersion: (id: string) => Read<{ readonly id: string; readonly name: string }>;
  }
>()("@t3tools/hq/zerops/api/ZeropsObservation") {}
