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
 * it broke. Steps 3–5 are the door's token-shape rules, the one copy HQ's door
 * judges by too (`checkDoorTokenShape`, `@t3tools/shared/zeropsDoor`); this
 * server only reads the facts they judge.
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
 * 3. `roleCode == NO_ACCESS`, no project grants, **no flag** —
 *    `canCreateProjects`, `canViewFinances`, `canEditFinances` (`has_rights`).
 *    The flag rule is load-bearing rather than tidy: a token minted through a
 *    *delegation* names the delegating person as its creator, and every Mate's
 *    key carries a one-use delegation of exactly the shape `NO_ACCESS` + *can
 *    create projects* (measured, ledger *Zerops auth surface*) — so without it
 *    a Mate could mint a token that names its owner.
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
 * HQ call, so a person is never told one thing by the list and another by the
 * door.
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
  readOrgMembers,
  resolveDoorVisibility,
  type ZeropsOrgMember,
} from "@t3tools/shared/mateAccess";
import { checkDoorTokenShape, type DoorInput, type DoorRule } from "@t3tools/shared/zeropsDoor";
import { ZEROPS_ACTIVE_MEMBER_STATUS, type ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsIdentityStatus } from "./ZeropsIdentityStatus.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import { readMemberEntries, ZeropsOrgRead } from "./ZeropsOrgRead.ts";
import { ZeropsProjectAccess } from "./ZeropsProjectAccess.ts";
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
  /** The door's own rules (`@t3tools/shared/zeropsDoor`). */
  | DoorRule;

/** The presented credential is not a throwaway minted for this Mate. */
export class ZeropsThrowawayRefusedError extends Schema.TaggedError<ZeropsThrowawayRefusedError>()(
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
export class ZeropsReadOnlyError extends Schema.TaggedError<ZeropsReadOnlyError>()(
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
 * The presented token's own record, read in `orgId`, as the facts the door's
 * rules judge. A body without an `id` is no record (`null`); any other field
 * that is missing reads as what fails its rule — no role, no name, no
 * `created`, no creator — never as a pass. A flag is set only by `true`.
 */
function readTokenFacts(body: unknown, orgId: string): DoorInput["token"] | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record["id"] !== "string" || record["id"].length === 0) return null;
  const projects = record["projects"];
  const createdByUser = record["createdByUser"];
  return {
    orgId,
    name: typeof record["name"] === "string" ? record["name"] : "",
    roleCode: typeof record["roleCode"] === "string" ? record["roleCode"] : "",
    canCreateProjects: record["canCreateProjects"] === true,
    canViewFinances: record["canViewFinances"] === true,
    canEditFinances: record["canEditFinances"] === true,
    projectGrants: Array.isArray(projects) ? projects.length : 0,
    createdMs: typeof record["created"] === "string" ? Date.parse(record["created"]) : Number.NaN,
    createdByUser:
      typeof createdByUser === "string" && createdByUser.length > 0 ? createdByUser : null,
  };
}

/** Pulls the one member row a user id names out of a member-list body. */
export function findOrgMember(
  entries: ReadonlyArray<unknown>,
  userId: string,
): ZeropsOrgMember | null {
  return readOrgMembers(entries).find((member) => member.userId === userId) ?? null;
}

/**
 * Proves that the presented credential is a throwaway minted for this Mate,
 * and resolves the role of the person who minted it.
 */
export const verifyThrowawayCaller = Effect.fn("ZeropsThrowaway.verifyCaller")(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly token: string;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const mateKey = yield* ZeropsMateKey;
  const identityStatus = yield* ZeropsIdentityStatus;

  // 0. Our own project, with our own key: which org we belong to, and what
  //    this project says about people — read once for the door, the watch and
  //    the signers (`ZeropsOrgRead`). A `401`/`403` there re-resolves the key
  //    once before giving up — the platform may have moved it since this Mate
  //    started (spec-mate.md §2 root cause 4). This is also the read the
  //    descriptor's `identity` field reports (S4): whatever this call decides,
  //    `ZeropsIdentityStatus` learns it too.
  const orgRead = yield* ZeropsOrgRead;
  const own = yield* orgRead.project({ apiBaseUrl, projectId });
  yield* identityStatus.record({
    ok: own.kind === "answered" && own.status === 200,
    keySource: yield* mateKey.lastSource,
  });
  if (own.kind === "no-key") {
    return yield* unavailable("This Mate has no Zerops key of its own to check a caller with.");
  }
  if (own.kind === "unreachable") return yield* unavailable(own.reason);
  switch (own.status) {
    case 200:
      break;
    case 400:
    case 404:
      return yield* new ZeropsProjectNotFoundError({});
    default:
      return yield* unavailable(
        `The Zerops API answered ${String(own.status)} for this Mate's own project.`,
      );
  }
  const project = yield* decodeProject(own.body).pipe(
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(unavailable("This Mate's own project read carried no clientId.")),
    }),
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
    Effect.catchTags({
      SchemaError: () =>
        Effect.fail(unavailable("The Zerops user read was not in the expected shape.")),
    }),
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
  const token = readTokenFacts(tokenBody, project.clientId);
  if (token === null) {
    return yield* unavailable("The presented token's record was not in the expected shape.");
  }

  // 3–5. No rights, named for this Mate, minted seconds ago by the API's clock
  //      and never by ours: the door's own rules.
  const shape = checkDoorTokenShape({ doorProjectId: projectId, token, apiNowMs });
  if (shape?.kind === "refused") return yield* refused(shape.rule);
  if (shape?.kind === "unavailable") {
    return yield* unavailable("The Zerops API sent no Date header to judge the token's age by.");
  }

  // 6. Resolve its creator with one member-list read. A failed read stays
  // unavailable; the caller or the next membership sample owns another read.
  const createdByUser = token.createdByUser;
  if (createdByUser === null) return yield* refused("not_member");
  // HQ's relay while it holds (`ZeropsProjectAccess`, R6): a creator it opens for is let in,
  // and the member list is not read. Whomever it lists or leaves out, the read below decides —
  // its refusals tell a non-member from one this project hides or only lists.
  const relayed = Option.getOrUndefined(yield* (yield* ZeropsProjectAccess).relay);
  const opened = relayed?.members.find(
    (entry) => entry.userId === createdByUser && entry.visibility === "open",
  );
  if (opened !== undefined) {
    return {
      userId: opened.userId,
      clientId: project.clientId,
      role: opened.role,
    } satisfies ZeropsThrowawayCaller;
  }
  const members = yield* orgRead.members({ apiBaseUrl, clientId: project.clientId });
  if (members.kind === "unreachable") return yield* unavailable(members.reason);
  if (members.kind !== "answered" || members.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${members.kind === "answered" ? String(members.status) : "nothing"} for this org's member list.`,
    );
  }
  const entries = readMemberEntries(members.body);
  if (entries === null) {
    return yield* unavailable("This org's member list was not in the expected shape.");
  }
  // An empty list is an outage dressed as an answer, never a real org state —
  // a Mate's project always has at least its creator — so it is read the same
  // as an unreadable one, matching the watch (`ZeropsMembershipWatch.ts`) and
  // the signers gate (`ZeropsProjectSigners.ts`).
  if (entries.length === 0) {
    return yield* unavailable("This org's member list came back empty.");
  }
  const member = findOrgMember(entries, createdByUser);
  if (member === null || member.status !== ZEROPS_ACTIVE_MEMBER_STATUS) {
    return yield* refused("not_member");
  }

  // The role function decides, on the same inputs the app's list and HQ use.
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
