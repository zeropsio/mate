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
 * - `BASIC_USER` on the project it lives in;
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

/**
 * What a Mate holds on the project it lives in — everything zcp's bootstrap
 * does and nothing more.
 *
 * The platform mints the container's token with `ADMIN` (measured
 * 2026-09-15), which is also a shell in that container and the agent running
 * in it: `ADMIN` rewrites the project's own tags, so a Mate could tag itself
 * into another group, rename its project, and hand itself the group's reach
 * this module is trying to control. `BASIC_USER` keeps the whole bootstrap —
 * service import with `override`, plain and sensitive service env, restart,
 * delete, `zcli push` — and answers `403` to the tag and rename writes
 * (measured 2026-09-15, ledger *Zerops auth surface*). So the difference this
 * lowering makes is exactly the difference between a Mate that can work and a
 * Mate that can promote itself.
 */
export const MATE_SELF_PROJECT_ROLE = "BASIC_USER" satisfies ZeropsProjectRole;

/**
 * The roles a Mate's own token may hold on its project: the one the platform
 * mints it with, and the one 0.2 lowers it to. Both, or the search would lose
 * every Mate at the moment it was secured.
 */
const MATE_SELF_GRANT_ROLES: ReadonlySet<ZeropsProjectRole> = new Set<ZeropsProjectRole>([
  "ADMIN",
  MATE_SELF_PROJECT_ROLE,
]);

export interface ZeropsProjectGrant {
  readonly projectId: string;
  readonly roleCode: ZeropsProjectRole;
}

export interface ZeropsIntegrationToken {
  readonly id: string;
  readonly name: string;
  /** The token's org role, round-tripped by any write to it. */
  readonly roleCode?: string | undefined;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant> | undefined;
  /** When the platform minted it. The start-up throwaway sweep dates rows by it. */
  readonly created?: string | undefined;
}

/**
 * A one-time permission to mint one token of an exact shape, granted by a
 * person and attached to a token.
 *
 * Environment creation leaves one on every Mate: the platform's
 * development-container import grants `NO_ACCESS` + *can create projects*
 * (measured 2026-09-15), so every Mate on the account can make itself one more
 * project — and, worse for the door, a token whose `createdByUser` is the
 * person who granted it. Nothing zcp does needs it: its delegated launch path
 * falls back to a manual key.
 */
export interface ZeropsTokenDelegation {
  readonly id: string;
  readonly tokenId: string;
}

/**
 * The token that belongs to a Mate's container, out of every token on the
 * account.
 *
 * Both halves of the test are needed. The name alone is not enough: it is
 * `zcp-<project name>` at mint time and a project can be renamed afterwards.
 * The grant alone is not enough either — a deploy token scoped to one project
 * looks identical by that test. Together they are unambiguous, and they stay
 * true after this module has widened *and* lowered the token, because the
 * match is "writes this project", never "grants only this project" and never
 * one exact role.
 */
export function findMateIntegrationToken(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return tokens.find((token) => isMateKeyOf(token, projectId));
}

function isMateKeyOf(token: ZeropsIntegrationToken, projectId: string): boolean {
  return (
    token.name.startsWith(ZCP_TOKEN_NAME_PREFIX) &&
    (token.projects ?? []).some(
      (grant) => grant.projectId === projectId && MATE_SELF_GRANT_ROLES.has(grant.roleCode),
    )
  );
}

const createdMs = (token: ZeropsIntegrationToken): number =>
  token.created === undefined ? Number.NaN : Date.parse(token.created);

/** Newest first; a key with no readable age last. */
function newestFirst(keys: ReadonlyArray<ZeropsIntegrationToken>): Array<ZeropsIntegrationToken> {
  return [...keys].sort((left, right) => {
    const l = createdMs(left);
    const r = createdMs(right);
    if (Number.isNaN(l)) return Number.isNaN(r) ? 0 : 1;
    if (Number.isNaN(r)) return -1;
    return r - l;
  });
}

/**
 * The key a Mate's container holds, out of every key that is its (`findMateIntegrationToken`):
 * the one key, or — where a raced press or an older platform key left two — the newest made before
 * its container. A key made after it is an orphan, and keys nothing tells apart are never guessed
 * at: undefined.
 */
export function findHeldMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
  containerCreated: string | undefined,
): ZeropsIntegrationToken | undefined {
  const keys = tokens.filter((token) => isMateKeyOf(token, projectId));
  if (keys.length <= 1) return keys[0];
  const container = containerCreated === undefined ? Number.NaN : Date.parse(containerCreated);
  if (Number.isNaN(container)) return undefined;
  return newestFirst(keys.filter((key) => createdMs(key) <= container))[0];
}

/** The key a press reuses where no container holds one yet: the newest. */
export function newestMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return newestFirst(tokens.filter((token) => isMateKeyOf(token, projectId)))[0];
}

/**
 * What a Mate's token should grant: `BASIC_USER` on its own project,
 * `READ_ONLY` on the rest of its group, in a fixed order so an unchanged group
 * produces an identical document.
 *
 * The Mate's own project is always first and always writable, whatever the
 * caller passed in the group — a Mate that lost write access to the project it
 * lives in could not do its job, and no group edit may cause that. A group of
 * one still produces a document, and it is not the one the platform minted:
 * being alone is not a reason to keep `ADMIN`.
 */
