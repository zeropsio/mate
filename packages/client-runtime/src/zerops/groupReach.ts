/**
 * A Mate's group is its token.
 *
 * The problem this replaces: an agent inside a `zcp` container could see
 * exactly one project, because the integration token the platform mints for
 * that container grants `ADMIN` on its own project and nothing else. So a Mate
 * asked to ship something could not learn that its group had a production
 * environment at all — measured 2026-09-06, one concluded there was nowhere to
 * run anything and provisioned a runtime and a database of its own.
 *
 * The obvious fix is to write the group into the container's environment. That
 * is a **copy**, and a copy has two structural faults: it goes stale silently
 * (a renamed group, a new stage, a service added to production all leave the
 * Mate confidently reporting last week's shape), and a service env write
 * reaches new processes only, so every refresh costs a container restart.
 *
 * So do not copy the fact across the boundary — move the boundary. The
 * platform already knows the group; what stopped the agent from asking was
 * authority, not information. Widen the container's own token to the group:
 *
 * - `ADMIN` on the project it lives in, exactly as before;
 * - `READ_ONLY` on every other project in the group.
 *
 * Then `zerops_*` and `zcli` answer for the whole group, the answer is the
 * platform's own and cannot be stale, and there is nothing to write into an
 * environment and nothing to restart.
 *
 * ## Why `READ_ONLY`, and why that is the interesting half
 *
 * `READ_ONLY` is a real platform role (`OWNER`, `ADMIN`, `BASIC_USER`,
 * `READ_ONLY`, `NO_ACCESS`). With it, a Mate reads a sibling's project and
 * services and is refused anything that changes them — `PUT
 * /service-stack/{id}/restart` on a production service answers **403**
 * (measured 2026-09-06). The rule "deploy to production through the
 * repository's pipeline, never directly" stops being a sentence in a markdown
 * file that an agent may or may not honour, and becomes something the platform
 * enforces.
 *
 * ## Reach changes in place
 *
 * `PUT /client/{clientId}/integration-token/{tokenId}` rewrites an existing
 * token's grants, and the **same token string** — the one already in the
 * container's environment — loses and gains sight of a sibling immediately
 * (measured: 200 → 403 → 200 across two writes, no new token, no restart).
 * That is what makes this maintainable rather than a one-time seeding: group
 * membership changes are a single call against a token that never moves.
 *
 * Nothing here reaches a network (rule R1): the caller performs the write.
 *
 * @module groupReach
 */

/** The platform's project roles, as its own validation error enumerates them. */
export type ZeropsProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS";

/** The platform names a dev container's token after the project it serves. */
const ZCP_TOKEN_NAME_PREFIX = "zcp-";

export interface ZeropsProjectGrant {
  readonly projectId: string;
  readonly roleCode: ZeropsProjectRole;
}

export interface ZeropsIntegrationToken {
  readonly id: string;
  readonly name: string;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant> | undefined;
}

/**
 * The token that belongs to a Mate's container, out of every token on the
 * account.
 *
 * Both halves of the test are needed. The name alone is not enough: it is
 * `zcp-<project name>` at mint time and a project can be renamed afterwards.
 * The grant alone is not enough either — a deploy token scoped to one project
 * looks identical by that test. Together they are unambiguous, and they stay
 * true after this module has widened the token, because the match is "grants
 * ADMIN on this project", never "grants only this project".
 */
export function findMateIntegrationToken(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return tokens.find(
    (token) =>
      token.name.startsWith(ZCP_TOKEN_NAME_PREFIX) &&
      (token.projects ?? []).some(
        (grant) => grant.projectId === projectId && grant.roleCode === "ADMIN",
      ),
  );
}

/**
 * What a Mate's token should grant: `ADMIN` on its own project, `READ_ONLY` on
 * the rest of its group, in a fixed order so an unchanged group produces an
 * identical document.
 *
 * The Mate's own project is always first and always `ADMIN`, whatever the
 * caller passed in the group — a Mate that lost write access to the project it
 * lives in could not do its job, and no group edit may cause that.
 */
export function buildGroupGrants(input: {
  readonly selfProjectId: string;
  readonly groupProjectIds: ReadonlyArray<string>;
}): ReadonlyArray<ZeropsProjectGrant> {
  const siblings = [...new Set(input.groupProjectIds)]
    .filter((projectId) => projectId !== input.selfProjectId)
    .sort();
  return [
    { projectId: input.selfProjectId, roleCode: "ADMIN" },
    ...siblings.map((projectId): ZeropsProjectGrant => ({ projectId, roleCode: "READ_ONLY" })),
  ];
}

function sameGrants(
  left: ReadonlyArray<ZeropsProjectGrant>,
  right: ReadonlyArray<ZeropsProjectGrant>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (grant, index) =>
      grant.projectId === right[index]?.projectId && grant.roleCode === right[index]?.roleCode,
  );
}

/**
 * The write to make, or `undefined` when the token already reaches exactly its
 * group — so opening a screen that reconciles this is not a write, and a group
 * that has not moved is not touched.
 *
 * Comparison is order-insensitive on the token's side: the platform returns
 * grants in its own order, and re-sorting it before comparing is what keeps an
 * unchanged group from being rewritten on every read.
 */
export function planGroupReach(input: {
  readonly token: ZeropsIntegrationToken;
  readonly selfProjectId: string;
  readonly groupProjectIds: ReadonlyArray<string>;
}): { readonly tokenId: string; readonly projects: ReadonlyArray<ZeropsProjectGrant> } | undefined {
  const wanted = buildGroupGrants({
    selfProjectId: input.selfProjectId,
    groupProjectIds: input.groupProjectIds,
  });
  const current = [...(input.token.projects ?? [])].sort((left, right) =>
    left.projectId === input.selfProjectId
      ? -1
      : right.projectId === input.selfProjectId
        ? 1
        : left.projectId.localeCompare(right.projectId),
  );
  if (sameGrants(current, wanted)) return undefined;
  return { tokenId: input.token.id, projects: wanted };
}

/** One group, as the reconcile sees it: who is in it, and which are Mates. */
export interface ZeropsGroupReachGroup {
  /** Every project in the group, Mates included. */
  readonly projectIds: ReadonlyArray<string>;
  /** The projects that hold a Mate — the only ones with a token to widen. */
  readonly mateProjectIds: ReadonlyArray<string>;
}

export interface ZeropsGroupReachWrite {
  readonly tokenId: string;
  readonly name: string;
  readonly projects: ReadonlyArray<ZeropsProjectGrant>;
}

/**
 * Every token write the account needs, and no others.
 *
 * Safe to run on every read of the projects screen, which is the point: this
 * changes a token's grants and never a container's environment, so nothing
 * restarts and a group that has not moved produces an empty list. A Mate whose
 * token cannot be found is skipped rather than guessed at — an account can
 * hold a container this client did not create.
 */
export function planAccountGroupReach(input: {
  readonly groups: ReadonlyArray<ZeropsGroupReachGroup>;
  readonly tokens: ReadonlyArray<ZeropsIntegrationToken>;
}): ReadonlyArray<ZeropsGroupReachWrite> {
  const writes: Array<ZeropsGroupReachWrite> = [];
  for (const group of input.groups) {
    for (const selfProjectId of group.mateProjectIds) {
      const token = findMateIntegrationToken(input.tokens, selfProjectId);
      if (token === undefined) continue;
      const plan = planGroupReach({ token, selfProjectId, groupProjectIds: group.projectIds });
      if (plan !== undefined) writes.push({ ...plan, name: token.name });
    }
  }
  return writes;
}
