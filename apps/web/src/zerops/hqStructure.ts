/**
 * The organization's structure, live from its HQ (ADR 0002, SPEC §3.5): one stream per
 * organization (`/api/structure/ws`) — the whole structure, then its changes — published
 * to `hqStructureAtom`, from which every surface places its projects (`hqPlacementsAtom`). The
 * same stream carries each application's Mates' changes (SPEC §3.2a, `hqChangesAtom`) and where
 * its releases, repository heads and recipe tiers (`appReads`), and the
 * Mates the reader may observe with the people its view names (`hqMatesAtom`, `hqPeopleAtom`) —
 * in atoms of their own, since a Mate at work moves them twice a second and the structure never.
 *
 * - **First paint:** nothing of HQ until it answers: no structure this browser kept.
 * - **HQ down:** the last known structure stands, and the view says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 * - Planned 100 s segments continue inside `streamStructure`; the live atoms remain current
 *   until the next snapshot. An unexpected end reconnects with visible backoff, preserving the
 *   last data. Refusals wait for a manual again; at the backoff cap a failure stays visible while
 *   attempts continue. A going-away (1001) gets one immediate attempt before backoff.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  HqError,
  applyChangesEvent,
  applyMatesEvent,
  applyPeopleEvent,
  applyAppReadsEvent,
  applyPressesEvent,
  applyStructureEvent,
  readHqHealth,
  type HqApi,
  type HqChanges,
  type HqMates,
  type HqAppReads,
  type HqHealth,
  type HqParts,
  type HqPresses,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { HqPeople } from "@t3tools/shared/hqMates";
import { useContext, useEffect } from "react";

import {
  hqMatesViewAtom,
  hqOfficialAtom,
  hqPeopleViewAtom,
  hqStructureAtom,
  type HqMatesView,
  type HqPeopleView,
  type HqStructureView,
} from "../state/zerops";
import { formatDayAwareTimestamp } from "../timestampFormat";
import {
  accountHqApi,
  nextHqStanding,
  useAccountHq,
  type AccountHq,
  type HqStanding,
} from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { whenShown } from "./whenShown";

/** A stream nothing came down for this long — three pings — is given up. */
export const HQ_STREAM_SILENCE_MS = 60_000;
const HQ_RECONNECT_FIRST_MS = 1_000;
const HQ_RECONNECT_CAP_MS = 30_000;

/** Explicit detail retries reuse the account's stream owner; they never write facts themselves. */
const snapshotReaders = new Map<string, Set<() => void>>();
export function requestHqSnapshot(organizationId: string): void {
  for (const read of snapshotReaders.get(organizationId) ?? []) read();
}

/**
 * Reads the organization's structure from its HQ until `signal` aborts, telling `publish` of every
 * state it reaches.
 */
