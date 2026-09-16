/**
 * ZeropsThrowawayIdentity — the only credential this Mate's door takes.
 *
 * ## What is presented
 *
 * A **throwaway**: a Zerops integration token the app minted seconds ago as
 * the person, with `NO_ACCESS` at the org, no project grants, no flags, named
 * `mate-door:{this project}:{nonce}`, and deleted again as soon as this call
 * answers. It proves exactly one thing — *who made it* — and is worth nothing
 * to whoever captures it (measured 2026-09-15, ledger *A member's throwaway
 * token as their identity*: it cannot mint, raise itself, delete itself, or
 * read a project).
 *
 * That is the whole point. A person's own Zerops token reaches every org they
 * belong to and never expires, and this container is one its owner, its agent
 * and the code that agent runs can all change. Nothing of the person's stays
 * here, so there is nothing here to steal.
 *
 * ## The check, in order
 *
 * Each step's failure is a {@link ZeropsThrowawayRefusedError} naming the rule
 * it broke. The same six rules and the same order the org's broker applies
 * (`gitea-mate/docs/broker-api.md`, *Proving a person*), with the prefix
 * `mate-door:{projectId}:` where the broker uses `gitea-signin:{host}:`.
 *
 * 0. `GET /project/{own}` **with the Mate's own key** — the org this project
 *    belongs to, and this project's `userRoles`. Read first because the org is
 *    what step 2 asks about, and reading it from the presented token would be
 *    letting the token pick its own jurisdiction.
 * 1. `GET /user/info` **as the presented token** — its `id`. For an
 *    integration token that id is the token's own (measured); for a person's
 *    token it is the person's, which step 2 then refuses.
 * 2. `GET /client/{our org}/integration-token/{id}` **as the presented token**
 *    must answer `200` (`wrong_org`). A token from another org cannot read
 *    this org's tokens, and a personal token is not a token row at all.
 * 3. `roleCode == NO_ACCESS`, no project grants, **no flag of any kind**
 *    (`has_rights`). The flag rule is load-bearing rather than tidy: a token
 *    minted through a *delegation* names the delegating person as its creator,
 *    and every Mate's key carries a one-use delegation of exactly the shape
 *    `NO_ACCESS` + *can create projects* (measured, ledger *Zerops auth
 *    surface*) — so without it a Mate could mint a token that names its owner.
 *    A flagged token is not a throwaway, whoever made it.
 * 4. The name is `mate-door:{this project}:…` (`wrong_name`), so a throwaway
 *    captured at one Mate's door is not a pass to another.
 * 5. `created` is within five minutes of the **Zerops API's own `Date`
 *    response header** (`stale`) — never this container's clock, whose drift
 *    would lock every member out and whose occupant could set it back.
 * 6. `createdByUser` is an `ACTIVE` member of the org, read **with the Mate's
 *    own key** (`not_member`).
 *
 * The caller is `createdByUser`. Their effective role on this project — their
 * `userRoles` override there, or their org role — goes through the shared role
 * function (`@t3tools/shared/zeropsRoles`), the same one the app's list and
 * the broker's Gitea mirror call, so a person is never told one thing by the
 * list and another by the door.
 *
 * ## Refusing beats guessing
 *
 * Every read that fails for any reason other than a verdict — the API down, a
 * body that does not parse, no key of our own — is
 * {@link ZeropsApiUnavailableError}. None of them is ever an admission.
 *
 * @module ZeropsThrowawayIdentity
 */
import {
  effectiveProjectRole,
  zeropsRoleAnswer,
  ZEROPS_ACTIVE_MEMBER_STATUS,
  type RoleMateVisibility,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  readJson,
  responseDateEpochMs,
  unavailable,
  zeropsGet,
  ZeropsApiUnavailableError,
  ZeropsInvalidTokenError,
  ZeropsNotAMemberError,
  ZeropsProjectNotFoundError,
} from "./zeropsApiRead.ts";

/** The throwaway name every door credential carries, before its project id. */
export const DOOR_THROWAWAY_PREFIX = "mate-door";

