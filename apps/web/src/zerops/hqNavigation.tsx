/**
 * The organization's HQ as the account observes it (ADR 0002): the account's data layer opens the
 * scope stream of the HQ this build names (`configuredHq`) to it
 * (`@t3tools/client-runtime/data`); every surface reads HQ's navigation from the store's
 * projections. What the menu says while HQ does not answer is said here.
 *
 * - **First paint:** nothing of HQ until it answers: no structure this browser kept.
 * - **HQ slow:** its connection holds and it is still working: the menu says so, and waits.
 * - **HQ down:** what was read stands, and the menu says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 */
import { HQ_SLOW, makeHqWire, type HqNavigationRead } from "@t3tools/client-runtime/data";
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
   * holds and it is still working — nothing to try again; `last-known`: what it last
   * said stands; `unavailable`: retries have reached their backoff cap before it ever answered;
   * `refused`: HQ's actual refusal and the next action, whether or not it answered before.
   */
  readonly kind: "syncing" | "slow" | "last-known" | "unavailable" | "refused";
  readonly line: string;
  /** Whether the person's *Try again* is offered: HQ refused, or its retries are capped. */
  readonly again: boolean;
}

/**
 * What the menu says while HQ does not answer (SPEC §6.2.3). Once HQ answered, any pause of its
 * link — catching up, refused, its retries as far apart as they get — leaves what it said on
 * screen as last known, and the header says so in words; since when, as this tab saw it. Before it
 * ever answered, a spinner while it catches up, and "unavailable" once it refused or stopped
 * retrying often.
 */
export function hqOutage(
  navigation: Pick<HqNavigationRead, "live" | "refusal" | "capped" | "reconnecting" | "slow"> & {
    readonly structure: unknown;
  },
  downSince: number | null,
  timestampFormat: TimestampFormat,
  nowMs: number,
): HqOutage | null {
  if (navigation.live) return null;
  const read = navigation.structure !== null;
  if (navigation.refusal !== null)
    return {
      kind: "refused",
      line: `${navigation.refusal}${read ? " Showing what HQ last said." : ""}`,
      again: true,
    };
  if (navigation.slow) return { kind: "slow", line: HQ_SLOW, again: false };
  const stopped = navigation.capped;
  if (!stopped && !navigation.reconnecting) return null;
  const since =
    downSince === null
      ? ""
      : ` since ${formatDayAwareTimestamp(new Date(downSince).toISOString(), timestampFormat, nowMs)}`;
  const retry = navigation.capped ? " Retrying every minute." : " Reconnecting…";
  if (read) {
    const line = `HQ is not reachable${since} — showing what it last said.${retry}`;
    return { kind: "last-known", line, again: stopped };
  }
  if (!stopped) return { kind: "syncing", line: "Reconnecting…", again: false };
  return {
    kind: "unavailable",
    line: `HQ unavailable${since}.${navigation.capped ? " Retrying every minute." : ""}`,
    again: true,
  };
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
