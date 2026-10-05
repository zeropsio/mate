/**
 * Where an app starts the data layer for its signed-in account: the organization's Zerops
 * navigation, supervised for as long as the app shows that organization. The app owns the store
 * (one per account) and stops the navigation when the organization or the account changes.
 *
 * @module data/account
 */
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { zeropsNavigationLink, type ZeropsWire } from "./adapters/zerops.ts";
import type { DetailDemand } from "./demand.ts";
import type { AccountStore } from "./store.ts";
import type { StreamFault } from "./streamMachine.ts";
import { superviseLink, type LinkSignal } from "./supervisor.ts";

export interface RunningLink {
  /** The person's "try now", or a changed input a refusal was decided over. */
  readonly signal: (signal: LinkSignal) => void;
  /** A screen's hold on a detail while it is drawn; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Ends the demand: the link and its scopes pause, their facts stay. */
  readonly stop: () => void;
}

export function startZeropsNavigation(options: {
  readonly orgId: string;
  readonly store: AccountStore;
  readonly wire: ZeropsWire;
  readonly repairSession: Effect.Effect<void, StreamFault>;
}): RunningLink {
  const { store } = options;
  // Subscription names only need to differ within one receiver.
  let subscriptions = 0;
  const link = zeropsNavigationLink({
    orgId: options.orgId,
    wire: options.wire,
    store,
    makeId: () => `subscription-${(subscriptions += 1)}`,
  });
  const supervisor = Effect.runSync(
    superviseLink({ ...link, store, repairSession: options.repairSession }),
  );
  const fiber = Effect.runFork(supervisor.run);
  return {
    signal: (signal) => void Effect.runFork(supervisor.signal(signal)),
    demandDetail: link.demandDetail,
    stop: () => void Effect.runFork(Fiber.interrupt(fiber)),
  };
}
