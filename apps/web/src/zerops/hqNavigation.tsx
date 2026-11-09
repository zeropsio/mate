/**
 * The organization's HQ as the account observes it (ADR 0002): the account's data layer opens the
 * scope stream of the HQ this build names (`configuredHq`) to it
 * (`@t3tools/client-runtime/data`); every surface reads HQ's navigation from the store's
 * projections. What the menu says while HQ does not answer is said here, and nowhere else.
 *
 * - **First paint:** nothing of HQ until it answers: no structure this browser kept.
 * - **HQ slow:** its connection holds and it is still working on its first answer: the menu says
 *   so, and waits.
 * - **HQ away** (`hqLink`): what was read stands and nothing changes; past its budget, longer than
 *   a deploy, the header says since when HQ is restarting or not reachable (SPEC §4). Chat and
 *   terminal to the Mates do not go through HQ and keep working.
 */
import {
  HQ_SLOW,
  hqAwaySaidAt,
  makeHqWire,
  type HqNavigationRead,
} from "@t3tools/client-runtime/data";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useEffect, useMemo } from "react";

import { formatDayAwareTimestamp } from "../timestampFormat";
import { accountHqApi, configuredHq } from "./accountHq";
import { holdHqWrites } from "./hqWrites";
import { useAccountDataOptional } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** How the menu says HQ's standing: `null` while it answers, or before anything is known. */
export interface HqOutage {
  /**
   * `syncing`: its first read is catching up, nothing of it shown yet; `slow`: HQ's connection
   * holds and it is still working — nothing to try again; `last-known`: HQ away past its budget,
   * what it last said stands; `unavailable`: retries have reached their backoff cap before it ever
   * answered; `refused`: HQ's actual refusal and the next action, whether or not it answered before.
   */
  readonly kind: "syncing" | "slow" | "last-known" | "unavailable" | "refused";
  readonly line: string;
  /** Whether the person's *Try again* is offered: HQ refused, or it has been away long enough. */
  readonly again: boolean;
}

/**
 * What the menu says of HQ (SPEC §6.2.3). Once HQ answered, it being away (`hqLink`) says nothing
 * until its budget passed (`hqAwaySaidAt`), then that what it said stands, since when and why.
 * Before it ever answered, a spinner while it catches up, and "unavailable" once it stopped
 * retrying often. HQ's refusal is said at once.
 */
export function hqOutage(
  navigation: Pick<HqNavigationRead, "link" | "refusal" | "capped" | "retrying" | "slow"> & {
    readonly structure: unknown;
  },
  timestampFormat: TimestampFormat,
  nowMs: number,
): HqOutage | null {
  const read = navigation.structure !== null;
  if (navigation.refusal !== null)
    return {
      kind: "refused",
      line: `${navigation.refusal}${read ? " Showing what HQ last said." : ""}`,
      again: true,
    };
  if (read) {
    const { link } = navigation;
    const saidAt = hqAwaySaidAt(link);
    if (link.kind === "live" || link.since === null || saidAt === null || nowMs < saidAt)
      return null;
    const since = formatDayAwareTimestamp(
      new Date(link.since).toISOString(),
      timestampFormat,
      nowMs,
    );
    const state = link.kind === "restarting" ? "is restarting" : "is not reachable";
    return {
      kind: "last-known",
      line: `HQ ${state} since ${since} — showing what it last said. Reconnecting…`,
      again: true,
    };
  }
  if (navigation.slow) return { kind: "slow", line: HQ_SLOW, again: false };
  if (navigation.capped)
    return { kind: "unavailable", line: "HQ unavailable. Retrying every minute.", again: true };
  if (navigation.retrying) return { kind: "syncing", line: "Reconnecting…", again: false };
  return null;
}

/** Observes the organization in view's HQ for as long as the account shows it. */
export function ZeropsHqNavigation(): null {
  const { activeOrganization, client, status } = useZeropsSession();
  const showHq = useAccountDataOptional()?.showHq;
  const organizationId = status === "signed-in" ? activeOrganization?.id : undefined;
  const hq = configuredHq();

  const api = useMemo(
    () => (organizationId === undefined ? null : accountHqApi(client, organizationId, hq)),
    [client, hq, organizationId],
  );
  const wire = useMemo(() => (api === null ? null : makeHqWire(api)), [api]);
  // The account's operations write to the HQ it observes, and to none once it observes none.
  useEffect(
    () =>
      organizationId === undefined || api === null
        ? undefined
        : holdHqWrites(organizationId, api, hq.projectId),
    [api, hq, organizationId],
  );
  // A new wire for the same organization's HQ moves the link to it; the link stops with this mount.
  useEffect(() => {
    showHq?.(
      organizationId === undefined || wire === null
        ? null
        : { orgId: organizationId, wire, ownerId: JSON.stringify([hq.projectId, hq.address]) },
    );
  }, [organizationId, showHq, wire, hq]);
  useEffect(
    () => () => {
      void showHq?.(null);
    },
    [showHq],
  );

  return null;
}
