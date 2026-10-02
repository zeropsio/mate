/**
 * The Zerops REST reads Core makes, and nothing else. Every read takes the credential it runs as
 * and ends in one of two errors: {@link ZeropsRefused} when the platform said no (a verdict), or
 * {@link ZeropsUnavailable} when it could not be asked or did not answer usably (no verdict). A
 * failed read is never an empty answer.
 *
 * Two implementations pass one contract suite (`contract.test.ts`): the HTTP one (`http.ts`) and
 * the in-memory fake (`test/harness/zeropsFake.ts`).
 *
 * @module zerops/api
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** A member of the org; an integration token is one too (`kind: "token"`), named by its token name. */
export interface ZeropsMember {
  readonly name: string;
  readonly kind: "person" | "token";
  readonly roleCode: string;
  readonly status: string;
}

export interface ZeropsProject {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly status: string;
  readonly tags: ReadonlyArray<string>;
  /** Project grants: the member row (`clientUserId`) and its role on the project. */
  readonly userRoles: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>;
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
    /** `GET /user/info`, then the token's own record. Refused for a credential that is no token. */
    readonly ownToken: Read<ZeropsOwnToken>;
  }
>()("@t3tools/hq/zerops/api/ZeropsApi") {}