/** How far a throwaway's `created` may be from the API's own clock. */
export const DOOR_THROWAWAY_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Which rule the presented credential broke.
 *
 * Kept off the wire deliberately: the HTTP surface answers one reason
 * (`zerops_throwaway_required`) for every one of them, because telling a
 * caller *which* of six shape rules their token failed is telling them how to
 * build a better one. The rule name is for this server's own tests and spans.
 */
export type ZeropsThrowawayRule =
  /** `/user/info` refused the presented token. */
  | "token_dead"
  /** The token is not a token of this org — or not an integration token at all. */
  | "wrong_org"
  /** It carries a role, a project grant or a flag. */
  | "has_rights"
  /** It is not named for this Mate. */
  | "wrong_name"
  /** It was minted more than five minutes ago, by the API's clock. */
  | "stale"
  /** Its creator is not an `ACTIVE` member of the org. */
  | "not_member";

/** The presented credential is not a throwaway minted for this Mate. */
export class ZeropsThrowawayRefusedError extends Schema.TaggedErrorClass<ZeropsThrowawayRefusedError>()(
  "ZeropsThrowawayRefusedError",
  {
    rule: Schema.String,
  },
) {}

/**
 * The caller is a `READ_ONLY` member here: the Mate is theirs to see in the
 * list and not to open (D5 — a conversation carries tool output, file contents
 * and whatever the agent printed, and that is the Mate's owner's).
 */
export class ZeropsReadOnlyError extends Schema.TaggedErrorClass<ZeropsReadOnlyError>()(
  "ZeropsReadOnlyError",
  {},
) {}

export type ZeropsThrowawayError =
  | ZeropsThrowawayRefusedError
  | ZeropsReadOnlyError
  | ZeropsNotAMemberError
  | ZeropsInvalidTokenError
  | ZeropsProjectNotFoundError
  | ZeropsApiUnavailableError;

/** Who the caller is, once the throwaway and their role are both proven. */
export interface ZeropsThrowawayCaller {
  /** The Zerops user id — the `subject` of the session minted for them. */
  readonly userId: string;
  /** The organisation that owns this project. */
  readonly clientId: string;
  /** Their effective role on this project, overrides included. */
  readonly role: ZeropsOrgRole;
}

const refused = (rule: ZeropsThrowawayRule): ZeropsThrowawayRefusedError =>
  new ZeropsThrowawayRefusedError({ rule });

const ProjectResponse = Schema.Struct({
  clientId: Schema.String,
  userRoles: Schema.optional(
    Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
  ),
});

const UserInfoResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
});

const decodeProject = Schema.decodeUnknownEffect(ProjectResponse);
const decodeUserInfo = Schema.decodeUnknownEffect(UserInfoResponse);

/**
 * The org's member list. The platform pages it under `items`; a bare array is
 * accepted too, and anything else is unusable rather than empty — an empty
 * member list would refuse everyone, which reads as a lockout rather than as
 * the outage it is.
 */
export function readMemberEntries(body: unknown): ReadonlyArray<unknown> | null {
  if (Array.isArray(body)) return body;
  if (typeof body !== "object" || body === null) return null;
  const items = (body as Record<string, unknown>)["items"];
  return Array.isArray(items) ? items : null;
}

/** Flags a throwaway must not carry. Any truthy one refuses the token. */
const TOKEN_FLAG_KEYS = [
  "canCreateProjects",
  "canManageFinances",
  "canManageFinance",
  "hasFinances",
] as const;

interface IntegrationTokenRecord {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly createdByUser: string;
  readonly roleCode: string;
  readonly hasGrants: boolean;
  readonly hasFlag: boolean;
}

/**
 * Reads a token record out of an unknown body. Anything missing makes the
 * record unusable (`null`), which the caller turns into a refusal rather than
 * a default.
 */
export function readIntegrationTokenRecord(body: unknown): IntegrationTokenRecord | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record["id"] !== "string" || record["id"].length === 0) return null;
  const projects = record["projects"];
  return {
    id: record["id"],
    name: typeof record["name"] === "string" ? record["name"] : "",
    created: typeof record["created"] === "string" ? record["created"] : "",
    createdByUser: typeof record["createdByUser"] === "string" ? record["createdByUser"] : "",
    roleCode: typeof record["roleCode"] === "string" ? record["roleCode"] : "",
    hasGrants: Array.isArray(projects) && projects.length > 0,
    hasFlag: TOKEN_FLAG_KEYS.some((key) => record[key] === true),
  };
}

