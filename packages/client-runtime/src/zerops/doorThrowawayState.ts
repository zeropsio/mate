import { ZeropsApiError } from "./api.ts";

/** Nothing owed older than this is still a door's live throwaway. */
export const THROWAWAY_SWEEP_AGE_MS = 5 * 60 * 1000;

/** The terminal result of one cleanup attempt; no credential values. */
export interface ThrowawayCleanupFailure {
  readonly attempt: string;
  readonly tokenId?: string;
  readonly state: "failed" | "unknown";
  readonly reason: string;
}

/** A refused deletion failed; a lost or server-error answer may have applied. */
export function throwawayCleanupFailureState(cause: unknown): ThrowawayCleanupFailure["state"] {
  return cause instanceof ZeropsApiError &&
    cause.kind !== "network" &&
    cause.kind !== "uncertain" &&
    (cause.status === null || cause.status < 500)
    ? "failed"
    : "unknown";
}

interface ThrowawayDebtEntry {
  readonly clientId: string;
  readonly attempt: string;
  readonly at: number;
  readonly failure?: ThrowawayCleanupFailure;
  /** The id its mint answered with; absent while it is not known — its answer lost. */
  readonly tokenId?: string;
}

/** One owed throwaway as a sweep finds it: its name, and its id where its mint answered. */
export interface OwedThrowaway {
  readonly attempt: string;
  readonly tokenId?: string;
}

/** The debt's own marker of a failed sweep, never a throwaway's name. */
const SWEEP_FAILED = "sweep-failed";