export async function driveHqStructure(input: {
  readonly api: Pick<HqApi, "streamStructure">;
  readonly organizationId: string;
  readonly publish: (view: HqStructureView) => void;
  /** Told of the Mates and of the people apart from the structure: theirs change far more often. */
  readonly publishMates: (view: HqMatesView) => void;
  readonly publishPeople: (view: HqPeopleView) => void;
  readonly now: () => number;
  /** Told how each stream ended — the close code a break carried — and how long it lived (F26). */
  readonly log: (line: string) => void;
  /**
   * HQ's `/health`, read once after each attempt that failed, while the tab is visible — in a
   * hidden tab once it is shown: whether HQ is down, answers as a standby or an HQ that is not the
   * official one (`503 not_active`), or serves while it cannot check Zerops right now. Never read
   * while the stream serves: the stream says all of that itself.
   */
  readonly readHealth: () => Promise<HqHealth>;
  /**
   * Runs `run` now while the tab is shown, else once it is shown again (`whenShown.ts`); what it
   * returns stops waiting.
   */
  readonly whenShown: (run: () => void) => () => void;
  readonly signal: AbortSignal;
  readonly silenceMs?: number;
}): Promise<void> {
  const silenceMs = input.silenceMs ?? HQ_STREAM_SILENCE_MS;
  let view: HqStructureView = {
    organizationId: input.organizationId,
    structure: null,
    changes: null,
    appReads: null,
    readAt: null,
    current: false,
    unavailableSince: null,
    failure: null,
  };
  const publish = (next: HqStructureView) => {
    view = next;
    input.publish(view);
  };
  publish(view);
  let matesView: HqMatesView = {
    organizationId: input.organizationId,
    mates: null,
    current: false,
  };
  const publishMates = (next: HqMatesView) => {
    matesView = next;
    input.publishMates(matesView);
  };

  /** Each snapshot served: a health read that began before one is stale. */
  let served = 0;
  /** Each health read asked: only the newest one's answer counts. */
  let healthAsked = 0;
  let unwaitHealth = () => {};
  /**
   * Reads HQ's health now while the tab is shown, else once it is; `apply` takes its answer while
   * `wanted` and no newer read was asked. True when it was read now.
   */
  const askHealth = (apply: (health: HqHealth) => void, wanted: () => boolean): boolean => {
    unwaitHealth();
    let now = false;
    unwaitHealth = input.whenShown(() => {
      now = true;
      unwaitHealth = () => {};
      const asked = ++healthAsked;
      void input.readHealth().then((health) => {
        if (input.signal.aborted || asked !== healthAsked || !wanted()) return;
        apply(health);
      });
    });
    return now;
  };
  const standingAfterFailure = (since: number): HqStanding => {
    const previous: HqStanding = view.standing ?? { kind: "unknown" };
    const asked = served;
    const read = askHealth(
      (health) =>
        publish({
          ...view,
          standing: nextHqStanding(view.standing ?? { kind: "unknown" }, health, since),
        }),
      () => served === asked,
    );
    if (read) return previous;
    // Nothing is read while hidden: the stream's own failure stands, an unchecked HQ aside.
    return previous.kind === "unchecked" ? previous : { kind: "unavailable", since };
  };

  let backoffMs = HQ_RECONNECT_FIRST_MS;
  let firstReconnect = true;
  let attempt: AbortController | null = null;
  let requested = false;
  let again: (() => void) | null = null;
  const reread = () => {
    requested = true;
    attempt?.abort();
    again?.();
  };
  const readers = snapshotReaders.get(input.organizationId) ?? new Set();
  readers.add(reread);
  snapshotReaders.set(input.organizationId, readers);
  const abort = () => {
    attempt?.abort();
    again?.();
  };
  input.signal.addEventListener("abort", abort);
  try {
    while (!input.signal.aborted) {
      if (requested) {
        backoffMs = HQ_RECONNECT_FIRST_MS;
        firstReconnect = true;
        publish({
          ...view,
          current: false,
          failure: null,
          reconnecting: { delayMs: 0, capped: false },
        });
      }
      requested = false;
      const controller = new AbortController();
      attempt = controller;
      const openedAt = input.now();
      let silence = setTimeout(() => controller.abort(), silenceMs);
      let streamed: HqStructure | null = null;
      let changes: HqChanges | null = null;
      let appReads: HqAppReads | null = view.appReads;
      // The presses as the last stream left them, until this one's snapshot says them again.
      let presses: HqPresses | null = view.presses ?? null;
      let mates: HqMates | null = null;
      let people: HqPeople | null = null;
      /**
       * Whether HQ could check Zerops, as this stream last said: `null` before its first check, and
       * before its snapshot. A stream that serves is HQ answering as the official one, so one that
       * says nothing of its check serves as one yet to check.
       */
      let official: string | null = null;
      /**
       * The Core HQ runs, as this stream names it; none from a stream that names none, whose Core
       * HQ's card reads from Zerops for its update (`hqUpdateTrigger`).
       */
      let build: string | undefined;
      /** How HQ's parts stand, as this stream says them; none from a Core whose stream does not. */
      let parts: HqParts | undefined;
      const servingStanding = (): HqStanding => {
        const next = nextHqStanding(
          view.standing ?? { kind: "unknown" },
          healthOfOfficial(official),
          input.now(),
        );
        if (next.kind !== "healthy" && next.kind !== "unchecked") return next;
        return {
          kind: next.kind,
          ...(build === undefined ? {} : { build }),
          ...(parts === undefined ? {} : { parts }),
        };
      };
      if (view.current) publish({ ...view, current: false });
      let cause: unknown;
      let failure = "HQ's stream ended.";
      try {
        await input.api.streamStructure(
          {
            onAlive: () => {
              if (controller.signal.aborted) return;
              clearTimeout(silence);
              silence = setTimeout(() => controller.abort(), silenceMs);
              if (streamed !== null) view = { ...view, readAt: input.now() };
            },
            onEvent: (event) => {
              if (controller.signal.aborted) return;
              const previousMates = mates;
              const previousPeople = people;
              mates = applyMatesEvent(mates, event);
              people = applyPeopleEvent(people, event);
              if (event.kind === "snapshot" || mates !== previousMates)
                publishMates({ organizationId: input.organizationId, mates, current: true });
              if (event.kind === "snapshot" || people !== previousPeople)
                input.publishPeople({ organizationId: input.organizationId, people });
              if (event.kind === "parts") {
                parts = event.parts;
                if (streamed !== null) publish({ ...view, standing: servingStanding() });
                return;
              }
              if (event.kind === "official") {
                official = event.official;
                if (streamed !== null) publish({ ...view, standing: servingStanding() });
                return;
              }
              if (event.kind === "snapshot") {
                official = event.official ?? null;
                build = event.build;
                parts = event.parts;
                // Serving again: a health read still waiting on a failure is none of its business.
                unwaitHealth();
              }
              if (event.kind === "mate" || event.kind === "people") return;
              streamed = applyStructureEvent(streamed, event);
              changes = applyChangesEvent(changes, event);
              presses = applyPressesEvent(presses, event, input.now());
              appReads = applyAppReadsEvent(
                event.kind === "snapshot" ? view.appReads : appReads,
                event,
              );
              if (streamed === null) return;
              const readAt = input.now();
              backoffMs = HQ_RECONNECT_FIRST_MS;
              firstReconnect = true;
              served += 1;
              publish({
                ...view,
                structure: streamed,
                changes,
                appReads,
                presses,
                readAt,
                current: true,
                unavailableSince: null,
                failure: null,
                reconnecting: null,
                standing: servingStanding(),
              });
            },
          },
          controller.signal,
        );
      } catch (ended) {
        cause = ended;
        failure = controller.signal.aborted
          ? "HQ's stream stopped answering."
          : ended instanceof Error
            ? ended.message
            : "HQ could not be reached.";
      } finally {
        clearTimeout(silence);
        controller.abort();
      }
      if (input.signal.aborted) return;
      if (!requested) {
        input.log(`HQ's structure stream stopped after ${String(input.now() - openedAt)} ms`);
        const refused = cause instanceof HqError && cause.kind === "refused";
        const immediate =
          cause instanceof HqError && cause.code === "socket_1001" && firstReconnect;
        firstReconnect = false;
        const delayMs = immediate ? 0 : backoffMs;
        const capped = !refused && delayMs === HQ_RECONNECT_CAP_MS;
        const since = view.unavailableSince ?? input.now();
        publish({
          ...view,
          current: false,
          unavailableSince: since,
          failure: refused || capped ? failure : null,
          reconnecting: refused ? null : { delayMs, capped },
          standing: standingAfterFailure(since),
        });
        publishMates({ ...matesView, current: false });
        if (!refused && !immediate) backoffMs = Math.min(backoffMs * 2, HQ_RECONNECT_CAP_MS);
        await new Promise<void>((resolve) => {
          const timer = refused ? null : setTimeout(wake, delayMs);
          function wake() {
            if (timer !== null) clearTimeout(timer);
            again = null;
            resolve();
          }
          again = wake;
          // Publishing can synchronously stop this owner or request another snapshot.
          if (input.signal.aborted || requested) wake();
        });
      }
    }
  } finally {
    unwaitHealth();
    input.signal.removeEventListener("abort", abort);
    attempt?.abort();
    readers.delete(reread);
    if (readers.size === 0) snapshotReaders.delete(input.organizationId);
  }
}

