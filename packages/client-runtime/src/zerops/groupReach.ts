/**
 * A Mate's key reaches its own project.
 *
 * Every Mate holds one integration token, the `ZCP_API_KEY` of its `zcp`
 * container: `NO_ACCESS` at the organization and `BASIC_USER` on the project
 * it lives in, and no grant on any other project. The agent in that container
 * reads and changes its own project through it, and nothing else.
 *
 * It once read its application's other projects too, `READ_ONLY` on each, so
 * an agent could see its stage and production. That grant reads a
 * production's unmarked secrets — a database's `connectionString` in plain
 * text — for anybody with a terminal in the Mate, and somebody had to keep
 * writing it as the application changed (ADR 0003). An agent reaches past its
 * project through HQ instead, later. So this client adds no grant beside a
 * Mate's own: not at the key's mint, not at a birth, not on a screen's read.
 * A grant a key already holds is not taken away here; a separate step
 * removes it.
 *
 * What stays is the lowering (guide 0.2). The platform mints a container's
 * token with `ADMIN` on its project; a key this client mints holds
 * `BASIC_USER` from the start, and one it did not mint — the pool's from
 * sign-up, an older account's, one made in the Zerops GUI — is lowered in
 * place by its harden (`hardenMate`), when a person finishes setting it up,
 * never on a screen's read (step A, A11): `PUT
 * /client/{clientId}/integration-token/{tokenId}` rewrites the grants of the
 * same token string the container holds, with no restart.
 *
 * Nothing here reaches a network (rule R1): the caller performs the write.
 *
 * @module groupReach
 */

/** The platform's project roles, as its own validation error enumerates them. */
export type ZeropsProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS";

/**
 * The names a Mate's key comes with: a press's, `zcp-<project>`, as the platform named the one it
 * minted with a container; and the Zerops GUI's, `zerops-zcp-<service>` (the audit, 2026-10-03:
 * 63 `zerops-zcp-zcp` keys on KRLS, none of which `zcp-` matched).
 */
const MATE_KEY_NAME_PREFIXES: ReadonlyArray<string> = ["zcp-", "zerops-zcp-"];

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
  /** Who minted it: besides an org owner, the one person who may write it. */
  readonly createdByUser?: string | undefined;
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
 * Whether `token` is a key of the Mate whose own project is `projectId`: one of the names a
 * Mate's key comes with, and its only grant this project, at a Mate's own role, either one.
 *
 * Both halves of the test are needed. The grant alone is not enough — a deploy key, or a person's
 * own token scoped to the project, looks identical by it; the name alone is not either. A key
 * widened beyond its project is not taken for one: the harden finds the key its Mate holds by its
 * id once the Mate enrolled it with HQ, and by this rule only until then.
 */
function isMateKeyOf(token: ZeropsIntegrationToken, projectId: string): boolean {
  const grants = token.projects ?? [];
  const [grant] = grants;
  return (
    MATE_KEY_NAME_PREFIXES.some((prefix) => token.name.startsWith(prefix)) &&
    grants.length === 1 &&
    grant !== undefined &&
    grant.projectId === projectId &&
    MATE_SELF_GRANT_ROLES.has(grant.roleCode)
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

/** Whether `key` was made before the container made at `container` (wall ms); any, where unknown. */
const madeBefore = (key: ZeropsIntegrationToken, container: number): boolean =>
  Number.isNaN(container) || createdMs(key) <= container;

/**
 * The key a Mate's container holds, out of every key that is its (`isMateKeyOf`): the newest made
 * before its container — the one there is, or the newest where a raced press or an older platform
 * key left two. A key made after it is an orphan; where the container's age is unknown, only a key
 * that is the one there is stands, and keys nothing tells apart are never guessed at: undefined.
 */
export function findHeldMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
  containerCreated: string | undefined,
): ZeropsIntegrationToken | undefined {
  const keys = tokens.filter((token) => isMateKeyOf(token, projectId));
  const container = containerCreated === undefined ? Number.NaN : Date.parse(containerCreated);
  if (Number.isNaN(container)) return keys.length === 1 ? keys[0] : undefined;
  return newestFirst(keys.filter((key) => madeBefore(key, container)))[0];
}

/** A key's role on its Mate's own project. */
function selfRoleOf(token: ZeropsIntegrationToken, projectId: string): string | undefined {
  return (token.projects ?? []).find((grant) => grant.projectId === projectId)?.roleCode;
}

/**
 * Every key of a Mate still `ADMIN` on its own project, made before its container where its age is
 * known: what a harden lowers.
 */
export function mateAdminKeys(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
  containerCreated: string | undefined,
): ReadonlyArray<ZeropsIntegrationToken> {
  const container = containerCreated === undefined ? Number.NaN : Date.parse(containerCreated);
  return tokens.filter(
    (token) =>
      isMateKeyOf(token, projectId) &&
      selfRoleOf(token, projectId) === "ADMIN" &&
      madeBefore(token, container),
  );
}

/** The name a press gives the key it mints with a Mate's container (`api.ts` `mateKeyName`). */
const PRESS_KEY_NAME_PREFIX = "zcp-";

/**
 * The key a press reuses where no container holds one yet: the newest of the keys a press mints,
 * by the name it gives them, writing this project at a Mate's own role — whatever else an earlier
 * client let it reach, so a press never mints a second key beside one it made.
 */
export function newestMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return newestFirst(
    tokens.filter(
      (token) =>
        token.name.startsWith(PRESS_KEY_NAME_PREFIX) &&
        (token.projects ?? []).some(
          (grant) => grant.projectId === projectId && MATE_SELF_GRANT_ROLES.has(grant.roleCode),
        ),
    ),
  )[0];
}

function sameGrants(
  left: ReadonlyArray<ZeropsProjectGrant>,
  right: ReadonlyArray<ZeropsProjectGrant>,
): boolean {
  const key = (grant: ZeropsProjectGrant) => `${grant.projectId}=${grant.roleCode}`;
  const sorted = (grants: ReadonlyArray<ZeropsProjectGrant>) => grants.map(key).sort();
  return sorted(left).join(";") === sorted(right).join(";");
}

/**
 * The write that lowers a Mate's key, or `undefined` when it holds what it
 * should: `MATE_SELF_PROJECT_ROLE` on its own project — added where it has no
 * grant there — and every other grant it holds exactly as it is. A key the
 * platform minted with `ADMIN` is lowered in place, its string unchanged; a key
 * already lowered is not written.
 *
 * Comparison is order-insensitive: the platform returns grants in its own
 * order.
 */
export function planMateKey(input: {
  readonly token: ZeropsIntegrationToken;
  readonly selfProjectId: string;
}): { readonly tokenId: string; readonly projects: ReadonlyArray<ZeropsProjectGrant> } | undefined {
  const current = input.token.projects ?? [];
  const own: ZeropsProjectGrant = {
    projectId: input.selfProjectId,
    roleCode: MATE_SELF_PROJECT_ROLE,
  };
  const wanted = current.some((grant) => grant.projectId === input.selfProjectId)
    ? current.map((grant) => (grant.projectId === input.selfProjectId ? own : grant))
    : [own, ...current];
  if (sameGrants(current, wanted)) return undefined;
  return { tokenId: input.token.id, projects: wanted };
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
