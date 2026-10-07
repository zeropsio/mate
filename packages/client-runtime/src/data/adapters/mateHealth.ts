import { mateSourceLink, classifyMateSourceFailure } from "./mateSource.ts";
/**
 * A Mate's health straight from the Mate the person has open (`subscribeZeropsHealth`): one
 * link per Mate, by its project, observed only while the app holds the Mate open. Each session of
 * the Mate's socket starts its answer again: its first value is the scope's baseline, each later
 * one a push. Every value goes into the `mateHealth` family with the Mate's own revision, the
 * same family HQ's relay writes, and the reducer keeps the newer.
 *
 * The wire's session ending, or its stream failing, ends the attempt with a classified fault; a
 * Mate without the method (one from before the health value) is `unsupported`, and HQ's relay
 * of its overview stays its word.
 *
 * @module data/adapters/mateHealth
 */
import {
  EnvironmentAuthorizationError,
  WS_METHODS,
  type EnvironmentId,
  type MateHealth,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";

import { mateHealthScope } from "../families/mateHealth.ts";
import { linkKeys } from "../model.ts";
import type { AccountStore } from "../store.ts";

/** What one Mate's socket says of its health: a session opening, its values, its end. */
export type MateHealthEvent =
  | { readonly kind: "session" }
  | { readonly kind: "session-lost" }
  | { readonly kind: "value"; readonly value: MateHealth };

/** The Mate's socket failed under the health stream: a transient, whatever its cause. */
export class MateHealthLost extends Data.TaggedError("MateHealthLost")<{
  readonly message: string;
}> {}

/** Today's Mate transport behind the adapter, or a fixture: its sessions' health, in order. */
export interface MateHealthWire {
  readonly open: Stream.Stream<MateHealthEvent, EnvironmentAuthorizationError | MateHealthLost>;
}

const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

export const classifyMateHealthFailure = (cause: Cause.Cause<unknown>) =>
  classifyMateSourceFailure(cause, "health");

export function mateHealthLink(options: {
  readonly projectId: string;
  readonly wire: MateHealthWire;
  readonly store: AccountStore;
}) {
  const { projectId } = options;
  return mateSourceLink({
    ...options,
    key: linkKeys.mateHealth(projectId),
    scope: mateHealthScope(projectId),
    label: "health",
    row: (value) => ({
      family: "mateHealth",
      id: projectId,
      value,
      revision: { kind: "mate-attention", ...value.source, live: true },
    }),
  });
}

const SESSION: MateHealthEvent = { kind: "session" };
const LOST: MateHealthEvent = { kind: "session-lost" };

/**
 * Today's transport: the Mate's socket in the app's connection registry. Each session asks for the
 * health anew; no session is a lost one. A failure that is not the Mate's refusal is the socket
 * failing under it; a Mate without the method dies with the server's own words, which the link
 * reads as unsupported.
 */
export function makeMateHealthWire(options: {
  readonly registry: EnvironmentRegistry["Service"];
  readonly environmentId: EnvironmentId;
}): MateHealthWire {
  const sessions = Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.make(LOST),
            onSome: (session) =>
              Stream.concat(
                Stream.make(SESSION),
                session.client[WS_METHODS.subscribeZeropsHealth]({}).pipe(
                  Stream.map((value): MateHealthEvent => ({ kind: "value", value })),
                  Stream.mapError((error) =>
                    isAuthorizationError(error)
                      ? error
                      : new MateHealthLost({ message: error.message }),
                  ),
                ),
              ),
          }),
        ),
      ),
    ),
  );
  return { open: options.registry.followStream(options.environmentId, sessions) };
}
