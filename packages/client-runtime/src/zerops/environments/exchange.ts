/**
 * The words a Mate's connection is driven in (DESIGN §4.4): a target, the demands and leases that
 * want it, the door's exchange and its install, the clock the machines run on, and the intents our
 * own verbs leave on a container (C8). The Mate adapter (`data/adapters/mate.ts`) runs them.
 */
import type { EnvironmentId } from "@t3tools/contracts";

export interface Instant {
  readonly wall: number;
  readonly mono: number;
}
import type { IdentityExchangeReason } from "../diagnostics.ts";
import type { DescriptorFacts } from "./environmentMachine.ts";
import type { Reachability } from "./reachability.ts";

/** `projectId:serviceId` (AL-05). */
export type TargetKey = string;

/**
 * What an emitter publishes the whole of: the route's target, the Mate on screen — its own view,
 * its birth, asked for but capped as no route is — every Mate a page that draws them all names
 * (Usage), and the Mate left last (krok-a-hub §3, kept warm a while). The page's and the last
 * one's are the background.
 */
export type DemandReason = "route" | "screen" | "drawn" | "recent";

/**
 * A lease one caller holds on one target until it lets it go: an action from outside the Mate's
 * own view (a send, a Stop, a rename), or the user's Connect. Each counts: the target is wanted
 * while any holds.
 */
export type LeaseKind = "action" | "user";

/** Background exchanges in flight at once, counting asked-for ones (§4.4). */
export const EXCHANGE_CONCURRENCY = 3;

/** The account's half of the guards (§4.4 CAN). */
export interface AccountGuards {
  /** The account's sign-in has verified its principal. */
  readonly verified: boolean;
  /** The source's own observation state, retained independently from its facts. */
  readonly zeropsState: "unknown" | "live" | "unavailable";
}

export interface ExchangeRequest {
  readonly key: TargetKey;
  readonly origin: string;
  /** The remembered environment the exchange expects; null without one. */
  readonly expected: EnvironmentId | null;
  readonly reason: IdentityExchangeReason;
  /** The person asked for this target, by its route or its Connect: its mint never waits. */
  readonly asked: boolean;
  /** Aborted when the attempt ends without this answer. */
  readonly signal: AbortSignal;
}

export interface ExchangeClock {
  readonly now: () => Instant;
  /** The jitter source for the backoff ladder. */
  readonly random: () => number;
  /** Arms a timer; returns what disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** The tab's own clocks and timers. */
export const systemExchangeClock: ExchangeClock = {
  // @effect-diagnostics-next-line globalDate:off -- the machines' one clock port; plain promises, no Effect runtime.
  now: () => ({ wall: Date.now(), mono: performance.now() }),
  // @effect-diagnostics-next-line globalRandom:off -- the backoff jitter's one source, behind the same port.
  random: () => Math.random(),
  setTimer: (delayMs, fire) => {
    // @effect-diagnostics-next-line globalTimers:off -- the machines' one timer port; plain promises, no Effect runtime.
    const handle = setTimeout(fire, delayMs);
    return () => clearTimeout(handle);
  },
};

/** Whether an install registered or rotated the credential; a rejection reads as `ok: false`. */
export type InstallOutcome = { readonly ok: true } | { readonly ok: false };

/** What the user's Connect ends in. */
export type ConnectOutcome =
  | { readonly _tag: "Connected"; readonly environmentId: EnvironmentId }
  | {
      readonly _tag: "NotConnected";
      readonly reachability: Reachability;
      readonly descriptor: DescriptorFacts | null;
    }
  /** The account closed before the Connect ended. */
  | { readonly _tag: "Closed" };

/** Where this tab keeps its intents (`sessionStorage` under the account key). */
export interface IntentStorage {
  readonly read: () => string | null;
  /** Null forgets them. */
  readonly write: (value: string | null) => void;
}

/** What our verb asks: the adapter stamps it with the time it was accepted. */
export type IntentRequest =
  | {
      readonly kind: "restart" | "enable" | "upgrade-restart";
      /** The `initAt` read before the verb was sent; null when it could not say. */
      readonly initAt?: string | null;
    }
  | { readonly kind: "update"; readonly from: string | null };

/** How long the read before a restart verb may hold the verb back. */
export const INIT_AT_READ_DEADLINE_MS = 3_000;