/**
 * What a serving HQ's verdict of itself says of it, as `/health` would: the official HQ, one that
 * serves while it cannot check Zerops right now, or one that is not the official HQ. A Core yet to
 * finish its first check (`null`) serves, and is taken as the official one.
 */
/** Named apart (`servingStanding`): nothing of HQ's parts said here. */
const NO_PARTS: HqParts = { quarantined: [] };

/** The Core's build and its parts are named apart (`servingStanding`): `""` here names none. */
function healthOfOfficial(official: string | null): HqHealth {
  if (official === null || official === "ok")
    return { kind: "healthy", build: "", parts: NO_PARTS };
  return official === "unknown"
    ? { kind: "unchecked", build: "", parts: NO_PARTS }
    : { kind: "not-ready", state: "active", official };
}

/**
 * What the menu says while HQ does not answer (SPEC §6.2.3): since when, and how old the
 * structure it draws is. `null` while HQ answers, or before anything is known of it.
 */
export function hqOutageLine(
  view: HqStructureView | null,
  timestampFormat: TimestampFormat,
  nowMs: number,
): string | null {
  if (view === null || view.current) return null;
  const at = (ms: number) =>
    formatDayAwareTimestamp(new Date(ms).toISOString(), timestampFormat, nowMs);
  if (view.reconnecting && !view.reconnecting.capped) {
    return view.readAt === null || view.structure === null
      ? "Reconnecting…"
      : `Last known · as of ${at(view.readAt)} · Reconnecting…`;
  }
  if (view.unavailableSince === null)
    return view.readAt === null || view.structure === null
      ? null
      : `Last known · as of ${at(view.readAt)} · Updating…`;
  const since = `${view.failure ? `${view.failure} ` : ""}HQ unavailable since ${at(view.unavailableSince)}.`;
  const retry = view.reconnecting?.capped ? " Retrying every 30 seconds." : "";
  return view.readAt === null || view.structure === null
    ? `${since}${retry}`
    : `${since} Projects as of ${at(view.readAt)}.${retry}`;
}

