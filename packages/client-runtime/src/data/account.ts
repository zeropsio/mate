/**
 * Where an app starts the data layer for its signed-in account: the organization's Zerops
 * navigation, supervised for as long as the app shows that organization. The app owns the store
 * (one per account) and stops the navigation when the organization or the account changes.
 *
 * @module data/account
 */
import type { CompareQuery, CompareResponse } from "@t3tools/shared/hqChanges";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { hqNavigationLink, type HqMoveOffers, type HqWire } from "./adapters/hq.ts";
import { mateHealthLink, type MateHealthWire } from "./adapters/mateHealth.ts";
import { mateAttentionLink, type MateAttentionWire } from "./adapters/mateAttention.ts";
import { zeropsNavigationLink, type ZeropsWire } from "./adapters/zerops.ts";
import { detailScopeOf, type DetailDemand } from "./demand.ts";
import { hqPressesScope } from "./families/hqNavigation.ts";
import { familySpec } from "./families/index.ts";
import type { RegisteredOperationKind } from "./operations/kind.ts";
import { holdStandingDemands } from "./operations/standing.ts";
import { holdPlacedProjectRows } from "./placedRows.ts";
import { linkKeys } from "./model.ts";
import { streamOf } from "./reducer.ts";
import { readsOfState, type AccountStore, type ProjectionReads } from "./store.ts";
import type { StreamFault } from "./streamMachine.ts";
import { superviseLink, type LinkSignal } from "./supervisor.ts";

