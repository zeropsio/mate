/**
 * A Mate connection lives as long as HQ's grant (`grantSeconds`, wire-grant) unless the browser
 * presents a fresh ticket on it (`zerops.grant.extend`). This schedule extends it at 80 % of the
 * last grant: HQ asked with `extend: true`, its ticket presented through the Mate's RPC, whose
 * answer is the next grant. One extension at a time, nothing kept beyond the connection's scope.
 */
import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ConnectionGrant } from "../connection/model.ts";
import { reconnectWaitMs } from "../connection/reconnectSchedule.logic.ts";
import type { WsRpcProtocolClient } from "./protocol.ts";

/** The share of a grant after which the browser extends it: 180 s of 900 s left for a late timer. */
const EXTEND_AT = 0.8;

/** A grant in force: since when (ms) and for how many seconds. */
export interface GrantInForce {
  readonly since: number;
  readonly seconds: number;
}

/**
 * How long to wait (ms) before the next ask for an extension of `grant`, at `now`, after `failures`
 * transient failures since it began: 80 % into the grant, then the reconnect ladder's steps after
 * each failure. `null` once the next step would come after the grant ends: the connection is left
 * to the Mate.
 */
export function nextExtensionWaitMs(
  grant: GrantInForce,
  failures: number,
  now: number,
): number | null {
  if (failures === 0) return Math.max(0, grant.since + grant.seconds * 1000 * EXTEND_AT - now);
  const wait = reconnectWaitMs(failures, true);
  return now + wait < grant.since + grant.seconds * 1000 ? wait : null;
}

/**
 * Extends the connection's grant before each one runs out, until HQ or the Mate refuses or the
 * grant ends with HQ still unanswered. Runs in the connection's scope and ends with it.
 */
export const extendGrant = Effect.fnUntraced(function* (input: {
  readonly environmentId: EnvironmentId;
  readonly grant: ConnectionGrant;
  readonly client: WsRpcProtocolClient;
}) {
  let grant: GrantInForce = { since: yield* Clock.currentTimeMillis, seconds: input.grant.seconds };
  let failures = 0;
  for (;;) {
    const wait = nextExtensionWaitMs(grant, failures, yield* Clock.currentTimeMillis);
    if (wait === null) return;
    yield* Effect.sleep(wait);
    // The Mate counts the new grant from the ticket's issue, so this ask's start is the
    // conservative beginning of it.
    const askedAt = yield* Clock.currentTimeMillis;
    const asked = yield* Effect.result(input.grant.ask);
    if (Result.isFailure(asked)) {
      if (asked.failure._tag === "ConnectionBlockedError") return;
      failures += 1;
      continue;
    }
    const extended = yield* Effect.result(
      input.client[WS_METHODS.zeropsExtendGrant]({ ticket: asked.success.ticket }),
    );
    // `ZeropsGrantExtensionError` leaves only a reconnect with a new ticket, `EnvironmentAuthorizationError`
    // is a Mate with nothing to extend, and a transport failure is the connection ending.
    if (Result.isFailure(extended)) return;
    grant = { since: askedAt, seconds: extended.success.grantSeconds };
    failures = 0;
    yield* Effect.logInfo("Mate connection grant extended.", {
      environmentId: input.environmentId,
      grantSeconds: grant.seconds,
    });
  }
});
