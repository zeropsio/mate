/**
 * The door a person comes through: the rules, with no I/O. HQ Core judges every caller by them; the
 * Mate server's door (`ZeropsThrowawayIdentity.ts`) judges a token's shape by
 * {@link checkDoorTokenShape} and resolves its creator against its own project.
 *
 * The person's app mints a **throwaway**: a Zerops integration token of their org with `NO_ACCESS`,
 * no project grant and no flag, named `mate-door:<door project id>:<nonce>`, seconds before it is
 * presented. It proves one thing, who made it, and is worth nothing to whoever captures it. The
 * caller reads its facts — the token's own record as the token itself, the API's `Date` header of
 * that answer, the org's member list with its own credential — and this decides, in this order:
 *
 * 1. `wrong_org`: the token is not of the door's org.
 * 2. `has_rights`: it carries a role, a project grant or any flag — `canCreateProjects`,
 *    `canViewFinances`, `canEditFinances`, the names the platform and zcp use.
 * 3. `wrong_name`: it is not named for this door.
 * 4. `stale`: its `created` is more than five minutes from the API's own clock, either way (never
 *    the caller's clock, whose drift would lock every member out).
 * 5. `not_member`: its creator is not an `ACTIVE` member of the org.
 *
 * Rules 2–4 need nothing of the org ({@link checkDoorTokenShape}): a caller runs them before
 * spending its own credential on the org's facts. No API clock, or an empty member list (an outage dressed as an answer: an org always has its
 * owner), is `unavailable`, never a refusal. A refused caller is told one reason for every rule;
 * the rule is for the caller's own log.
 *
 * @module zeropsDoor
 */

export const DOOR_PREFIX = "mate-door";

/** How far a throwaway's `created` may be from the API's own clock. */
export const DOOR_MAX_AGE_MS = 5 * 60 * 1000;

export interface DoorInput {
  readonly doorProjectId: string;
  /** The org the door's project belongs to, as read with the caller's own credential. */
  readonly orgId: string;
  /** The presented token's own record, read as the token itself. */
  readonly token: {
    readonly orgId: string;
    readonly name: string;
    readonly roleCode: string;
    readonly canCreateProjects: boolean;
    readonly canViewFinances: boolean;
    readonly canEditFinances: boolean;
    readonly projectGrants: number;
    readonly createdMs: number;
    readonly createdByUser: string | null;
  };
  /** The API's `Date` header on the answer that carried the record. */
  readonly apiNowMs: number | undefined;
  readonly members: ReadonlyArray<{ readonly userId: string; readonly status: string }>;
}

export type DoorRule = "wrong_org" | "has_rights" | "wrong_name" | "stale" | "not_member";

export type DoorVerdict =
  | { readonly kind: "admitted"; readonly userId: string }
  | { readonly kind: "refused"; readonly rule: DoorRule }
  | { readonly kind: "unavailable"; readonly reason: "no_api_clock" | "no_members" };

const refused = (rule: DoorRule): DoorVerdict => ({ kind: "refused", rule });

/** Rules 2–4, from the token's own record and the API's clock alone; `undefined` when they pass. */
export const checkDoorTokenShape = (
  input: Pick<DoorInput, "doorProjectId" | "token" | "apiNowMs">,
): Exclude<DoorVerdict, { readonly kind: "admitted" }> | undefined => {
  const { token } = input;
  if (
    token.roleCode !== "NO_ACCESS" ||
    token.projectGrants > 0 ||
    token.canCreateProjects ||
    token.canViewFinances ||
    token.canEditFinances
  ) {
    return { kind: "refused", rule: "has_rights" };
  }
  if (!token.name.startsWith(`${DOOR_PREFIX}:${input.doorProjectId}:`)) {
    return { kind: "refused", rule: "wrong_name" };
  }
  if (input.apiNowMs === undefined) return { kind: "unavailable", reason: "no_api_clock" };
  if (
    !Number.isFinite(token.createdMs) ||
    Math.abs(input.apiNowMs - token.createdMs) > DOOR_MAX_AGE_MS
  ) {
    return { kind: "refused", rule: "stale" };
  }
  return undefined;
};

export const checkDoorToken = (input: DoorInput): DoorVerdict => {
  const { token } = input;
  if (token.orgId !== input.orgId) return refused("wrong_org");
  const shape = checkDoorTokenShape(input);
  if (shape !== undefined) return shape;
  if (input.members.length === 0) return { kind: "unavailable", reason: "no_members" };
  const creator = input.members.find((member) => member.userId === token.createdByUser);
  if (token.createdByUser === null || creator?.status !== "ACTIVE") return refused("not_member");
  return { kind: "admitted", userId: token.createdByUser };
};
