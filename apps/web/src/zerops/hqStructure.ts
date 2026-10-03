/**
 * The organization's structure, live from its HQ (ADR 0002, SPEC §3.5): one stream per
 * organization (`/api/structure/ws`) — the whole structure, then its changes — published
 * to `hqStructureAtom`, from which every surface places its projects (`hqPlacementsAtom`). The
 * same stream carries each application's Mates' changes (SPEC §3.2a, `hqChangesAtom`), and the
 * Mates the reader may observe with the people its view names (`hqMatesAtom`, `hqPeopleAtom`) —
 * in atoms of their own, since a Mate at work moves them twice a second and the structure never.
 *
 * - **First paint:** the structure this browser last read (`menuMemory`), with when, and the
 *   Mates as HQ last told them, at rest, until HQ answers.
 * - **HQ down:** the last known structure stands, and the view says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 * - **A stream that breaks, ends or stays silent** past HQ's pings (every 20 s) is opened
 *   again, a little later each time it fails, and starts over from a fresh snapshot.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  applyChangesEvent,
  applyMatesEvent,
  applyPeopleEvent,
  applyStructureEvent,
  HqError,
  type HqApi,
  type HqChanges,
  type HqMates,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { HqPeople } from "@t3tools/shared/hqMates";
import { useContext, useEffect } from "react";

import {
  hqMatesViewAtom,
  hqPeopleViewAtom,
  hqStructureAtom,
  type HqMatesView,
  type HqPeopleView,
  type HqStructureView,
} from "../state/zerops";
import { formatDayAwareTimestamp } from "../timestampFormat";
import { accountHqApi, useAccountHq } from "./accountHq";
import { menuMemory, rememberedMates, rememberMenu, withMates, withStructure } from "./menuMemory";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A stream nothing came down for this long — three pings — is given up. */
export const HQ_STREAM_SILENCE_MS = 60_000;
/**
 * How long HQ may go unanswered before the outage is said: a stream cut on its way and read again
 * at once — measured every 120 s (F26) — is no outage, and HQ's last word stands meanwhile.
 */
export const HQ_OUTAGE_GRACE_MS = 10_000;
/** How long a stream that failed waits before it is opened again, by failures in a row. */
export const HQ_STREAM_RETRY_MS: ReadonlyArray<number> = [1_000, 2_000, 5_000, 10_000, 30_000];
/** How often at most the Mates are remembered while they move: a reload's first paint needs no more. */
const HQ_MATES_REMEMBER_MS = 10_000;

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
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
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

  /** When HQ last stopped answering, while it has not answered since. */
  let stoppedAt: number | null = null;
  let sayOutage: ReturnType<typeof setTimeout> | undefined;
  const stopped = () => {
    if (stoppedAt !== null) return;
    const since = input.now();
    stoppedAt = since;
    sayOutage = setTimeout(() => {
      publish({ ...view, current: false, unavailableSince: since });
      if (matesView.current) publishMates({ ...matesView, current: false });
    }, HQ_OUTAGE_GRACE_MS);
  };
  input.signal.addEventListener("abort", () => clearTimeout(sayOutage), { once: true });

  let failures = 0;
  while (!input.signal.aborted) {
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    input.signal.addEventListener("abort", abort);
    let silence = setTimeout(abort, silenceMs);
    /** This stream's own structure, changes, Mates and people: a reconnect starts from its snapshot. */
    let streamed: HqStructure | null = null;
    let changes: HqChanges | null = null;
    let mates: HqMates | null = null;
    let people: HqPeople | null = null;
    let rememberedAt: number | null = null;
    let unremembered = false;
    const rememberMates = (atOnce: boolean) => {
      if (mates === null || !unremembered) return;
      const now = input.now();
      if (!atOnce && rememberedAt !== null && now - rememberedAt < HQ_MATES_REMEMBER_MS) return;
      input.rememberMates(mates, people);
      rememberedAt = now;
      unremembered = false;
    };
    let broke = false;
    let cause: unknown;
    const openedAt = input.now();
    try {
      await input.api.streamStructure(
        {
          onAlive: () => {
            clearTimeout(silence);
            silence = setTimeout(abort, silenceMs);
            rememberMates(false);
            // HQ still answers: what it last sent stands as of now, should it stop answering.
            if (streamed === null) return;
            const readAt = input.now();
            view = { ...view, readAt };
            input.remember(streamed, readAt);
          },
          onEvent: (event) => {
            const matesBefore = mates;
            const peopleBefore = people;
            mates = applyMatesEvent(mates, event);
            people = applyPeopleEvent(people, event);
            if (event.kind === "snapshot" || mates !== matesBefore) {
              publishMates({ organizationId: input.organizationId, mates, current: true });
            }
            if (event.kind === "snapshot" || people !== peopleBefore) {
              input.publishPeople({ organizationId: input.organizationId, people });
            }
            if (event.kind === "snapshot" || mates !== matesBefore || people !== peopleBefore) {
              unremembered = true;
              rememberMates(event.kind === "snapshot");
            }
            // A Mate's or the people's message moves nothing of the structure.
            if (event.kind === "mate" || event.kind === "people") return;
            streamed = applyStructureEvent(streamed, event);
            changes = applyChangesEvent(changes, event);
            if (streamed === null) return;
            failures = 0;
            stoppedAt = null;
            clearTimeout(sayOutage);
            const readAt = input.now();
            input.remember(streamed, readAt);
            publish({
              ...view,
              structure: streamed,
              changes,
              readAt,
              current: true,
              unavailableSince: null,
            });
          },
        },
        attempt.signal,
      );
    } catch (error) {
      broke = true;
      cause = error;
    } finally {
      rememberMates(true);
      clearTimeout(silence);
      input.signal.removeEventListener("abort", abort);
    }
    if (input.signal.aborted) return;
    const lived = `after ${String(input.now() - openedAt)} ms`;
    input.log(
      !broke
        ? `HQ's structure stream ended ${lived}`
        : `HQ's structure stream ${attempt.signal.aborted ? "went silent" : "broke"} ${lived}: ${
            cause instanceof HqError ? cause.code : String(cause)
          }`,
    );
    // A stream that ended after its snapshot is HQ restarting: read again at once. One that broke
    // or never answered is HQ not answering: read again a little later each time. Either way the
    // outage is said once HQ has not answered for `HQ_OUTAGE_GRACE_MS`, since it stopped.
    const failed = broke || streamed === null;
    if (failed) failures += 1;
    stopped();
    if (failed) {
      const wait = HQ_STREAM_RETRY_MS[Math.min(failures, HQ_STREAM_RETRY_MS.length) - 1]!;
      await input.sleep(wait, input.signal);
    }
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
  if (view === null || view.unavailableSince === null) return null;
  const at = (ms: number) =>
    formatDayAwareTimestamp(new Date(ms).toISOString(), timestampFormat, nowMs);
  const since = `HQ unavailable since ${at(view.unavailableSince)}.`;
  return view.readAt === null || view.structure === null
    ? since
    : `${since} Projects as of ${at(view.readAt)}.`;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Holds the organization in view's structure stream for as long as the account is signed in. */
export function ZeropsHqStructure(): null {
  const { activeOrganization, client, status } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const organizationId = status === "signed-in" ? activeOrganization?.id : undefined;
  const accountHq = useAccountHq(organizationId);
  const hqProjectId = accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined;
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;

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
      sleep,
      log: (line) => console.info(line),
      signal: stop.signal,
    });
    return () => stop.abort();
  }, [client, hqAddress, hqProjectId, organizationId, registry]);

  return null;
}
