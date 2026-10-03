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
 * place by the projects screen's reconcile: `PUT
 * /client/{clientId}/integration-token/{tokenId}` rewrites the grants of the
 * same token string the container holds, with no restart.
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

/**
 * A Mate not hardened yet, as the platform's token list says it: it has keys, and none is below
 * `ADMIN` on its own project — so the key its container holds surely is. A leftover `ADMIN` key
 * beside a lowered one says nothing of the container's.
 */
export function mateNeedsHarden(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): boolean {
  const keys = tokens.filter((token) => isMateKeyOf(token, projectId));
  return keys.length > 0 && keys.every((key) => selfRoleOf(key, projectId) === "ADMIN");
}

/** A key's role on its Mate's own project. */
function selfRoleOf(token: ZeropsIntegrationToken, projectId: string): string | undefined {
  return (token.projects ?? []).find((grant) => grant.projectId === projectId)?.roleCode;
}

/**
 * Whether this viewer may harden the Mate: it needs it (`mateNeedsHarden`), and the viewer may
 * write its key — an org owner, or the key's creator.
 */
export function mateHardenableBy(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
  viewer: { readonly userId: string | undefined; readonly roleCode: string | undefined },
): boolean {
  if (!mateNeedsHarden(tokens, projectId)) return false;
  if (viewer.roleCode === "OWNER") return true;
  return tokens.some(
    (token) =>
      isMateKeyOf(token, projectId) &&
      viewer.userId !== undefined &&
      token.createdByUser === viewer.userId,
  );
}

/** Every key of a Mate still `ADMIN` on its own project: what a harden lowers. */
export function mateAdminKeys(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ReadonlyArray<ZeropsIntegrationToken> {
  return tokens.filter(
    (token) => isMateKeyOf(token, projectId) && selfRoleOf(token, projectId) === "ADMIN",
  );
}

/** The key a press reuses where no container holds one yet: the newest. */
export function newestMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return newestFirst(tokens.filter((token) => isMateKeyOf(token, projectId)))[0];
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
 * already lowered is not written, so a screen that reconciles this writes
 * nothing for an account whose keys are as they should be.
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

/** A write of one key's project list. */
export interface MateKeyWrite {
  readonly tokenId: string;
  readonly name: string;
  readonly projects: ReadonlyArray<ZeropsProjectGrant>;
}

/**
 * Every key write the account needs, and no others: each Mate's key lowered
 * ({@link planMateKey}). Safe to run on every read of the projects screen: a
 * write changes a token's grants and never a container's environment, so
 * nothing restarts, and an account whose keys are lowered plans no write. A
 * Mate whose key cannot be found is skipped rather than guessed at — an account
 * can hold a container this client did not create.
 */
export function planAccountMateKeys(input: {
  readonly mateProjectIds: ReadonlyArray<string>;
  readonly tokens: ReadonlyArray<ZeropsIntegrationToken>;
}): ReadonlyArray<MateKeyWrite> {
  const writes: Array<MateKeyWrite> = [];
  for (const selfProjectId of new Set(input.mateProjectIds)) {
    const token = findMateIntegrationToken(input.tokens, selfProjectId);
    if (token === undefined) continue;
    const plan = planMateKey({ token, selfProjectId });
    if (plan !== undefined) writes.push({ ...plan, name: token.name });
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
 * that token as read on its own (`readOne`), under its lock (`hold`), right before it — never from
 * the list the run starts from, which only says which tokens are owed a write. A token read by its
 * id is one small answer where the organization's list is every token, whole. It writes the plan
 * as it stands, with no org role: the write lowers a token's to none. It writes at most what the
 * starting list's plan asked for, and answers how many it wrote.
 */
export async function writeTokenProjectsFresh(input: {
  /** The list the run starts from: which tokens are owed a write. */
  readonly tokens: ReadonlyArray<ZeropsIntegrationToken>;
  readonly plan: (tokens: ReadonlyArray<ZeropsIntegrationToken>) => ReadonlyArray<MateKeyWrite>;
  /** One token as the platform holds it now; `undefined` once it is gone. */
  readonly readOne: (tokenId: string) => Promise<ZeropsIntegrationToken | undefined>;
  readonly write: (write: MateKeyWrite) => Promise<void>;
  /** Serializes each token's read-then-write; without it, nothing else writes these tokens. */
  readonly hold?: TokenWriteHold;
}): Promise<number> {
  const hold: TokenWriteHold = input.hold ?? ((_tokenId, run) => run());
  let written = 0;
  /** Tokens whose write failed: the others are still written, and the run fails at its end. */
  const refused = new Map<string, unknown>();
  for (const planned of input.plan(input.tokens)) {
    try {
      const wrote = await hold(planned.tokenId, async () => {
        const fresh = await input.readOne(planned.tokenId);
        if (fresh === undefined) return false;
        const tokens = input.tokens.map((token) => (token.id === fresh.id ? fresh : token));
        const write = input.plan(tokens).find((next) => next.tokenId === planned.tokenId);
        if (write === undefined) return false;
        await input.write(write);
        return true;
      });
      if (wrote) written += 1;
    } catch (cause) {
      refused.set(planned.tokenId, cause);
    }
  }
  const [failure] = refused.values();
  if (refused.size > 0) throw failure;
  return written;
}
