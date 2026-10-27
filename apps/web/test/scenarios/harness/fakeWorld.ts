/**
 * The Zerops world the scenarios' fake Zerops API serves: org members, projects, tokens, services
 * and deploys, as Zerops's own records read.
 */
/** A member of the org; an integration token is one too (`kind: "token"`), named by its token name. */
export interface ZeropsMember {
  readonly name: string;
  readonly kind: "person" | "token";
  readonly roleCode: string;
  readonly status: string;
  readonly userId: string;
  /** The member row's own id: what a project's `userRoles` name. */
  readonly clientUserId: string;
  readonly canCreateProjects: boolean;
  /** Whether they see the org's billing (its costs whole), and change it; absent: no. */
  readonly canViewFinances?: boolean;
  readonly canEditFinances?: boolean;
  /**
   * The email they sign in to Zerops with, lower case; absent where Zerops did not say. HQ maps a
   * person on another service to a member by it (`githubGate.ts`, `slack.ts`), and never answers
   * it out.
   */
  readonly email?: string;
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

/** A service as the fake holds it: its record, changed in place by a deploy. */
export type FakeService = { -readonly [K in keyof ZeropsService]: ZeropsService[K] };

/** How a deploy's job ends at its first read: it runs, its build fails, or it is still at it. */
export type FakeOutcome = "ACTIVE" | "BUILD_FAILED" | "BUILDING";

export interface FakeAppVersion {
  readonly id: string;
  readonly serviceId: string;
  readonly name: string;
  status: string;
  archive: Uint8Array | undefined;
  zeropsYaml: string | undefined;
  setup: string | undefined;
}

export interface FakeWorld {
  /** Members by org id. */
  members: Map<string, Array<ZeropsMember>>;
  projects: Array<ZeropsProject>;
  /** Project env by project id. */
  env: Map<
    string,
    Array<{ readonly key: string; readonly value: string; readonly sensitive: boolean }>
  >;
  /** Integration tokens by their value; the fake's clock stamps `readAtMs` on each read. */
  tokens: Map<string, Omit<ZeropsOwnToken, "readAtMs">>;
  services: Array<FakeService>;
  appVersions: Map<string, FakeAppVersion>;
  /** How a version's deploy ends; `ACTIVE` unless it says otherwise. */
  outcome: (version: FakeAppVersion) => FakeOutcome;
  /** How an import's process ends at its next read: its services up, failed, or still running. */
  importOutcome: () => "FINISHED" | "FAILED" | "RUNNING";
  /** Every services import, as asked. */
  imports: Array<{ readonly projectId: string; readonly yaml: string }>;
}

export const emptyWorld = (): FakeWorld => ({
  members: new Map(),
  projects: [],
  env: new Map(),
  tokens: new Map(),
  services: [],
  appVersions: new Map(),
  outcome: () => "ACTIVE",
  importOutcome: () => "FINISHED",
  imports: [],
});