/** The account's outstanding cleanup, by organization and mint attempt; no token values. */
export interface ThrowawayDebt {
  readonly owe: (clientId: string, atMs: number, attempt?: string) => void;
  /** Its mint answered: the id it is deleted by is kept with what is owed for it. */
  readonly minted: (clientId: string, attempt: string, tokenId: string) => void;
  /** The throwaways this organization owes from at or before `upToMs`, by their handles. */
  readonly owed: (clientId: string, upToMs: number) => ReadonlyArray<OwedThrowaway>;
  /** The newest outstanding attempt; null when this organization owes none. */
  readonly failedAt: (clientId: string) => number | null;
  readonly cleanupFailures: (clientId: string) => ReadonlyArray<ThrowawayCleanupFailure>;
  readonly failCleanup: (clientId: string, atMs: number, failure: ThrowawayCleanupFailure) => void;
  /** Cleanup failed: subsequent loads require the person to ask again. */
  readonly sweepFailed: (clientId: string) => boolean;
  readonly failSweep: (clientId: string, atMs: number) => void;
  /** One mint was refused or its token deleted: other outstanding attempts remain owed. */
  readonly finish: (clientId: string, attempt: string) => void;
  /** A sweep settled attempts up to this time; later mints remain owed. */
  readonly settle: (clientId: string, upToMs: number) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The host supplies storage scoped to a captured account, including after it signs out. */
export interface ThrowawayDebtStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export const THROWAWAY_DEBT_KEY = "throwaway-debt.v1";

export function makeThrowawayDebt(storage?: ThrowawayDebtStorage): ThrowawayDebt {
  let owed = new Map<string, ThrowawayDebtEntry>();
  const listeners = new Set<() => void>();
  let durable = storage !== undefined;
  const read = () => {
    if (!durable || storage === undefined) return;
    try {
      const value: unknown = JSON.parse(storage.getItem(THROWAWAY_DEBT_KEY) ?? "[]");
      if (!Array.isArray(value)) return;
      const read = new Map<string, ThrowawayDebtEntry>();
      for (const entry of value) {
        if (!Array.isArray(entry) || entry.length < 3 || entry.length > 5) continue;
        const [clientId, attempt, at, result, tokenId] = entry as unknown[];
        if (
          typeof clientId !== "string" ||
          typeof attempt !== "string" ||
          typeof at !== "number" ||
          !Number.isFinite(at) ||
          at < 0
        )
          continue;
        let failure: ThrowawayCleanupFailure | undefined;
        if (Array.isArray(result)) {
          const [state, reason, tokenId] = result as unknown[];
          if (
            (state === "failed" || state === "unknown") &&
            typeof reason === "string" &&
            (tokenId === null || typeof tokenId === "string")
          ) {
            failure = { attempt, state, reason, ...(tokenId === null ? {} : { tokenId }) };
          }
        }
        read.set(JSON.stringify([clientId, attempt]), {
          clientId,
          attempt,
          at,
          ...(failure === undefined ? {} : { failure }),
          ...(typeof tokenId === "string" ? { tokenId } : {}),
        });
      }
      owed = read;
    } catch {
      /* Blocked storage leaves this renderer's debt available. */
    }
  };
  const told = () => {
    try {
      if (owed.size === 0) storage?.removeItem(THROWAWAY_DEBT_KEY);
      else
        storage?.setItem(
          THROWAWAY_DEBT_KEY,
          JSON.stringify(
            [...owed.values()].map(({ clientId, attempt, at, failure, tokenId }) => {
              const result =
                failure === undefined
                  ? null
                  : [failure.state, failure.reason, failure.tokenId ?? null];
              if (tokenId !== undefined) return [clientId, attempt, at, result, tokenId];
              return result === null ? [clientId, attempt, at] : [clientId, attempt, at, result];
            }),
          ),
        );
    } catch {
      durable = false; /* Cleanup still works in memory when persistence is blocked. */
    }
    for (const listener of listeners) listener();
  };
  return {
    owe: (clientId, atMs, attempt = "") => {
      read();
      const key = JSON.stringify([clientId, attempt]);
      owed.set(key, { clientId, attempt, at: Math.max(atMs, owed.get(key)?.at ?? atMs) });
      told();
    },
    minted: (clientId, attempt, tokenId) => {
      read();
      const key = JSON.stringify([clientId, attempt]);
      const entry = owed.get(key);
      if (entry === undefined) return;
      owed.set(key, { ...entry, tokenId });
      told();
    },
    owed: (clientId, upToMs) => {
      read();
      return [...owed.values()].flatMap((entry) =>
        entry.clientId !== clientId ||
        entry.at > upToMs ||
        entry.attempt === "" ||
        entry.attempt === SWEEP_FAILED
          ? []
          : [
              {
                attempt: entry.attempt,
                ...(entry.tokenId === undefined ? {} : { tokenId: entry.tokenId }),
              },
            ],
      );
    },
    failedAt: (clientId) => {
      read();
      let at: number | null = null;
      for (const entry of owed.values())
        if (entry.clientId === clientId) at = Math.max(at ?? 0, entry.at);
      return at;
    },
    cleanupFailures: (clientId) => {
      read();
      return [...owed.values()].flatMap((entry) =>
        entry.clientId === clientId && entry.failure !== undefined ? [entry.failure] : [],
      );
    },
    failCleanup: (clientId, at, failure) => {
      read();
      owed.set(JSON.stringify([clientId, failure.attempt]), {
        clientId,
        attempt: failure.attempt,
        at,
        failure,
      });
      told();
    },
    sweepFailed: (clientId) => {
      read();
      return [...owed.values()].some(
        (entry) =>
          entry.clientId === clientId &&
          (entry.attempt === SWEEP_FAILED || entry.failure !== undefined),
      );
    },
    failSweep: (clientId, at) => {
      read();
      owed.set(JSON.stringify([clientId, SWEEP_FAILED]), { clientId, attempt: SWEEP_FAILED, at });
      told();
    },
    finish: (clientId, attempt) => {
      read();
      if (owed.delete(JSON.stringify([clientId, attempt]))) told();
    },
    settle: (clientId, upToMs) => {
      read();
      for (const [key, entry] of owed)
        if (entry.clientId === clientId && entry.at <= upToMs) owed.delete(key);
      told();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Hosts without durable storage keep the same cleanup accounting in memory. */
export const throwawayDebt: ThrowawayDebt = makeThrowawayDebt();

/**
 * How long a throwaway its door did not take is held for the door's next try: well inside the
 * five minutes a door admits one for (`THROWAWAY_SWEEP_AGE_MS`), then it is deleted.
 */
export const THROWAWAY_REUSE_MS = 2 * 60 * 1000;

/**
 * How fast mints start, as a bucket: a full one starts `burst` at once, and it refills at
 * `perMinute`, never past `burst`.
 */
export interface MintPaceConfig {
  readonly burst: number;
  readonly perMinute: number;
}

/** Door exchanges the background — the Mate left last, repair — may start at once. */
export const DOOR_MINT_BURST = 10;
/**
 * The background's door mints refill at one every two seconds. The platform drew no 429 at 80
 * mints a minute, each deleted at once (measured 2026-10-01), and the most this pace starts in a
 * minute, a full bucket and a minute's refill, is half that.
 */
export const DOOR_MINTS_PER_MINUTE = 30;
export const DOOR_MINT_PACE: MintPaceConfig = {
  burst: DOOR_MINT_BURST,
  perMinute: DOOR_MINTS_PER_MINUTE,
};
/** How long background mints stand still after the platform answers one with 429. */
export const DOOR_MINT_THROTTLE_MS = 30_000;

/**
 * The bucket behind a mint budget, on a monotonic clock in milliseconds. Only the background
 * waits on it: a mint the person asked for — the Mate the route names, the Connect they pressed —
 * is spent at once, past empty if it must, and the background waits that debt out (never more
 * than one bucket of it). A 429 holds the background for {@link DOOR_MINT_THROTTLE_MS}, or the
 * platform's `Retry-After` when that is longer, and it then refills from empty.
 */
export interface MintPace {
  /** When a background mint may start, with `owed` mints already promised; `now` once it may. */
  readonly readyAt: (now: number, owed?: number) => number;
  /** A mint started, asked for or not. */
  readonly spend: (now: number) => void;
  /** The platform answered a mint 429. */
  readonly throttled: (now: number, retryAfterMs?: number | null) => void;
}

export function makeMintPace(config: MintPaceConfig): MintPace {
  const perMs = config.perMinute / 60_000;
  /** The bucket's level at `from`; it refills only after `from`, which a hold moves ahead. */
  let tokens = config.burst;
  let from = Number.NEGATIVE_INFINITY;
  const level = (now: number) =>
    now <= from ? tokens : Math.min(config.burst, tokens + (now - from) * perMs);
  return {
    readyAt: (now, owed = 0) => {
      const need = 1 + owed;
      const start = Math.max(now, from);
      const short = need - level(start);
      return short <= 0 ? start : start + short / perMs;
    },
    spend: (now) => {
      const left = level(now) - 1;
      if (now > from) from = now;
      tokens = Math.max(left, -config.burst);
    },
    throttled: (now, retryAfterMs = null) => {
      const left = Math.min(level(now), 0);
      from = Math.max(from, now + Math.max(DOOR_MINT_THROTTLE_MS, retryAfterMs ?? 0));
      tokens = left;
    },
  };
}

/**
 * Hands out mints at the pace of {@link MintPace}: past it, a background mint waits for its turn.
 * The pace belongs to the account epoch it was spent in (`ZeropsApiClient.accountEpoch`): the
 * next account in the tab starts with a full bucket, and a mint still waiting from an epoch that
 * has ended is refused rather than started.
 */
export interface MintBudget {
  readonly take: (
    epoch: number,
    options?: { readonly signal?: AbortSignal | undefined; readonly asked?: boolean },
  ) => Promise<void>;
  /** The platform answered a mint 429, asking for `retryAfterMs` when it said. */
  readonly throttled: (retryAfterMs: number | null) => void;
}

function makeMintBudget(config: MintPaceConfig, now: () => number): MintBudget {
  let pace = makeMintPace(config);
  let pacedIn = Number.NEGATIVE_INFINITY;
  const take: MintBudget["take"] = async (epoch, { signal, asked = false } = {}) => {
    for (;;) {
      signal?.throwIfAborted();
      if (epoch < pacedIn) {
        throw new ZeropsApiError("This account session has ended.", "expired-session", 401);
      }
      if (epoch > pacedIn) {
        pace = makeMintPace(config);
        pacedIn = epoch;
      }
      const at = now();
      const readyAt = pace.readyAt(at);
      if (asked || readyAt <= at) {
        pace.spend(at);
        return;
      }
      await slotFree(readyAt - at, signal);
    }
  };
  return { take, throttled: (retryAfterMs) => pace.throttled(now(), retryAfterMs) };
}

function slotFree(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    // @effect-diagnostics-next-line globalTimers:off -- plain promises: a budget wait, no Effect runtime here.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * The doors' mint budget (DESIGN I12). Per tab: there is no leader to share one across tabs
 * (D10).
 */
export interface ThrowawayMintBudgets {
  readonly door: MintBudget;
}

export function makeThrowawayMintBudgets(
  now: () => number = () => performance.now(),
): ThrowawayMintBudgets {
  return { door: makeMintBudget(DOOR_MINT_PACE, now) };
}
