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
 * project through HQ instead: zerops_observe reads permitted stage and
 * production status, active versions and logs. So this client adds no grant beside a
 * Mate's own: not at the key's mint, not at a birth, not on a screen's read.
 * A key found by its name is the Mate's only while it holds its own project
 * and nothing else, and is never narrowed (`planMateKey`).
 *
 * What stays is the lowering (guide 0.2). The platform mints a container's
 * token with `ADMIN` on its project; a key this client mints holds
 * `BASIC_USER` from the start, and an earlier key of the Mate's that a press
 * reuses is lowered in place (`planMateKey`), never on a screen's read (step
 * A, A11): `PUT /client/{clientId}/integration-token/{tokenId}` rewrites a
 * token's grants without minting another.
 *
 * Nothing here reaches a network (rule R1): the caller performs the write.
 *
 * @module groupReach
 */
import { mateKeyReach } from "@t3tools/shared/mateKeyReach";

/** The platform's project roles, as its own validation error enumerates them. */
export type ZeropsProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS";

/**
 * The names a Mate's key comes with: a press's, `zcp-<project>`, as the platform named the one it
 * minted with a container; and the Zerops GUI's, `zerops-zcp-<service>` (the audit, 2026-10-03:
 * 63 `zerops-zcp-zcp` keys on Example Org, none of which `zcp-` matched).
 */
const MATE_KEY_NAME_PREFIXES: ReadonlyArray<string> = ["zcp-", "zerops-zcp-"];

/**
 * What a Mate holds on the project it lives in — everything zcp's bootstrap
 * does and nothing more.
 *
 * The platform mints the container's token with `ADMIN` (measured
 * 2026-09-15), which is also a shell in that container and the agent running
 * in it: `ADMIN` rewrites the project's own tags and renames the project — the
 * name every surface calls the Mate by. `BASIC_USER` keeps the whole bootstrap
 * — service import with `override`, plain and sensitive service env, restart,
 * delete, `zcli push` — and answers `403` to the tag and rename writes
 * (measured 2026-09-15, ledger *Zerops auth surface*). Where a Mate belongs is
 * HQ's record, which no key of a Mate writes; the lowering keeps the agent to
 * the work in its own project.
 */
export const MATE_SELF_PROJECT_ROLE = "BASIC_USER" satisfies ZeropsProjectRole;

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
  /** A key that acts beyond its grants; every one minted before 2026-10-13 is (HQ: `key_too_wide`). */
  readonly sudo?: boolean | undefined;
}

/**
 * Whether `token` is a key of the Mate whose own project is `projectId`: one of the names a
 * Mate's key comes with, and its only grant this project, at a Mate's own role, either one.
 *
 * Both halves of the test are needed. The grant alone is not enough — a deploy key, or a person's
 * own token scoped to the project, looks identical by it; the name alone is not either. A key
 * widened beyond its project is not taken for one.
 */
function isMateKeyOf(token: ZeropsIntegrationToken, projectId: string): boolean {
  return (
    MATE_KEY_NAME_PREFIXES.some((prefix) => token.name.startsWith(prefix)) &&
    mateKeyReach(token.projects ?? [], projectId) === "own"
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

/** A key's role on its Mate's own project. */
function selfRoleOf(token: ZeropsIntegrationToken, projectId: string): string | undefined {
  return (token.projects ?? []).find((grant) => grant.projectId === projectId)?.roleCode;
}

/** The name a press gives the key it mints with a Mate's container (`api.ts` `mateKeyName`). */
const PRESS_KEY_NAME_PREFIX = "zcp-";

/**
 * The key a press reuses where no container holds one yet: the newest of the keys a press mints,
 * by the name it gives them, holding this project alone at a Mate's own role — so a press never
 * mints a second key beside one it made. A key an earlier client widened to other projects is not
 * reused: it is not taken for the Mate's (`isMateKeyOf`), and a key of the press's own is minted.
 * Nor is a `sudo` key, as the platform makes with a container (HQ's Mate door never admits one).
 */
export function newestMateKey(
  tokens: ReadonlyArray<ZeropsIntegrationToken>,
  projectId: string,
): ZeropsIntegrationToken | undefined {
  return newestFirst(
    tokens.filter(
      (token) =>
        token.name.startsWith(PRESS_KEY_NAME_PREFIX) &&
        token.sudo !== true &&
        isMateKeyOf(token, projectId),
    ),
  )[0];
}

/** What a reusing press does with one key of a Mate (`planMateKey`). */
type MateKeyPlan =
  /** Write exactly `projects`: the Mate's own project at `MATE_SELF_PROJECT_ROLE`, nothing else. */
  | {
      readonly kind: "write";
      readonly tokenId: string;
      readonly projects: ReadonlyArray<ZeropsProjectGrant>;
    }
  /** It holds exactly its own project at the Mate's role already: nothing is written. */
  | { readonly kind: "held" }
  /** It is not the Mate's key as read: nothing is written to it. */
  | { readonly kind: "not-its-key" };

/**
 * The write that sets a Mate's key to its own project alone (ADR 0003): `MATE_SELF_PROJECT_ROLE`
 * there and no other grant. A key the platform minted with `ADMIN` is lowered in place, its string
 * unchanged; a key that holds exactly that already is not written.
 *
 * A key found by its name and grant is the Mate's only while it holds this project alone
 * (`isMateKeyOf`): a deploy key or a person's token can carry such a name, so a key that reaches
 * anything else is `not-its-key` and never narrowed.
 */
export function planMateKey(input: {
  readonly token: ZeropsIntegrationToken;
  readonly selfProjectId: string;
}): MateKeyPlan {
  if (!isMateKeyOf(input.token, input.selfProjectId)) {
    return { kind: "not-its-key" };
  }
  if (
    (input.token.projects ?? []).length === 1 &&
    selfRoleOf(input.token, input.selfProjectId) === MATE_SELF_PROJECT_ROLE
  ) {
    return { kind: "held" };
  }
  return {
    kind: "write",
    tokenId: input.token.id,
    projects: [{ projectId: input.selfProjectId, roleCode: MATE_SELF_PROJECT_ROLE }],
  };
}

/** The page's exclusive locks (`navigator.locks`): `hold` runs once the lock is this tab's. */
export interface TokenWriteLocks {
  readonly request: <T>(name: string, hold: () => Promise<T>) => Promise<T>;
}

const tokenWriteLockName = (tokenId: string): string => `mate:token:${tokenId}`;

/** Holds one token's read-then-write at a time, until `run` settles. */
export type TokenWriteHold = <T>(tokenId: string, run: () => Promise<T>) => Promise<T>;

/** How long one token's read-then-write may hold its lock before it is let go and fails. */
const TOKEN_WRITE_HOLD_MS = 30_000;

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