export function buildGroupGrants(input: {
  readonly selfProjectId: string;
  readonly groupProjectIds: ReadonlyArray<string>;
}): ReadonlyArray<ZeropsProjectGrant> {
  const siblings = [...new Set(input.groupProjectIds)]
    .filter((projectId) => projectId !== input.selfProjectId)
    .sort();
  return [
    { projectId: input.selfProjectId, roleCode: MATE_SELF_PROJECT_ROLE },
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
 *
 * It is also how a Mate this client never created gets lowered — the pool's
 * Mate from sign-up, an older account's, one built in the Zerops GUI. Every
 * Mate in the list is planned for, solo groups included, because a solo Mate
 * holding `ADMIN` is exactly the shape 0.2 exists to end.
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

/** The page's exclusive locks (`navigator.locks`): `hold` runs once the lock is this tab's. */
export interface TokenWriteLocks {
  readonly request: <T>(name: string, hold: () => Promise<T>) => Promise<T>;
}

export const tokenWriteLockName = (tokenId: string): string => `mate:token:${tokenId}`;

/** Holds one token's read-then-write at a time, until `run` settles. */
export type TokenWriteHold = <T>(tokenId: string, run: () => Promise<T>) => Promise<T>;

/** How long one token's read-then-write may hold its lock before it is let go and fails. */
export const TOKEN_WRITE_HOLD_MS = 30_000;

/**
 * One token's read-then-write at a time: in this page by a queue per token, and across the
 * browser's tabs by the page's lock named `mate:token:{id}` where the platform has locks. A hold
 * past `timeoutMs` is let go and fails, so a write that never answers blocks nobody for good.
 */
export function makeTokenWriteLock(
  locks?: TokenWriteLocks,
  options: { readonly timeoutMs?: number } = {},
): TokenWriteHold {
  const timeoutMs = options.timeoutMs ?? TOKEN_WRITE_HOLD_MS;
  const queues = new Map<string, Promise<void>>();
  return <T>(tokenId: string, run: () => Promise<T>): Promise<T> => {
    const bounded = () =>
      new Promise<T>((resolve, reject) => {
        // @effect-diagnostics-next-line globalTimers:off -- a plain Promise bound, outside any Effect.
        const timer = setTimeout(
          () => reject(new Error(`The write to token ${tokenId} took too long; it was let go.`)),
          timeoutMs,
        );
        run().then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (cause: unknown) => {
            clearTimeout(timer);
            reject(cause);
          },
        );
      });
    const held = () =>
      locks === undefined ? bounded() : locks.request(tokenWriteLockName(tokenId), bounded);
    const next = (queues.get(tokenId) ?? Promise.resolve()).then(held);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(tokenId, settled);
    void settled.then(() => {
      if (queues.get(tokenId) === settled) queues.delete(tokenId);
    });
    return next;
  };
}

/**
 * Writes tokens' project lists. A write replaces a token's whole list, so each is planned from
 * the list read under that token's lock (`hold`), right before it — never from a list read
 * earlier, a shared, possibly old one least of all. It writes the plan as it stands: an org role
 * only where the plan names one (the broker's own, read under the lock), else the write lowers it
 * to none. A read outside the lock only finds the next token to write. It writes at most what its first plan asked for, and answers how many it wrote.
 */
export async function writeTokenProjectsFresh(input: {
  readonly read: () => Promise<ReadonlyArray<ZeropsIntegrationToken>>;
  readonly plan: (
    tokens: ReadonlyArray<ZeropsIntegrationToken>,
  ) => ReadonlyArray<ZeropsGroupReachWrite & { readonly roleCode?: string | undefined }>;
  readonly write: (
    write: ZeropsGroupReachWrite & { readonly roleCode?: string | undefined },
  ) => Promise<void>;
  /** Serializes each token's read-then-write; without it, nothing else writes these tokens. */
  readonly hold?: TokenWriteHold;
}): Promise<number> {
  const hold: TokenWriteHold = input.hold ?? ((_tokenId, run) => run());
  let written = 0;
  let attempts = 0;
  let most: number | null = null;
  /** Tokens whose write failed: the others are still written, and the run fails at its end. */
  const refused = new Map<string, unknown>();
  while (most === null || attempts < most) {
    const writes = input.plan(await input.read());
    most ??= writes.length;
    const next = writes.find((planned) => !refused.has(planned.tokenId));
    if (next === undefined) break;
    attempts += 1;
    try {
      const wrote = await hold(next.tokenId, async () => {
        const tokens = await input.read();
        const write = input.plan(tokens).find((planned) => planned.tokenId === next.tokenId);
        if (write === undefined) return false;
        await input.write(write);
        return true;
      });
      if (wrote) written += 1;
    } catch (cause) {
      refused.set(next.tokenId, cause);
    }
  }
  const [failure] = refused.values();
  if (refused.size > 0) throw failure;
  return written;
}
