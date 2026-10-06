/**
 * What a probe of a Mate's container reads (DESIGN §2.C C6, §4.5 probes): its descriptor and its
 * `/healthz`, and how often a container's level asks for them to be read. The Mate adapter
 * (`data/adapters/mate.ts`) runs the probes, for the Mates something waits on and no other.
 *
 * - A descriptor's `zerops.identity` keeps `unknown` apart from `failed`: `failed` means the Mate
 *   could not check, never a refusal.
 * - A Mate is read once per connection attempt — its door's descriptor read — and polled only
 *   while it comes up or the person waits on it: from 2 s backing off to 60 s
 *   (`POLL_INTERVALS_MS`), from 10 s once that is overdue (`OVERDUE_POLL_INTERVALS_MS`). A push of
 *   its status, a connect failure or a wake reads it once more. Never at a fixed interval. Each
 *   probe ends by `PROBE_DEADLINE_MS` as `unreachable`.
 * - A tab hidden for `HIDDEN_PROBE_PAUSE_MS` probes nothing until it is shown again.
 */
import type { Instant } from "../data/access/grant.ts";
import type { DescriptorFacts } from "./environmentMachine.ts";

/** What one probe of an origin concluded (`containerHealth.ts` reads it). */
export type ProbeReading =
  /**
   * The descriptor answered: Mate is up. `projectId` is the project it states, null outside
   * Zerops mode; `initAt` is `/healthz`'s, read beside it.
   */
  | {
      readonly kind: "ready";
      readonly descriptor: DescriptorFacts;
      readonly projectId: string | null;
      readonly initAt: string | null;
    }
  /** `/healthz` answered, zcp's init not complete, and the descriptor did not: Mate is coming up. */
  | { readonly kind: "initializing"; readonly initAt: string | null }
  /**
   * `/healthz` says zcp's init is complete and the descriptor did not answer: the container is up
   * and its Mate is not answering — stopped, or crashed — never a container still coming up.
   */
  | { readonly kind: "not-answering"; readonly initAt: string | null }
  /** Neither route is served: an older zcp, or one with `ZCP_MATE_ENABLED` off. */
  | { readonly kind: "predates-mate" }
  /** No usable answer before the deadline: the container is away, or restarting. */
  | { readonly kind: "unreachable" };

/**
 * How often a container's level asks for its origin to be read. An `overdue` poll backs off
 * (`OVERDUE_POLL_INTERVALS_MS`): the level ran past its cap, or nothing but failed probes says the
 * container is coming up.
 */
export type ProbeCadence =
  | { readonly kind: "poll"; readonly overdue: boolean }
  | { readonly kind: "on-demand" }
  | { readonly kind: "none" };

export const PROBE_DEADLINE_MS = 8_000;
/** A container coming up is polled at these intervals, staying on the last. */
export const POLL_INTERVALS_MS: ReadonlyArray<number> = [
  2_000, 4_000, 8_000, 15_000, 30_000, 60_000,
];
/** An overdue poll reads at these intervals, staying on the last. */
export const OVERDUE_POLL_INTERVALS_MS: ReadonlyArray<number> = [10_000, 20_000, 40_000, 60_000];
export const HIDDEN_PROBE_PAUSE_MS = 60_000;

/**
 * What one probe asks of its read: `fresh` for a container coming up, or for a caller waiting on a
 * probe started after it asked — a reading another reader made a moment ago will not do.
 */
export interface ProbeAsk {
  readonly fresh: boolean;
}

/**
 * What one probe reads: `fresh` as asked, and `initAt` — `/healthz` beside the descriptor — for a
 * container coming up or a caller waiting on a probe started now, whose restart is judged by it.
 */
export interface ProbeRead extends ProbeAsk {
  readonly initAt: boolean;
}

/**
 * What one probe read, and when the read it rests on was sent: a descriptor another reader read a
 * moment ago (`descriptorShare.ts`) is as old as that read, never as new as the probe.
 */
export interface ProbeAnswer {
  readonly reading: ProbeReading;
  readonly sentAt: Instant;
}