export interface ZeropsOrgMember {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly clientUserId: string;
  readonly userId: string;
  readonly orgRole: string;
  readonly status: string;
  readonly canCreateProjects: boolean;
}

/** Every usable row of a member-list body, in the order the platform sent them. */
export function readOrgMembers(entries: ReadonlyArray<unknown>): ReadonlyArray<ZeropsOrgMember> {
  const members: Array<ZeropsOrgMember> = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const userId = record["userId"];
    if (typeof userId !== "string" || userId.length === 0) continue;
    members.push({
      clientUserId: typeof record["id"] === "string" ? record["id"] : "",
      userId,
      orgRole: typeof record["roleCode"] === "string" ? record["roleCode"] : "",
      status: typeof record["status"] === "string" ? record["status"] : "",
      canCreateProjects: record["canCreateProjects"] === true,
    });
  }
  return members;
}

/** Pulls the one member row a user id names out of a member-list body. */
export function findOrgMember(
  entries: ReadonlyArray<unknown>,
  userId: string,
): ZeropsOrgMember | null {
  return readOrgMembers(entries).find((member) => member.userId === userId) ?? null;
}

const KNOWN_ROLES: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];

const asOrgRole = (value: string): ZeropsOrgRole | undefined =>
  KNOWN_ROLES.find((role) => role === value);

/**
 * The effective role and the visibility it earns, from the shared role
 * function. The registry handed in is this one project: the door decides about
 * itself and nothing else, and `zeropsRoleAnswer` answers for every Mate in
 * whatever registry it is given.
 */
export function resolveDoorVisibility(input: {
  readonly projectId: string;
  readonly member: ZeropsOrgMember;
  readonly override: string | undefined;
}): { readonly role: ZeropsOrgRole; readonly visibility: RoleMateVisibility } {
  // A role neither side recognises is not a role: it reads as `NO_ACCESS`, so
  // an override the platform grew that this build has never heard of shuts the
  // door rather than opening it.
  const orgRole = asOrgRole(input.member.orgRole) ?? "NO_ACCESS";
  const override =
    input.override === undefined ? undefined : (asOrgRole(input.override) ?? "NO_ACCESS");
  const roleInput = {
    person: {
      id: input.member.userId,
      orgRole,
      status: input.member.status,
      canCreateProjects: input.member.canCreateProjects,
    },
    overrides: override === undefined ? {} : { [input.projectId]: override },
    registry: {
      groups: [
        {
          id: input.projectId,
          slug: input.projectId,
          projects: [{ id: input.projectId, kind: "mate" as const }],
        },
      ],
    },
  };
  const answer = zeropsRoleAnswer(roleInput);
  return {
    role: effectiveProjectRole(roleInput, input.projectId),
    visibility: answer.mates[input.projectId] ?? "hidden",
  };
}

/**
 * Proves that the presented credential is a throwaway minted for this Mate,
 * and resolves the role of the person who minted it.
 */
