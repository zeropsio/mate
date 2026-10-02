/**
 * The organization's structure, live from its HQ (ADR 0002, SPEC §3.5): one stream per
 * organization (`/api/structure/ws`) — the whole structure, then its changes — published
 * to `hqStructureAtom`, from which every surface places its projects (`hqPlacementsAtom`).
 *
 * - **First paint:** the structure this browser last read (`menuMemory`), with when, until HQ
 *   answers.
 * - **HQ down:** the last known structure stands, and the view says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 * - **A stream that breaks, ends or stays silent** past HQ's pings (every 20 s) is opened
 *   again, a little later each time it fails, and starts over from a fresh snapshot.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  applyStructureEvent,
  type HqApi,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useContext, useEffect } from "react";

import { hqStructureAtom, type HqStructureView } from "../state/zerops";
import { formatDayAwareTimestamp } from "../timestampFormat";
import { accountHqApi, useAccountHq } from "./accountHq";
import { menuMemory, rememberMenu, withStructure } from "./menuMemory";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A stream nothing came down for this long — three pings — is given up. */
export const HQ_STREAM_SILENCE_MS = 60_000;
/** How long a stream that failed waits before it is opened again, by failures in a row. */
export const HQ_STREAM_RETRY_MS: ReadonlyArray<number> = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * Reads the organization's structure from its HQ until `signal` aborts, telling `publish` of every
 * state it reaches and `remember` of every structure HQ answered.
 */
export async function driveHqStructure(input: {
  readonly api: Pick<HqApi, "streamStructure">;
  readonly organizationId: string;
  readonly remembered: { readonly structure: HqStructure; readonly readAt: number } | undefined;
  readonly publish: (view: HqStructureView) => void;
  readonly remember: (structure: HqStructure, readAt: number) => void;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly signal: AbortSignal;
  readonly silenceMs?: number;
}): Promise<void> {
  const silenceMs = input.silenceMs ?? HQ_STREAM_SILENCE_MS;
  let view: HqStructureView = {
    organizationId: input.organizationId,
    structure: input.remembered?.structure ?? null,
    readAt: input.remembered?.readAt ?? null,
    current: false,
    unavailableSince: null,
  };
  const publish = (next: HqStructureView) => {
    view = next;
    input.publish(view);
  };
  publish(view);

  let failures = 0;
  while (!input.signal.aborted) {
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    input.signal.addEventListener("abort", abort);
    let silence = setTimeout(abort, silenceMs);
    /** This stream's own structure: a reconnect starts from its snapshot. */
    let streamed: HqStructure | null = null;
    let broke = false;
    try {
      await input.api.streamStructure(
        {
          onAlive: () => {
            clearTimeout(silence);
            silence = setTimeout(abort, silenceMs);
            // HQ still answers: what it last sent stands as of now, should it stop answering.
            if (streamed === null) return;
            const readAt = input.now();
            view = { ...view, readAt };
            input.remember(streamed, readAt);
          },
          onEvent: (event) => {
            streamed = applyStructureEvent(streamed, event);
            if (streamed === null) return;
            failures = 0;
            const readAt = input.now();
            input.remember(streamed, readAt);
            publish({
              ...view,
              structure: streamed,
              readAt,
              current: true,
              unavailableSince: null,
            });
          },
        },
        attempt.signal,
      );
    } catch {
      broke = true;
    } finally {
      clearTimeout(silence);
      input.signal.removeEventListener("abort", abort);
    }
    if (input.signal.aborted) return;
    // A stream that ended after its snapshot is HQ restarting: read again at once. One that broke
    // or never answered is HQ not answering, since the first time it did not.
    const failed = broke || streamed === null;
    if (failed) failures += 1;
    publish({
      ...view,
      current: false,
      unavailableSince: failed ? (view.unavailableSince ?? input.now()) : view.unavailableSince,
    });
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
    // Until the member list names the organization's HQ: what this browser read of it last.
    if (hqProjectId === undefined || hqAddress === undefined) {
      registry.set(hqStructureAtom, {
        organizationId,
        structure: kept?.structure ?? null,
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
      remember: (structure, readAt) =>
        rememberMenu((memory) => withStructure(memory, organizationId, structure, readAt)),
      now: () => Date.now(),
      sleep,
      signal: stop.signal,
    });
    return () => stop.abort();
  }, [client, hqAddress, hqProjectId, organizationId, registry]);

  return null;
}
