/**
 * A Mate's ticket as the connection runtime asks for it (spec-mate §3.8): one HQ ticket per
 * attempt, and HQ's refusal told as what it means for reconnecting. Only HQ saying the person may
 * not open the Mate ends it (`read-only`); everything else — no link, no acknowledgement, a
 * follower, an unreachable HQ, a session being renewed — waits for the next try.
 */
import * as Effect from "effect/Effect";

import {
  ConnectionBlockedError,
  ConnectionTransientError,
  type ConnectionAttemptError,
} from "../../connection/model.ts";
import type { IssuedMateTicket, MateTicketIssuerService } from "../../platform/capabilities.ts";
import { HqError, type HqApi } from "../../zerops/hq/client.ts";

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
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: cause.code === "mate_not_connected" ? notConnected(cause.reason) : cause.message,
  });
}

const NO_HQ = new HqError({
  kind: "unavailable",
  code: "no_session",
  message: "HQ is not signed in to for this organisation yet.",
});

/**
 * The connection runtime's ticket issuer over HQ's `mateTicket`, in the Mate's organisation: `hqOf`
 * names the HQ API signed in to it, none while there is none yet.
 */
export function mateTicketIssuer(
  hqOf: (orgId: string) => Pick<HqApi, "mateTicket"> | null,
): MateTicketIssuerService {
  return {
    issue: ({ orgId, projectId }) =>
      Effect.tryPromise({
        try: (signal) => {
          const hq = hqOf(orgId);
          return hq === null ? Promise.reject(NO_HQ) : hq.mateTicket(projectId, signal);
        },
        catch: attemptErrorOf,
      }).pipe(
        Effect.map((issued): IssuedMateTicket => ({
          ticket: issued.ticket,
          origin: issued.origin,
        })),
      ),
  };
}
