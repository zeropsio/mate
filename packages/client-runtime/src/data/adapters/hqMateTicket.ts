/**
 * A Mate's ticket as the connection runtime asks for it (spec-mate §3.8): one HQ ticket per
 * attempt, and HQ's refusal told as what it means for reconnecting. Only HQ saying the person may
 * not open the Mate ends it — their role sees it and may not open it, or the Mate's own live list
 * does not admit them (`read-only`), or HQ has no Mate there for them (`not-found`); everything
 * else — no link, no acknowledgement, a follower, an unreachable HQ, a session being renewed —
 * waits for the next try.
 */
import * as Effect from "effect/Effect";

import {
  ConnectionBlockedError,
  ConnectionTransientError,
  type ConnectionAttemptError,
} from "../../connection/model.ts";
import type { IssuedMateTicket, MateTicketIssuerService } from "../../platform/capabilities.ts";
import { HqError, type HqApi, type HqMateTicket } from "../../zerops/hq/client.ts";
import { ZEROPS_READ_ONLY_DOOR_REASON } from "../../zerops/mateAccess.ts";
import { accessEnded, SESSION_REFUSED_WORDS } from "./accessEnded.ts";

/** HQ's codes when the Mate refuses on the person's role or its own list. */
const PROJECT_REFUSALS = new Set([ZEROPS_READ_ONLY_DOOR_REASON, "not_in_list"]);

const notConnected = (reason: string | undefined): string => {
  switch (reason) {
    case "no-ack":
      return "Mate did not acknowledge the ticket (no-ack).";
    default:
      return "Mate not connected";
  }
};

function attemptErrorOf(cause: unknown): ConnectionAttemptError {
  if (!(cause instanceof HqError)) {
    return new ConnectionTransientError({ reason: "network", detail: "HQ could not be reached." });
  }
  if (cause.code === "forbidden" && cause.reason === "not_mate_opener") {
    return new ConnectionBlockedError({
      reason: "read-only",
      detail: "Your role on this Mate's project lets you see it, not open it.",
    });
  }
  if (cause.kind === "refused" && PROJECT_REFUSALS.has(cause.code)) {
    return new ConnectionBlockedError({
      reason: "read-only",
      detail: "This Mate's project does not admit you.",
    });
  }
  if (cause.code === "mate_not_found") {
    return new ConnectionBlockedError({
      reason: "not-found",
      detail: "HQ has no Mate here you may open.",
    });
  }
  if (cause.code === "network") {
    return new ConnectionTransientError({ reason: "network", detail: cause.message });
  }
  if (cause.kind === "unavailable") {
    return new ConnectionTransientError({ reason: "endpoint-unavailable", detail: cause.message });
  }
  if (cause.code === "mate_not_connected" && cause.reason === "no-link") {
    return new ConnectionTransientError({
      reason: "mate-not-linked",
      detail: "Mate has no connection to HQ (no-link).",
    });
  }
  if (cause.code === "mate_not_connected") {
    return new ConnectionTransientError({
      reason: "remote-unavailable",
      detail: notConnected(cause.reason),
    });
  }
  const detail = accessEnded(cause) === "session-ended" ? SESSION_REFUSED_WORDS : cause.message;
  return new ConnectionTransientError({ reason: "remote-unavailable", detail, hqWords: detail });
}

/**
 * An extension's refusal ends its connection's extending: past `attemptErrorOf`'s blocks, any answer
 * of HQ's that says no (`403`, or a `409 credential_required` the door re-entry did not heal), but
 * not `mate_not_connected`, which a next ask may find linked again.
 */
function extensionErrorOf(cause: unknown): ConnectionAttemptError {
  const verdict = attemptErrorOf(cause);
  if (
    verdict._tag === "ConnectionTransientError" &&
    cause instanceof HqError &&
    cause.kind === "refused" &&
    cause.code !== "mate_not_connected"
  ) {
    return new ConnectionBlockedError({ reason: "permission", detail: cause.message });
  }
  return verdict;
}

const NO_HQ = new HqError({
  kind: "unavailable",
  code: "no_session",
  message: "HQ is not signed in to for this organisation yet.",
});

/**
 * How long a ticket minted ahead (`prime`) waits for the attempt that presents it: past it, the
 * attempt asks for its own. Far inside the ticket's own life (60 s, `expiresIn`), which is checked
 * too: a ticket presented is one the Mate still holds.
 */
export const PRIMED_TICKET_MS = 10_000;

