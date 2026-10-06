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
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { holdStandingDemands } from "./operations/standing.ts";
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

/** The account's observation, as an app holds it: the organization shown, and the details held. */
export interface AccountObservation {
  /** The organization the app shows now; `null` stops observing. */
  readonly show: (orgId: string | null) => void;
  /**
   * A screen's hold on a detail while it is drawn, whichever organization is shown: held before
   * one is, it is read once one is; a switch reads it again under the new one.
   */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** The person's "try now". */
  readonly retry: () => void;
  /** Ends the observation: no organization shown, and its operations' standing demands let go. */
  readonly stop: () => void;
  /**
   * Ends it with its account: stopped, and its store closed, so the account's registry may be
   * disposed right after — whatever still arrives publishes nothing.
   */
  readonly close: () => void;
  /** Whether it was closed with its account: its registry may be gone. */
  readonly closed: () => boolean;
}

export function observeAccount(options: {
  readonly store: AccountStore;
  readonly wire: ZeropsWire;
  readonly repairSession: Effect.Effect<void, StreamFault>;
  /** The operation kinds whose open operations hold their details; the account's registry. */
  readonly kinds?: ReadonlyArray<RegisteredOperationKind>;
}): AccountObservation {
  let shown: { readonly orgId: string; readonly link: RunningLink } | null = null;
  // Every accepted operation holds the detail its handle is observed in until it settles: a
  // standing demand at its owner, whichever organization is shown, from the first shown on until
  // the observation stops — and again if it is shown after that.
  let stopStanding: (() => void) | null = null;
  let closed = false;
  const holds = new Set<{ readonly demand: DetailDemand; release: (() => void) | null }>();
  const observation: AccountObservation = {
    show: (orgId) => {
      if (shown?.orgId === orgId || (closed && orgId !== null)) return;
      if (shown !== null) {
        for (const hold of holds) {
          hold.release?.();
          hold.release = null;
        }
        shown.link.stop();
        shown = null;
      }
      if (orgId === null) return;
      stopStanding ??= holdStandingDemands({
        store: options.store,
        demandDetail: observation.demandDetail,
        ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
      });
      const link = startZeropsNavigation({ ...options, orgId });
      shown = { orgId, link };
      for (const hold of holds) hold.release = link.demandDetail(hold.demand);
    },
    demandDetail: (demand) => {
      const hold = { demand, release: shown?.link.demandDetail(demand) ?? null };
      holds.add(hold);
      return () => {
        if (!holds.delete(hold)) return;
        hold.release?.();
      };
    },
    retry: () => shown?.link.signal("manual-retry"),
    stop: () => {
      stopStanding?.();
      stopStanding = null;
      observation.show(null);
    },
    close: () => {
      closed = true;
      observation.stop();
      options.store.close();
    },
    closed: () => closed,
  };
  return observation;
}
