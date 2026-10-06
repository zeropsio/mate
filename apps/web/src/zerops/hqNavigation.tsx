/**
 * The organization's HQ as the account observes it (ADR 0002): once the member list names its
 * official HQ (`useAccountHq`), the account's data layer opens HQ's scope stream to it
 * (`@t3tools/client-runtime/data`); every surface reads HQ's navigation from the store's
 * projections. What the menu says while HQ does not answer is said here.
 *
 * - **First paint:** nothing of HQ until it answers: no structure this browser kept.
 * - **HQ down:** what was read stands, and the menu says since when HQ does not answer
 *   (SPEC §4); chat and terminal to the Mates do not go through HQ and keep working.
 */
import { makeHqWire, type HqNavigationRead } from "@t3tools/client-runtime/data";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useEffect, useMemo } from "react";

import { formatDayAwareTimestamp } from "../timestampFormat";
import { accountHqApi, useAccountHq } from "./accountHq";
import { holdHqWrites } from "./hqWrites";
import { useAccountDataOptional } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** How the menu says HQ's standing: `null` while it answers, or before anything is known. */
export interface HqOutage {
  /**
   * `syncing`: its first read is catching up, nothing of it shown yet; `last-known`: what it last
   * said stands, and the menu says so in words; `unavailable`: it refused, or stopped retrying
   * often, before it ever answered.
   */
  readonly kind: "syncing" | "last-known" | "unavailable";
  readonly line: string;
  /** Whether the person's *Try again* is offered: HQ refused, or its retries are capped. */
  readonly again: boolean;
}

/** What the menu's header says, in words, while what HQ said is not current. */
export const HQ_LAST_KNOWN = "HQ is not reachable — showing what it last said";

/**
 * What the menu says while HQ does not answer (SPEC §6.2.3). Once HQ answered, any pause of its
 * link — catching up, refused, its retries as far apart as they get — leaves what it said on
 * screen as last known, and the header says so in words; since when, as this tab saw it. Before it
 * ever answered, a spinner while it catches up, and "unavailable" once it refused or stopped
 * retrying often.
 */
export function hqOutage(
  navigation: HqNavigationRead,
  downSince: number | null,
  timestampFormat: TimestampFormat,
  nowMs: number,
): HqOutage | null {
  if (navigation.live) return null;
  const read = navigation.structure !== null;
  const stopped = navigation.refusal !== null || navigation.capped;
  if (!stopped && !navigation.reconnecting) return null;
  const since =
    downSince === null
      ? ""
      : ` since ${formatDayAwareTimestamp(new Date(downSince).toISOString(), timestampFormat, nowMs)}`;
  const refusal = navigation.refusal === null ? "" : `${navigation.refusal} `;
  const retry = navigation.capped
    ? " Retrying every minute."
    : navigation.refusal === null
      ? " Reconnecting…"
      : "";
  if (read) {
    const line = `${refusal}HQ is not reachable${since} — showing what it last said.${retry}`;
    return { kind: "last-known", line, again: stopped };
  }
  if (!stopped) return { kind: "syncing", line: "Reconnecting…", again: false };
  return {
    kind: "unavailable",
    line: `${refusal}HQ unavailable${since}.${navigation.capped ? " Retrying every minute." : ""}`,
    again: true,
  };
}

/** Observes the organization in view's HQ for as long as the account shows it. */
export function ZeropsHqNavigation(): null {
  const { activeOrganization, client, status } = useZeropsSession();
  const showHq = useAccountDataOptional()?.showHq;
  const organizationId = status === "signed-in" ? activeOrganization?.id : undefined;
  const accountHq = useAccountHq(organizationId);
  const hqProjectId = accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined;
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;

  const api = useMemo(
    () =>
      organizationId === undefined || hqProjectId === undefined || hqAddress === undefined
        ? null
        : accountHqApi(client, organizationId, { projectId: hqProjectId, address: hqAddress }),
    [client, hqAddress, hqProjectId, organizationId],
  );
  const wire = useMemo(() => (api === null ? null : makeHqWire(api)), [api]);
  // The account's operations write to the HQ it observes, and to none once it observes none.
  useEffect(
    () =>
      organizationId === undefined || api === null ? undefined : holdHqWrites(organizationId, api),
    [api, organizationId],
  );
  // A new wire for the same organization's HQ moves the link to it; the link stops only once no
  // HQ is named, or with this mount. Without one, the account holds its verdict: none, the member
  // list unreadable, or not decided yet.
  const verdict =
    accountHq.status === "failed"
      ? "unreadable"
      : accountHq.status === "ready" && accountHq.hq.kind !== "official"
        ? "none"
        : "pending";
  useEffect(() => {
    showHq?.(
      organizationId === undefined
        ? null
        : wire === null
          ? { orgId: organizationId, verdict }
          : { orgId: organizationId, wire },
    );
  }, [organizationId, showHq, verdict, wire]);
  useEffect(() => () => showHq?.(null), [showHq]);

  return null;
}
