/**
 * The group reach's driver: when the reconcile plans, what it writes, and what it remembers.
 *
 * It decides on strings, never on array identity. The projects screen hands over a new `groups`
 * array on every inventory push and every minute's tick, and the shared token list a new array on
 * every read; a driver keyed on identity restarted on each of them, and each restart read the list
 * again through the account's one command lane — measured live 2026-10-02 at ~220 list reads a
 * minute from an idle tab, with the lane full enough to refuse a New project.
 *
 * So it reads nothing itself. It plans from the shared token list the hook is shown (only once
 * that list and the group listing are complete), and a write the platform answered is its own
 * confirmation: the driver remembers which grants it wrote over which, so the list's refresh after
 * our own write — still showing the old grants, or the new ones — plans nothing. A run is never
 * restarted: an observation that arrives during a write is planned after it, from the newest one.
 * A refused write is reported once and waits out its back-off however often the list is read.
 */

import {
  planAccountGroupReach,
  type TokenWriteHold,
  type ZeropsGroupReachGroup,
  type ZeropsGroupReachWrite,
  type ZeropsIntegrationToken,
  type ZeropsProjectGrant,
} from "@t3tools/client-runtime/zerops";

/** How long a write the platform refused waits before it is tried again: 30 s, 2 min, then 10 min. */
export const GROUP_REACH_BACKOFF_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000];

/** One group shape as a string: the same groups in any order are the same key. */
export function groupsKey(groups: ReadonlyArray<ZeropsGroupReachGroup>): string {
  return groups
    .map(
      (group) =>
        `${[...group.projectIds].sort().join(",")}|${[...group.mateProjectIds].sort().join(",")}`,
    )
    .sort()
    .join(";");
}

const grantsKey = (grants: ReadonlyArray<ZeropsProjectGrant>): string =>
  grants
    .map((grant) => `${grant.projectId}=${grant.roleCode}`)
    .sort()
    .join(",");

/** Which tokens exist and what each grants, as a string: the same listing in any order is one key. */
export function listingKey(tokens: ReadonlyArray<ZeropsIntegrationToken>): string {
  return tokens
    .map((token) => `${token.id}:${grantsKey(token.projects ?? [])}`)
    .sort()
    .join(";");
}

/** What the screen shows the reach: its groups and the account's token list. */
export interface GroupReachObservation {
  readonly groups: ReadonlyArray<ZeropsGroupReachGroup>;
  readonly listing: ReadonlyArray<ZeropsIntegrationToken>;
  /** Both the group listing and the token listing are complete reads, not a part of one. */
  readonly complete: boolean;
}

export interface GroupReachFailure {
  readonly tokenId: string;
  readonly name: string;
  readonly cause: unknown;
  /** When it is tried again. */
  readonly retryInMs: number;
}

/** What the driver acts through while a screen holds it. */
export interface GroupReachPort {
  readonly write: (write: ZeropsGroupReachWrite) => Promise<void>;
  /** A write the platform refused, told once per refusal streak. */
  readonly report: (failure: GroupReachFailure) => void;
}

export interface GroupReachDriver {
  /** Lends the driver a screen's writes; the returned function takes them back. */
  readonly attach: (port: GroupReachPort) => () => void;
  /** What the screen shows now: planned only when its keys moved, never mid-write. */
  readonly observe: (observation: GroupReachObservation) => void;
}

interface Owed {
  readonly write: ZeropsGroupReachWrite;
  /** The token's grants in the listing this was planned from. */
  readonly before: string;
  /** The grants the write sets. */
  readonly after: string;
}