export const verifyThrowawayCaller = Effect.fn("ZeropsThrowaway.verifyCaller")(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly token: string;
}) {
  const { apiBaseUrl, projectId, apiToken } = input.environment;
  if (apiToken === undefined) {
    return yield* unavailable("This Mate has no Zerops key of its own to check a caller with.");
  }

  // 0. Our own project, with our own key: which org we belong to, and what
  //    this project says about people.
  const projectResponse = yield* zeropsGet({
    url: `${apiBaseUrl}/project/${encodeURIComponent(projectId)}`,
    token: apiToken,
  });
  switch (projectResponse.status) {
    case 200:
      break;
    case 400:
    case 404:
      return yield* new ZeropsProjectNotFoundError({});
    default:
      return yield* unavailable(
        `The Zerops API answered ${String(projectResponse.status)} for this Mate's own project.`,
      );
  }
  const project = yield* readJson(projectResponse).pipe(
    Effect.flatMap((body) => decodeProject(body)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(unavailable("This Mate's own project read carried no clientId.")),
    ),
  );

  // 1. Who the presented token is.
  const userInfoResponse = yield* zeropsGet({
    url: `${apiBaseUrl}/user/info`,
    token: input.token,
  });
  if (userInfoResponse.status === 401) return yield* new ZeropsInvalidTokenError({});
  if (userInfoResponse.status === 403) return yield* refused("token_dead");
  if (userInfoResponse.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${String(userInfoResponse.status)} for the caller's own read.`,
    );
  }
  const userInfo = yield* readJson(userInfoResponse).pipe(
    Effect.flatMap((body) => decodeUserInfo(body)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(unavailable("The Zerops user read was not in the expected shape.")),
    ),
  );
  const presentedId = userInfo.id ?? "";
  if (presentedId.length === 0) return yield* refused("token_dead");

  // 2. Its own record, in OUR org, read by itself. A token from another org
  //    cannot see this org's tokens, and a personal token is no token row.
  const tokenResponse = yield* zeropsGet({
    url: `${apiBaseUrl}/client/${encodeURIComponent(project.clientId)}/integration-token/${encodeURIComponent(presentedId)}`,
    token: input.token,
  });
  if (tokenResponse.status === 401) return yield* new ZeropsInvalidTokenError({});
  if (
    tokenResponse.status === 403 ||
    tokenResponse.status === 404 ||
    tokenResponse.status === 400
  ) {
    return yield* refused("wrong_org");
  }
  if (tokenResponse.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${String(tokenResponse.status)} for the presented token's record.`,
    );
  }
  // The API's own wall clock, from the very response that carried `created`.
  const apiNowMs = responseDateEpochMs(tokenResponse);
  const tokenBody = yield* readJson(tokenResponse);
  const record = readIntegrationTokenRecord(tokenBody);
  if (record === null) {
    return yield* unavailable("The presented token's record was not in the expected shape.");
  }

  // 3. No rights of any kind.
  if (record.roleCode !== "NO_ACCESS" || record.hasGrants || record.hasFlag) {
    return yield* refused("has_rights");
  }

  // 4. Named for this Mate.
  if (!record.name.startsWith(`${DOOR_THROWAWAY_PREFIX}:${projectId}:`)) {
    return yield* refused("wrong_name");
  }

  // 5. Minted seconds ago, by the API's clock and never by ours.
  if (apiNowMs === undefined) {
    return yield* unavailable("The Zerops API sent no Date header to judge the token's age by.");
  }
  const createdMs = Date.parse(record.created);
  if (!Number.isFinite(createdMs)) return yield* refused("stale");
  if (Math.abs(apiNowMs - createdMs) > DOOR_THROWAWAY_MAX_AGE_MS) {
    return yield* refused("stale");
  }

  // 6. Its creator, and whether the org still knows them.
  if (record.createdByUser.length === 0) return yield* refused("not_member");
  const memberResponse = yield* zeropsGet({
    url: `${apiBaseUrl}/client/${encodeURIComponent(project.clientId)}/user/list`,
    token: apiToken,
  });
  if (memberResponse.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${String(memberResponse.status)} for this org's member list.`,
    );
  }
  const entries = readMemberEntries(yield* readJson(memberResponse));
  if (entries === null) {
    return yield* unavailable("This org's member list was not in the expected shape.");
  }
  const member = findOrgMember(entries, record.createdByUser);
  if (member === null || member.status !== ZEROPS_ACTIVE_MEMBER_STATUS) {
    return yield* refused("not_member");
  }

  // The role function decides, on the same inputs the app's list and the
  // broker's mirror use.
  const override = project.userRoles?.find(
    (entry) => entry.clientUserId === member.clientUserId && member.clientUserId.length > 0,
  )?.roleCode;
  const { role, visibility } = resolveDoorVisibility({ projectId, member, override });
  if (visibility === "listed") return yield* new ZeropsReadOnlyError({});
  if (visibility !== "open") return yield* new ZeropsNotAMemberError({});

  return {
    userId: member.userId,
    clientId: project.clientId,
    role,
  } satisfies ZeropsThrowawayCaller;
});