/** A ticket's life, as HQ issues it (`TICKET_SECONDS`) and the Mate holds it at most. */
const TICKET_LIFE_MS = 60_000;

export interface MateTicketPrimer extends MateTicketIssuerService {
  /**
   * Asks HQ now for the ticket the Mate's next connection attempt will present — beside the
   * descriptor read that precedes the attempt, never after it. Only that HQ's next attempt for
   * the project within `PRIMED_TICKET_MS` presents it, once; nothing is asked while an attempt is
   * already asking, nor again within a ticket's life. A ticket never presented ends unused: one use, its life 60 s, held by nobody.
   */
  readonly prime: (mate: { readonly orgId: string; readonly projectId: string }) => void;
}

const issuedOf = (issued: HqMateTicket): IssuedMateTicket => ({
  ticket: issued.ticket,
  origin: issued.origin,
  grantSeconds: issued.grantSeconds,
});

/**
 * The connection runtime's ticket issuer over HQ's `mateTicket`, in the Mate's organisation: `hqOf`
 * names the HQ API signed in to it, none while there is none yet.
 */
export function mateTicketIssuer(
  hqOf: (orgId: string) => Pick<HqApi, "mateTicket"> | null,
  now: () => number = Date.now,
): MateTicketPrimer {
  type Ask = Pick<HqApi, "mateTicket">;
  /** Each project's ticket minted ahead: by whose HQ, when. */
  const primed = new Map<
    string,
    { readonly hq: Ask; readonly at: number; readonly answer: Promise<HqMateTicket> }
  >();
  /** When each project's ticket was last asked for ahead, and by whose HQ. */
  const lastPrimed = new Map<string, { readonly hq: Ask; readonly at: number }>();
  /** The attempts asking for a ticket now, by project. */
  const asking = new Map<string, number>();
  const keyOf = (orgId: string, projectId: string) => JSON.stringify([orgId, projectId]);
  /** A ticket minted ahead by this HQ, fresh: taken once; else none. */
  const take = (key: string, hq: Ask): { at: number; answer: Promise<HqMateTicket> } | null => {
    const held = primed.get(key);
    primed.delete(key);
    return held !== undefined && held.hq === hq && now() - held.at < PRIMED_TICKET_MS ? held : null;
  };
  const ask = (hq: Ask, key: string, projectId: string, signal: AbortSignal) => {
    const held = take(key, hq);
    if (held === null) return hq.mateTicket(projectId, signal);
    // A transient refusal or an expired ticket needs the attempt's own request.
    return held.answer.then(
      (ticket) =>
        now() - held.at < ticket.expiresIn * 1000 ? ticket : hq.mateTicket(projectId, signal),
      (cause: unknown) => {
        if (attemptErrorOf(cause)._tag === "ConnectionBlockedError") throw cause;
        return hq.mateTicket(projectId, signal);
      },
    );
  };
  return {
    issue: ({ orgId, projectId }) =>
      Effect.tryPromise({
        try: async (signal) => {
          const hq = hqOf(orgId);
          if (hq === null) throw NO_HQ;
          const key = keyOf(orgId, projectId);
          asking.set(key, (asking.get(key) ?? 0) + 1);
          try {
            return await ask(hq, key, projectId, signal);
          } finally {
            const left = (asking.get(key) ?? 1) - 1;
            if (left === 0) asking.delete(key);
            else asking.set(key, left);
          }
        },
        catch: attemptErrorOf,
      }).pipe(Effect.map(issuedOf)),
    extend: ({ orgId, projectId }) =>
      Effect.tryPromise({
        try: (signal) => {
          const hq = hqOf(orgId);
          if (hq === null) throw NO_HQ;
          return hq.mateTicket(projectId, signal, { extend: true });
        },
        catch: extensionErrorOf,
      }).pipe(Effect.map(issuedOf)),
    prime: ({ orgId, projectId }) => {
      const hq = hqOf(orgId);
      const key = keyOf(orgId, projectId);
      if (hq === null || asking.has(key)) return;
      // Once per ticket's life: an exchange tried again — its retries, a repair — asks nothing
      // ahead again; its attempts ask for their own.
      const last = lastPrimed.get(key);
      if (last !== undefined && last.hq === hq && now() - last.at < TICKET_LIFE_MS) return;
      const answer = hq.mateTicket(projectId);
      // The attempt hears its refusal; it must never become an unhandled rejection.
      answer.catch(() => undefined);
      primed.set(key, { hq, at: now(), answer });
      lastPrimed.set(key, { hq, at: now() });
    },
  };
}
