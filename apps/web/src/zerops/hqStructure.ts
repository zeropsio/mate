/**
 * The organization's structure, live from its HQ (ADR 0002, SPEC §3.5): one stream per
 * organization (`/api/structure/ws`) — the whole structure, then its changes — published
 * to `hqStructureAtom`, from which every surface places its projects (`hqPlacementsAtom`). The
 * same stream carries each application's Mates' changes (SPEC §3.2a, `hqChangesAtom`) and where
 * its releases, repository heads and stage/production recipes (`appReads`), and the
 * Mates the reader may observe with the people its view names (`hqMatesAtom`, `hqPeopleAtom`) —
 * in atoms of their own, since a Mate at work moves them twice a second and the structure never.
 *
 * - **First paint:** the structure this browser last read (`menuMemory`), with when, and the
 *   Mates as HQ last told them, at rest, until HQ answers.
 * - **HQ down:** the last known structure stands, and the view says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 * - A stream that breaks, ends or stays silent shows a failure; a manual again starts a snapshot.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  applyChangesEvent,
  applyMatesEvent,
  applyPeopleEvent,
  applyAppReadsEvent,
  applyStructureEvent,
  type HqApi,
  type HqChanges,
  type HqMates,
  type HqAppReads,
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
import { accountHqApi, useAccountHq, type AccountHq } from "./accountHq";
import { menuMemory, rememberedMates, rememberMenu, withMates, withStructure } from "./menuMemory";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A stream nothing came down for this long — three pings — is given up. */
export const HQ_STREAM_SILENCE_MS = 60_000;
/** How often at most the Mates are remembered while they move: a reload's first paint needs no more. */
const HQ_MATES_REMEMBER_MS = 10_000;

/** Explicit detail retries reuse the account's stream owner; they never write facts themselves. */
const snapshotReaders = new Map<string, Set<() => void>>();
export function requestHqSnapshot(organizationId: string): void {
  for (const read of snapshotReaders.get(organizationId) ?? []) read();
}

/**
 * Reads the organization's structure from its HQ until `signal` aborts, telling `publish` of every
 * state it reaches and `remember` of every structure HQ answered.
 */
