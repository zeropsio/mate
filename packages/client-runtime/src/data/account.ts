/**
 * Where an app starts the data layer for its signed-in account: the organization's Zerops
 * navigation, supervised for as long as the app shows that organization. The app owns the store
 * (one per account) and stops the navigation when the organization or the account changes.
 *
 * @module data/account
 */
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { hqNavigationLink, type HqMoveOffers, type HqWire } from "./adapters/hq.ts";
import { zeropsNavigationLink, type ZeropsWire } from "./adapters/zerops.ts";
import type { DetailDemand } from "./demand.ts";
import { familySpec } from "./families/index.ts";
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

export interface RunningHq extends RunningLink {
  /** Asks HQ where a Mate may move, as the move opens. */
  readonly moveOffers: (projectId: string) => Promise<HqMoveOffers>;
  /** Tells HQ the reader saw these results of a Mate. */
  readonly seen: (projectId: string, resultIds: ReadonlyArray<string>) => void;
}

/**
 * The organization's HQ navigation over its wire: one socket, its scopes resumed from their
 * cursors across segments and attempts. A session HQ ended (`4401`) is forgotten by the wire, so
 * the repair is the next attempt's ticket, through HQ's door; a second such ending refuses.
 */
export function startHqNavigation(options: {
  readonly orgId: string;
  readonly store: AccountStore;
  readonly wire: HqWire;
}): RunningHq {
  const { store } = options;
  const link = hqNavigationLink(options);
  const supervisor = Effect.runSync(superviseLink({ ...link, store, repairSession: Effect.void }));
  const fiber = Effect.runFork(supervisor.run);
  return {
    signal: (signal) => void Effect.runFork(supervisor.signal(signal)),
    demandDetail: link.demandDetail,
    moveOffers: (projectId) => Effect.runPromise(link.moveOffers(projectId)),
    seen: (projectId, resultIds) => void Effect.runFork(link.seen(projectId, resultIds)),
    stop: () => {
      link.stop();
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

/** The account's observation, as an app holds it: the organization shown, and the details held. */
export interface AccountObservation {
  /** The organization the app shows now; `null` stops observing. */
  readonly show: (orgId: string | null) => void;
  /**
   * The organization's HQ, once its official HQ is known; `null` while it has none, or none is
   * known. It is observed while its organization is the one shown — named before, from then on.
   */
  readonly showHq: (hq: { readonly orgId: string; readonly wire: HqWire } | null) => void;
  /** Asks the shown organization's HQ where a Mate may move; refused without one. */
  readonly moveOffers: (projectId: string) => Promise<HqMoveOffers>;
  /** Tells the shown organization's HQ the reader saw these results of a Mate. */
  readonly seen: (projectId: string, resultIds: ReadonlyArray<string>) => void;
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
  /** The HQ the app named last, and the one observed: only while it is the shown organization's. */
  let wantedHq: { readonly orgId: string; readonly wire: HqWire } | null = null;
  let hq: { readonly orgId: string; readonly wire: HqWire; readonly link: RunningHq } | null = null;
  // Every accepted operation holds the detail its handle is observed in until it settles: a
  // standing demand at its owner, whichever organization is shown, from the first shown on until
  // the observation stops — and again if it is shown after that.
  let stopStanding: (() => void) | null = null;
  let closed = false;
  /** A screen's hold, carried by the link of its family's source while one runs. */
  interface Hold {
    readonly demand: DetailDemand;
    readonly source: "zerops" | "hq";
    release: (() => void) | null;
  }
  const holds = new Set<Hold>();
  const linkOf = (source: Hold["source"]): RunningLink | null =>
    source === "hq" ? (hq?.link ?? null) : (shown?.link ?? null);
  const attach = (source: Hold["source"]) => {
    for (const hold of holds)
      if (hold.source === source) hold.release = linkOf(source)?.demandDetail(hold.demand) ?? null;
  };
  const detach = (source: Hold["source"]) => {
    for (const hold of holds) {
      if (hold.source !== source) continue;
      hold.release?.();
      hold.release = null;
    }
  };
  const stopHq = () => {
    if (hq === null) return;
    detach("hq");
    hq.link.stop();
    hq = null;
  };
  /** Observes the HQ named for the organization shown, and none other. */
  const followHq = () => {
    const next = wantedHq !== null && wantedHq.orgId === shown?.orgId && !closed ? wantedHq : null;
    if (hq !== null && next !== null && hq.wire === next.wire) return;
    stopHq();
    if (next === null) return;
    hq = { ...next, link: startHqNavigation({ ...next, store: options.store }) };
    attach("hq");
  };
  const observation: AccountObservation = {
    show: (orgId) => {
      if (shown?.orgId === orgId || (closed && orgId !== null)) return;
      if (shown !== null) {
        stopHq();
        detach("zerops");
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
      attach("zerops");
      followHq();
    },
    showHq: (next) => {
      wantedHq = next;
      followHq();
    },
    moveOffers: (projectId) =>
      hq === null
        ? Promise.reject(new Error("No HQ is observed for the organization shown."))
        : hq.link.moveOffers(projectId),
    seen: (projectId, resultIds) => hq?.link.seen(projectId, resultIds),
    demandDetail: (demand) => {
      const source = familySpec(demand.family).scope.source === "hq" ? "hq" : "zerops";
      const hold: Hold = { demand, source, release: null };
      hold.release = linkOf(source)?.demandDetail(demand) ?? null;
      holds.add(hold);
      return () => {
        if (!holds.delete(hold)) return;
        hold.release?.();
      };
    },
    retry: () => {
      shown?.link.signal("manual-retry");
      hq?.link.signal("manual-retry");
    },
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
