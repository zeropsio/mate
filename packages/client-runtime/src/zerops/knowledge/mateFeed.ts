/**
 * A zcp feed a Mate relays over its WebSocket, as knowledge (DESIGN §2.C C12–C13, §3.5).
 *
 * The feeds are snapshot-typed: every frame is the whole state, so a frame is a complete, live
 * value. The feed is
 *
 * - `unread` until it is asked, waiting for the Mate while there is no session;
 * - `reading` from the first ask until the first frame;
 * - `known(stale)` after a disconnect, the value kept, and `known(revalidating)` once a new
 *   session asks again, until that session's first frame;
 * - `failed` when the ask fails before any frame. No timer retries it: each session asks once,
 *   since only a restarted Mate can answer differently. An old Mate without the RPC
 *   (`unsupported`) keeps its failure through a new session's ask rather than reading again;
 *   only a frame, from a Mate updated since, replaces it.
 *
 * A pure reducer: the adapter stamps each event with the wall time it arrived.
 */
import { advance, newCell, type Cell, type FailureReason, type Known } from "./known.ts";

export type MateFeedEvent<T> =
  /** A session is up and the feed's RPC was asked on it. */
  | { readonly kind: "asked"; readonly atMs: number }
  | { readonly kind: "frame"; readonly value: T; readonly atMs: number }
  /** The Mate has no session. */
  | { readonly kind: "disconnected"; readonly atMs: number }
  /** The ask failed on this session. */
  | { readonly kind: "failed"; readonly failure: FailureReason; readonly atMs: number };

/** The key of a feed's state. Not exported: only this module reaches the cell (§3.6). */
const state = Symbol("MateFeed.state");

interface MateFeedState<T> {
  /** Outside platform access (scope `null`), so never withheld. */
  readonly cell: Cell<T>;
  /** The newest ordinal handed out; a read start, a frame and a failure each take the next one. */
  readonly ordinal: number;
}

/** Opaque: folded by `foldMateFeed`, read by `mateFeedKnown`. */
export interface MateFeed<T> {
  readonly [state]: MateFeedState<T>;
}

const feedOf = <T>(cell: Cell<T>, ordinal: number): MateFeed<T> => ({
  [state]: { cell, ordinal },
});

export const mateFeed = <T>(): MateFeed<T> => feedOf(newCell<T>(null), 0);

export function foldMateFeed<T>(feed: MateFeed<T>, event: MateFeedEvent<T>): MateFeed<T> {
  const { cell } = feed[state];
  const ordinal = feed[state].ordinal + 1;
  const knowledge = cell.held;
  switch (event.kind) {
    case "asked":
      if (knowledge.state === "known")
        return feedOf(
          advance(cell, { kind: "source", freshness: "revalidating" }, event.atMs),
          feed[state].ordinal,
        );
      if (knowledge.state === "failed" && knowledge.failure.kind === "unsupported") return feed;
      return feedOf(
        advance(cell, { kind: "read-started", ordinal, atMs: event.atMs }, event.atMs),
        ordinal,
      );
    case "frame":
      return feedOf(
        advance(
          cell,
          {
            kind: "pushed",
            ordinal,
            value: event.value,
            coverage: "complete",
            atMs: event.atMs,
          },
          event.atMs,
        ),
        ordinal,
      );
    case "disconnected":
      return feedOf(
        advance(
          cell,
          knowledge.state === "unread"
            ? { kind: "waiting", on: "mate-session" }
            : { kind: "source", freshness: "recovering", retryAtMs: null },
          event.atMs,
        ),
        feed[state].ordinal,
      );
    case "failed":
      return feedOf(
        advance(
          cell,
          { kind: "read-failed", ordinal, failure: event.failure, retryAtMs: null },
          event.atMs,
        ),
        ordinal,
      );
  }
}

/** The feed's public read. Its cell is never withheld, so what it holds is what it shows. */
export const mateFeedKnown = <T>(feed: MateFeed<T>): Known<T> => feed[state].cell.held;