/**
 * What kind of standing `hqOutageLine` says, for where it is said: "syncing" while HQ is being
 * read again or the stream reconnects — a spinner in the menu's header, the line in its tooltip
 * (the owner, 2026-10-05: a notice pushed the whole menu down and back on every reconnect);
 * "unavailable" once HQ has not answered — said in the header in words. `null` exactly when
 * `hqOutageLine` is.
 */
export function hqOutageKind(view: HqStructureView | null): "syncing" | "unavailable" | null {
  if (view === null || view.current) return null;
  if (view.reconnecting && !view.reconnecting.capped) return "syncing";
  if (view.unavailableSince === null)
    return view.readAt === null || view.structure === null ? null : "syncing";
  return "unavailable";
}

/**
 * Whether the organization has an official HQ, once its verdict is decided: kept, or read off its
 * member list. Null before — no answer of HQ's is waited for where it is false.
 */
export function hqOfficialOf(accountHq: Pick<AccountHq, "status" | "hq">): boolean | null {
  return accountHq.status === "ready" ? accountHq.hq.kind === "official" : null;
}

/** Holds the organization in view's structure stream for as long as the account is signed in. */
export function ZeropsHqStructure(): null {
  const { activeOrganization, client, status } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const organizationId = status === "signed-in" ? activeOrganization?.id : undefined;
  const accountHq = useAccountHq(organizationId);
  const hqProjectId = accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined;
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;
  const official = organizationId === undefined ? null : hqOfficialOf(accountHq);

  useEffect(() => {
    registry.set(hqOfficialAtom, official);
  }, [official, registry]);

  useEffect(() => {
    if (organizationId === undefined) {
      registry.set(hqStructureAtom, null);
      registry.set(hqMatesViewAtom, null);
      registry.set(hqPeopleViewAtom, null);
      return;
    }
    // First paint: nothing of HQ until it answers.
    registry.set(hqMatesViewAtom, { organizationId, mates: null, current: false });
    registry.set(hqPeopleViewAtom, { organizationId, people: null });
    // Until the member list names the organization's HQ: nothing of its structure.
    if (hqProjectId === undefined || hqAddress === undefined) {
      registry.set(hqStructureAtom, {
        organizationId,
        structure: null,
        changes: null,
        appReads: null,
        readAt: null,
        current: false,
        unavailableSince: null,
      });
      return;
    }
    const stop = new AbortController();
    void driveHqStructure({
      api: accountHqApi(client, organizationId, { projectId: hqProjectId, address: hqAddress }),
      organizationId,
      publish: (view) => {
        if (!stop.signal.aborted) registry.set(hqStructureAtom, view);
      },
      publishMates: (view) => {
        if (!stop.signal.aborted) registry.set(hqMatesViewAtom, view);
      },
      publishPeople: (view) => {
        if (!stop.signal.aborted) registry.set(hqPeopleViewAtom, view);
      },
      now: () => Date.now(),
      log: (line) => console.info(line),
      readHealth: () => readHqHealth((input, init) => fetch(input, init), hqAddress),
      whenShown,
      signal: stop.signal,
    });
    return () => stop.abort();
  }, [client, hqAddress, hqProjectId, organizationId, registry]);

  return null;
}