export function makeGroupReachDriver(options: {
  /** Each token's write, one at a time with every other writer's. */
  readonly hold: TokenWriteHold;
  readonly now?: () => number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}): GroupReachDriver {
  const now = options.now ?? (() => performance.now());
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number) => {
      const timer = setTimeout(run, delayMs);
      return () => clearTimeout(timer);
    });

  let port: GroupReachPort | null = null;
  let latest: GroupReachObservation | null = null;
  let lastKey: string | null = null;
  let running = false;
  let cancelWake: (() => void) | null = null;
  /** Writes the platform answered, by token: the grants it held, and the grants written over them. */
  const written = new Map<string, { readonly before: string; readonly after: string }>();
  /** Writes the platform refused, by token: for which grants, how often, and when to try again. */
  const refused = new Map<
    string,
    { readonly after: string; readonly attempts: number; readonly retryAtMs: number }
  >();

  const owedBy = (observation: GroupReachObservation): ReadonlyArray<Owed> => {
    if (!observation.complete) return [];
    const byId = new Map(observation.listing.map((token) => [token.id, token]));
    // A remembered write stands while the listing still shows what it replaced; once the listing
    // shows anything else — what was written, or a later edit — the listing speaks for itself.
    for (const [tokenId, memo] of written) {
      const shown = byId.get(tokenId);
      if (shown === undefined || grantsKey(shown.projects ?? []) !== memo.before) {
        written.delete(tokenId);
      }
    }
    const owed = planAccountGroupReach({
      groups: observation.groups,
      tokens: observation.listing,
    }).map((write): Owed => ({
      write,
      before: grantsKey(byId.get(write.tokenId)?.projects ?? []),
      after: grantsKey(write.projects),
    }));
    for (const tokenId of refused.keys()) {
      if (!owed.some(({ write }) => write.tokenId === tokenId)) refused.delete(tokenId);
    }
    return owed.filter(({ write, before, after }) => {
      const memo = written.get(write.tokenId);
      if (memo?.before === before && memo.after === after) return false;
      const refusal = refused.get(write.tokenId);
      return !(refusal?.after === after && now() < refusal.retryAtMs);
    });
  };

  /** Plans again when the earliest back-off ends, while a refused write is still owed. */
  const armWake = (): void => {
    cancelWake?.();
    cancelWake = null;
    // One already due was planned by the run that just ended, or is not owed by what it saw.
    const waits = [...refused.values()]
      .map(({ retryAtMs }) => retryAtMs)
      .filter((retryAtMs) => retryAtMs > now());
    if (port === null || waits.length === 0) return;
    const at = Math.min(...waits);
    cancelWake = schedule(() => {
      cancelWake = null;
      kick();
    }, at - now());
  };

  const writeOne = async (target: GroupReachPort, owed: Owed): Promise<void> => {
    const { write, before, after } = owed;
    try {
      await options.hold(write.tokenId, () => target.write(write));
      written.set(write.tokenId, { before, after });
      refused.delete(write.tokenId);
    } catch (cause) {
      const prior = refused.get(write.tokenId);
      const attempts = (prior?.after === after ? prior.attempts : 0) + 1;
      const retryInMs =
        GROUP_REACH_BACKOFF_MS[Math.min(attempts, GROUP_REACH_BACKOFF_MS.length) - 1]!;
      refused.set(write.tokenId, { after, attempts, retryAtMs: now() + retryInMs });
      if (attempts === 1)
        target.report({ tokenId: write.tokenId, name: write.name, cause, retryInMs });
    }
  };

  const drive = async (): Promise<void> => {
    try {
      // Each pass plans from the newest observation: one that arrived during a write is
      // planned after it, and what was just written is remembered rather than read back.
      // A run writes each (token, grants) pair at most once, whatever it is shown meanwhile.
      const done = new Set<string>();
      for (;;) {
        const target = port;
        if (target === null || latest === null) return;
        const next = owedBy(latest).find(
          ({ write, after }) => !done.has(`${write.tokenId}>${after}`),
        );
        if (next === undefined) return;
        done.add(`${next.write.tokenId}>${next.after}`);
        await writeOne(target, next);
      }
    } finally {
      running = false;
      armWake();
    }
  };

  function kick(): void {
    if (running || port === null) return;
    running = true;
    void drive();
  }

  return {
    attach: (lent) => {
      port = lent;
      return () => {
        if (port !== lent) return;
        port = null;
        // The next screen plans from what it shows, not from what this one last did.
        latest = null;
        lastKey = null;
        cancelWake?.();
        cancelWake = null;
      };
    },
    observe: (observation) => {
      const key = `${observation.complete}|${groupsKey(observation.groups)}|${listingKey(observation.listing)}`;
      if (key === lastKey) return;
      lastKey = key;
      latest = observation;
      kick();
    },
  };
}

const drivers = new WeakMap<object, Map<string, GroupReachDriver>>();

/**
 * The tab's one driver for an organization under `owner` (the account's runtime): what it wrote
 * outlives the screen that wrote it, so a screen opened again does not write it again.
 */
export function groupReachDriverFor(
  owner: object,
  clientId: string,
  make: () => GroupReachDriver,
): GroupReachDriver {
  let byClient = drivers.get(owner);
  if (byClient === undefined) {
    byClient = new Map();
    drivers.set(owner, byClient);
  }
  let driver = byClient.get(clientId);
  if (driver === undefined) {
    driver = make();
    byClient.set(clientId, driver);
  }
  return driver;
}