export interface RunningLink {
  /** The person's "try now", or a changed input a refusal was decided over. */
  readonly signal: (signal: LinkSignal) => void;
  /** A screen's hold on a detail while it is drawn; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Our own write changed a sampled detail: it is read again now, or on its next demand. */
  readonly revalidate: (demand: DetailDemand) => void;
  /** The person's "try again" on one detail. */
  readonly retryDetail: (demand: DetailDemand) => void;
  /** Renew a held own row without reviving a refusal. */
  readonly renew: (demand: DetailDemand) => void;
  /**
   * The viewer's access may have changed: every scope is registered again now, on a new receiver,
   * and a link refused or waiting to retry tries at once.
   */
  readonly reread: () => void;
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
    renew: link.renew,
    revalidate: link.revalidate,
    retryDetail: link.retryDetail,
    reread: () => {
      link.reread();
      Effect.runFork(supervisor.signal("input-changed"));
    },
    stop: () => {
      Effect.runSync(supervisor.release);
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

export interface RunningHq extends Omit<RunningLink, "revalidate" | "renew" | "reread"> {
  /** The same organization's HQ reached over a new wire: the next socket opens over it. */
  readonly rewire: (wire: HqWire) => void;
  /** Asks HQ where a Mate may move, as the move opens. */
  readonly moveOffers: (projectId: string) => Promise<HqMoveOffers>;
  /** Asks HQ what lies between two commits; rejects with HQ's words for why it did not answer. */
  readonly compare: (ask: CompareAsk) => Promise<CompareResponse>;
  /** Tells HQ the reader saw these results of a Mate. */
  readonly seen: (projectId: string, resultIds: ReadonlyArray<string>) => void;
  /** The person's role on a project changed: HQ's refused scopes of it are asked again. */
  readonly roleChanged: (projectId: string) => void;
}

/** A comparison asked of an application's repository, by its name: git's `base..head`. */
export type CompareAsk = { readonly appId: string; readonly repo: string } & CompareQuery;

/**
 * The organization's HQ navigation over its wire: one socket, its scopes resumed from their
 * cursors across segments and attempts. A session HQ ended (`4401`) is forgotten by the wire, so
 * the next attempt's ticket enters HQ's door. Only an actual refusal stops recovery.
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
    retryDetail: link.retryDetail,
    moveOffers: (projectId) => Effect.runPromise(link.moveOffers(projectId)),
    compare: (ask) =>
      // HQ's words for why it did not answer, as what the promise rejects with.
      Effect.runPromise(
        Effect.catch(link.compare(ask), (fault) => Effect.die(new Error(fault.message))),
      ),
    seen: (projectId, resultIds) => void Effect.runFork(link.seen(projectId, resultIds)),
    roleChanged: link.roleChanged,
    rewire: link.rewire,
    stop: () => {
      link.stop();
      Effect.runSync(supervisor.release);
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

/**
 * An open Mate's attention, straight from it, for as long as the app holds the Mate open: its own
 * link, supervised like the others; stopping it pauses the link and keeps what it said.
 */
export function startMateAttention(options: {
  readonly projectId: string;
  readonly store: AccountStore;
  readonly wire: MateAttentionWire;
}): Pick<RunningLink, "signal" | "stop"> {
  const { store } = options;
  const link = mateAttentionLink(options);
  const supervisor = Effect.runSync(superviseLink({ ...link, store, repairSession: Effect.void }));
  const fiber = Effect.runFork(supervisor.run);
  return {
    signal: (signal) => void Effect.runFork(supervisor.signal(signal)),
    stop: () => {
      Effect.runSync(supervisor.release);
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}
export function startMateHealth(options: {
  readonly projectId: string;
  readonly store: AccountStore;
  readonly wire: MateHealthWire;
}): Pick<RunningLink, "signal" | "stop"> {
  const supervisor = Effect.runSync(
    superviseLink({ ...mateHealthLink(options), store: options.store, repairSession: Effect.void }),
  );
  const fiber = Effect.runFork(supervisor.run);
  return {
    signal: (signal) => void Effect.runFork(supervisor.signal(signal)),
    stop: () => {
      Effect.runSync(supervisor.release);
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

/**
 * What a running press heard of its hold from its organization's HQ (`keepPress`): nothing yet,
 * held, held and then its stream gone, or — that stream back — HQ holds it no more: it lapsed.
 */
export type PressWatch = "waiting" | "held" | "dropped" | "lapsed";

/**
 * The next of {@link PressWatch} as HQ's presses scope reads now. A hold lives with its holder's
 * HQ stream: only a stream that went away and came back without it says it lapsed — HQ ending a
 * stage's hold at its registration, on a stream that stayed, is no lapse.
 */
export function pressWatch(
  watch: PressWatch,
  read: ProjectionReads,
  orgId: string,
  projectId: string,
): PressWatch {
  if (watch === "lapsed") return watch;
  const scope = hqPressesScope(orgId);
  if (read.stream(scope).phase !== "live") return watch === "waiting" ? watch : "dropped";
  const press = read.members(scope).ids.includes(projectId)
    ? read.fact("hqPress", projectId)
    : null;
  if (press?.kind === "known" && press.value.heldForMs > 0) return "held";
  return watch === "dropped" ? "lapsed" : watch;
}

/** An organization's HQ as the app names it.
 * ownerId identifies the accepting project and address; a new owner replaces its observation.
 */
export interface ShownHq {
  readonly orgId: string;
  readonly wire: HqWire;
  readonly ownerId?: string;
}

/** The account's observation, as an app holds it: the organization shown, and the details held. */
export interface AccountObservation {
  /** The organization the app shows now; `null` stops observing. */
  readonly show: (orgId: string | null) => void;
  /**
   * The organization's HQ once known, observed while its organization is the one shown — named
   * before, from then on.
   * Letting it go returns the completion of the queued release decision.
   */
  readonly showHq: (hq: ShownHq | null) => void | Promise<void>;
  /**
   * A running press's hold on its organization's HQ stream, whichever organization is shown: the
   * HQ last named for it stays observed until released — its hold at HQ lives with that stream —
   * and `lapsed` is called once HQ, its stream back after it went away, holds the press no more.
   */
  readonly keepPress: (orgId: string, projectId: string, lapsed: () => void) => () => void;
  /** Asks the shown organization's HQ where a Mate may move; refused without one. */
  readonly moveOffers: (projectId: string) => Promise<HqMoveOffers>;
  /** Asks the shown organization's HQ what lies between two commits; refused without one. */
  readonly compare: (ask: CompareAsk) => Promise<CompareResponse>;
  /** Tells the shown organization's HQ the reader saw these results of a Mate. */
  readonly seen: (projectId: string, resultIds: ReadonlyArray<string>) => void;
  /**
   * A screen's hold on a detail while it is drawn, whichever organization is shown: held before
   * one is, it is read once one is; a switch reads it again under the new one.
   */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /**
   * Holds a detail of the organization shown until its read settles, then lets it go: `true` once
   * it is read (or held read by another screen already), `false` once it failed, was refused or
   * let go — and at once with no organization shown, or with its link down or refused: a flow
   * that awaits it never waits for a link.
   */
  readonly readDetail: (demand: DetailDemand) => Promise<boolean>;
  /** Our own write changed a sampled detail of the organization shown: read it again. */
  readonly revalidate: (demand: DetailDemand) => void;
  /** The person's "try again" on one detail of the organization shown. */
  readonly retryDetail: (demand: DetailDemand) => void;
  /**
   * The person's role on a project of the organization shown changed in its live Zerops data
   * (`followMateRoles`): what its HQ refused of that project is asked again. A re-door is no
   * role change and lifts no refusal.
   */
  readonly roleChanged: (projectId: string) => void;
  /**
   * The person's view may have changed in this organization (`topic: "inventory"`): its Zerops
   * listing is read again while it is the one shown; another organization's is read when shown.
   */
  readonly rereadListing: (orgId: string) => void;
  /** The person's "try now". */
  readonly retry: () => void;
  /** Network or renderer returned: retry a recovering source without reviving refusals. */
  readonly resume: () => void;
  /**
   * Renews each held member row no push keeps current (a project's own row, whose grants only it
   * names): an access round's renewal of what the account knows of everybody's grants.
   */
  readonly renewHeld: () => void;
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
  /** Lets go of the own rows of the Mates HQ places that the shown roster does not list yet. */
  let stopPlaced: (() => void) | null = null;
  /** The HQ the app named last: observed while it is the shown organization's. */
  let wantedHq: ShownHq | null = null;
  /** The HQ named last for each organization: a running press keeps its own observed. */
  const named = new Map<string, ShownHq>();
  /** Each running press's organization, by its hold (`keepPress`). */
  const pressing = new Map<symbol, string>();
  /** Each observed HQ, by organization: the shown one's, and each a running press keeps. */
  const hqs = new Map<
    string,
    { wire: HqWire; readonly ownerId?: string; readonly link: RunningHq }
  >();
  /** The shown organization's HQ link, which carries the screens' HQ holds. */
  let hq: RunningHq | null = null;
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
  const linkOf = (source: Hold["source"]): Pick<RunningLink, "demandDetail"> | null =>
    source === "hq" ? hq : (shown?.link ?? null);
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
  /** The screens' HQ holds move to `link`. */
  const attachHq = (link: RunningHq | null) => {
    if (hq === link) return;
    if (hq !== null) detach("hq");
    hq = link;
    if (link !== null) attach("hq");
  };
  /**
   * Observes the HQ named for the organization shown, and the one of each organization a running
   * press keeps: one link, one socket, per organization.
   */
  const followHq = () => {
    const wanted = new Map<string, ShownHq>();
    if (!closed) {
      for (const orgId of pressing.values()) {
        const kept = named.get(orgId);
        if (kept !== undefined) wanted.set(orgId, kept);
      }
      if (wantedHq !== null && wantedHq.orgId === shown?.orgId)
        wanted.set(wantedHq.orgId, wantedHq);
    }
    for (const [orgId, running] of hqs) {
      const next = wanted.get(orgId);
      if (next !== undefined && next.ownerId === running.ownerId) {
        // Its HQ reached anew: the link and what it holds go on, its next socket over the new wire.
        if (running.wire !== next.wire) {
          running.link.rewire(next.wire);
          running.wire = next.wire;
        }
        continue;
      }
      if (hq === running.link) attachHq(null);
      running.link.stop();
      hqs.delete(orgId);
    }
    for (const [orgId, next] of wanted)
      if (!hqs.has(orgId))
        hqs.set(orgId, {
          wire: next.wire,
          ...(next.ownerId === undefined ? {} : { ownerId: next.ownerId }),
          link: startHqNavigation({ ...next, store: options.store }),
        });
    attachHq(shown === null ? null : (hqs.get(shown.orgId)?.link ?? null));
  };
  const observation: AccountObservation = {
    show: (orgId) => {
      if (shown?.orgId === orgId || (closed && orgId !== null)) return;
      if (shown !== null) {
        attachHq(null);
        detach("zerops");
        stopPlaced?.();
        stopPlaced = null;
        shown.link.stop();
        shown = null;
      }
      if (orgId === null) return followHq();
      stopStanding ??= holdStandingDemands({
        store: options.store,
        demandDetail: observation.demandDetail,
        revalidate: (demand) => shown?.link.revalidate(demand),
        ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
      });
      const link = startZeropsNavigation({ ...options, orgId });
      shown = { orgId, link };
      attach("zerops");
      stopPlaced = holdPlacedProjectRows({
        store: options.store,
        orgId,
        demandDetail: observation.demandDetail,
      });
      followHq();
    },
    showHq: (next) => {
      wantedHq = next;
      if (next !== null) {
        named.set(next.orgId, next);
        return followHq();
      }
      // Let go at the end of this turn, not at once: what names the HQ remounting names it again
      // in the same turn, and its link and socket go on.
      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          if (wantedHq === null) followHq();
          resolve();
        });
      });
    },
    keepPress: (orgId, projectId, lapsed) => {
      if (closed) return () => undefined;
      const press = Symbol(projectId);
      let watch: PressWatch = "waiting";
      let stopHearing: () => void = () => undefined;
      const release = () => {
        stopHearing();
        if (pressing.delete(press)) followHq();
      };
      pressing.set(press, orgId);
      followHq();
      const hear = () => {
        watch = pressWatch(watch, readsOfState(options.store.state()), orgId, projectId);
        if (watch !== "lapsed") return;
        release();
        lapsed();
      };
      stopHearing = options.store.subscribe(hear);
      hear();
      return release;
    },
    moveOffers: (projectId) =>
      hq === null
        ? Promise.reject(new Error("No HQ is observed for the organization shown."))
        : hq.moveOffers(projectId),
    compare: (ask) =>
      hq === null
        ? Promise.reject(new Error("No HQ is observed for the organization shown."))
        : hq.compare(ask),
    seen: (projectId, resultIds) => hq?.seen(projectId, resultIds),
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
    renewHeld: () => {
      if (shown === null) return;
      for (const { demand } of holds)
        if (
          familySpec(demand.family).details?.some(
            ({ suffix, member }) => suffix === demand.listing && member === true,
          ) === true
        )
          shown.link.renew(demand);
    },
    readDetail: (demand) =>
      new Promise((resolve) => {
        if (shown === null) return resolve(false);
        const scope = detailScopeOf(shown.orgId, demand);
        const link = linkKeys.zerops(shown.orgId);
        const release = observation.demandDetail(demand);
        // Waits only for a read the live link will make; a link down or refused is no answer.
        const settled = () => {
          const { phase } = streamOf(options.store.state(), scope);
          if (phase === "live") return true;
          if (phase === "connecting" || phase === "baselining") return null;
          return phase === "stale" && streamOf(options.store.state(), link).phase === "live"
            ? null
            : false;
        };
        const answer = settled();
        if (answer !== null) {
          release();
          return resolve(answer);
        }
        const stopHearing = options.store.subscribe(() => {
          const heard = settled();
          if (heard === null) return;
          stopHearing();
          release();
          resolve(heard);
        });
      }),
    revalidate: (demand) => shown?.link.revalidate(demand),
    retryDetail: (demand) => {
      if (familySpec(demand.family).scope.source === "hq") hq?.retryDetail(demand);
      else shown?.link.retryDetail(demand);
    },
    roleChanged: (projectId) => hq?.roleChanged(projectId),
    rereadListing: (orgId) => {
      if (shown?.orgId === orgId) shown.link.reread();
    },
    retry: () => {
      shown?.link.signal("manual-retry");
      for (const { link } of hqs.values()) link.signal("manual-retry");
    },
    resume: () => {
      shown?.link.signal("resume");
      for (const { link } of hqs.values()) link.signal("resume");
    },
    stop: () => {
      pressing.clear();
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