export async function driveHqStructure(input: {
  readonly api: Pick<HqApi, "streamStructure">;
  readonly organizationId: string;
  readonly remembered: { readonly structure: HqStructure; readonly readAt: number } | undefined;
  readonly publish: (view: HqStructureView) => void;
  /** Told of the Mates and of the people apart from the structure: theirs change far more often. */
  readonly publishMates: (view: HqMatesView) => void;
  readonly publishPeople: (view: HqPeopleView) => void;
  readonly remember: (structure: HqStructure, readAt: number) => void;
  /**
   * Told of the Mates and the people to remember: at their snapshot, at most every
   * {@link HQ_MATES_REMEMBER_MS} while they move — a ping says it late — and as the stream ends.
   */
  readonly rememberMates: (mates: HqMates, people: HqPeople | null) => void;
  readonly now: () => number;
  /** Told how each stream ended — the close code a break carried — and how long it lived (F26). */
  readonly log: (line: string) => void;
  readonly signal: AbortSignal;
  readonly silenceMs?: number;
}): Promise<void> {
  const silenceMs = input.silenceMs ?? HQ_STREAM_SILENCE_MS;
  let view: HqStructureView = {
    organizationId: input.organizationId,
    structure: input.remembered?.structure ?? null,
    changes: null,
    appReads: null,
    readAt: input.remembered?.readAt ?? null,
    current: false,
    unavailableSince: null,
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
      requested = false;
      const controller = new AbortController();
      attempt = controller;
      const openedAt = input.now();
      let silence = setTimeout(() => controller.abort(), silenceMs);
      let streamed: HqStructure | null = null;
      let changes: HqChanges | null = null;
      let appReads: HqAppReads | null = view.appReads;
      let mates: HqMates | null = null;
      let people: HqPeople | null = null;
      let rememberedAt: number | null = null;
      let dirty = false;
      const rememberMates = (force: boolean) => {
        if (mates === null || !dirty) return;
        const now = input.now();
        if (!force && rememberedAt !== null && now - rememberedAt < HQ_MATES_REMEMBER_MS) return;
        input.rememberMates(mates, people);
        rememberedAt = now;
        dirty = false;
      };
      if (view.current || view.unavailableSince !== null)
        publish({ ...view, current: false, unavailableSince: null });
      try {
        await input.api.streamStructure(
          {
            onAlive: () => {
              if (controller.signal.aborted) return;
              clearTimeout(silence);
              silence = setTimeout(() => controller.abort(), silenceMs);
              rememberMates(false);
              if (streamed !== null) {
                view = { ...view, readAt: input.now() };
                input.remember(streamed, view.readAt!);
              }
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
              if (
                event.kind === "snapshot" ||
                mates !== previousMates ||
                people !== previousPeople
              ) {
                dirty = true;
                rememberMates(event.kind === "snapshot");
              }
              if (event.kind === "mate" || event.kind === "people") return;
              streamed = applyStructureEvent(streamed, event);
              changes = applyChangesEvent(changes, event);
              appReads = applyAppReadsEvent(
                event.kind === "snapshot" ? view.appReads : appReads,
                event,
              );
              if (streamed === null) return;
              const readAt = input.now();
              input.remember(streamed, readAt);
              publish({
                ...view,
                structure: streamed,
                changes,
                appReads,
                readAt,
                current: true,
                unavailableSince: null,
              });
            },
          },
          controller.signal,
        );
      } catch {
        // The failure belongs to the retained view; only a person's request starts another attempt.
      } finally {
        clearTimeout(silence);
        rememberMates(true);
      }
      if (input.signal.aborted) return;
      if (!requested) {
        input.log(`HQ's structure stream stopped after ${String(input.now() - openedAt)} ms`);
        publish({ ...view, current: false, unavailableSince: input.now() });
        publishMates({ ...matesView, current: false });
        await new Promise<void>((resolve) => {
          again = resolve;
        });
        again = null;
      }
    }
  } finally {
    input.signal.removeEventListener("abort", abort);
    attempt?.abort();
    readers.delete(reread);
    if (readers.size === 0) snapshotReaders.delete(input.organizationId);
  }
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
  if (view.unavailableSince === null)
    return view.readAt === null || view.structure === null
      ? null
      : `Last known · as of ${at(view.readAt)} · Updating…`;
  const since = `HQ unavailable since ${at(view.unavailableSince)}.`;
  return view.readAt === null || view.structure === null
    ? since
    : `${since} Projects as of ${at(view.readAt)}.`;
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
    const remembered = menuMemory().structures[organizationId];
    const kept =
      remembered === undefined
        ? undefined
        : {
            structure: { ungrouped: remembered.ungrouped, apps: remembered.apps },
            readAt: remembered.readAt,
          };
    // First paint: the Mates and the people as HQ last told this browser, none of them live.
    const told = rememberedMates(organizationId);
    registry.set(hqMatesViewAtom, { organizationId, mates: told?.mates ?? null, current: false });
    registry.set(hqPeopleViewAtom, { organizationId, people: told?.people ?? null });
    // Until the member list names the organization's HQ: what this browser read of it last.
    if (hqProjectId === undefined || hqAddress === undefined) {
      registry.set(hqStructureAtom, {
        organizationId,
        structure: kept?.structure ?? null,
        changes: null,
        appReads: null,
        readAt: kept?.readAt ?? null,
        current: false,
        unavailableSince: null,
      });
      return;
    }
    const stop = new AbortController();
    void driveHqStructure({
      api: accountHqApi(client, organizationId, { projectId: hqProjectId, address: hqAddress }),
      organizationId,
      remembered: kept,
      publish: (view) => {
        if (!stop.signal.aborted) registry.set(hqStructureAtom, view);
      },
      publishMates: (view) => {
        if (!stop.signal.aborted) registry.set(hqMatesViewAtom, view);
      },
      publishPeople: (view) => {
        if (!stop.signal.aborted) registry.set(hqPeopleViewAtom, view);
      },
      remember: (structure, readAt) =>
        rememberMenu((memory) => withStructure(memory, organizationId, structure, readAt)),
      rememberMates: (mates, people) =>
        rememberMenu((memory) => withMates(memory, organizationId, mates, people)),
      now: () => Date.now(),
      log: (line) => console.info(line),
      signal: stop.signal,
    });
    return () => stop.abort();
  }, [client, hqAddress, hqProjectId, organizationId, registry]);

  return null;
}
