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
import { RegistryContext } from "@effect/atom-react";
import { makeHqWire, type HqNavigationRead } from "@t3tools/client-runtime/data";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useContext, useEffect, useMemo } from "react";

import { hqOfficialAtom } from "../state/zerops";
import { formatDayAwareTimestamp } from "../timestampFormat";
import { accountHqApi, useAccountHq, type AccountHq } from "./accountHq";
import { useAccountDataOptional } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** How the menu says HQ's standing: `null` while it answers, or before anything is known. */
export interface HqOutage {
  readonly kind: "syncing" | "unavailable";
  readonly line: string;
  /** Whether the person's *Try again* is offered: HQ refused, or its retries are capped. */
  readonly again: boolean;
}

/**
 * What the menu says while HQ does not answer (SPEC §6.2.3): catching up while its stream
 * reconnects — a spinner in the menu's header, the line in its tooltip — and "unavailable" once it
 * refused, or its retries are as far apart as they get; since when, as this tab saw it.
 */
export function hqOutage(
  navigation: HqNavigationRead,
  downSince: number | null,
  timestampFormat: TimestampFormat,
  nowMs: number,
): HqOutage | null {
  if (navigation.live) return null;
  const read = navigation.structure !== null;
  if (navigation.refusal === null && !navigation.capped) {
    if (!navigation.reconnecting) return null;
    return {
      kind: "syncing",
      line: read ? "Last known · Reconnecting…" : "Reconnecting…",
      again: false,
    };
  }
  const since =
    downSince === null
      ? ""
      : ` since ${formatDayAwareTimestamp(new Date(downSince).toISOString(), timestampFormat, nowMs)}`;
  const refusal = navigation.refusal === null ? "" : `${navigation.refusal} `;
  const retry = navigation.capped ? " Retrying every minute." : "";
  return { kind: "unavailable", line: `${refusal}HQ unavailable${since}.${retry}`, again: true };
}

/**
 * Whether the organization has an official HQ, once its verdict is decided: kept, or read off its
 * member list. Null before — no answer of HQ's is waited for where it is false.
 */
export function hqOfficialOf(accountHq: Pick<AccountHq, "status" | "hq">): boolean | null {
  return accountHq.status === "ready" ? accountHq.hq.kind === "official" : null;
}

/** Observes the organization in view's HQ for as long as the account shows it. */
export function ZeropsHqNavigation(): null {
  const { activeOrganization, client, status } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const showHq = useAccountDataOptional()?.showHq;
  const organizationId = status === "signed-in" ? activeOrganization?.id : undefined;
  const accountHq = useAccountHq(organizationId);
  const hqProjectId = accountHq.hq.kind === "official" ? accountHq.hq.projectId : undefined;
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;
  const official = organizationId === undefined ? null : hqOfficialOf(accountHq);

  useEffect(() => {
    registry.set(hqOfficialAtom, official);
  }, [official, registry]);

  const wire = useMemo(
    () =>
      organizationId === undefined || hqProjectId === undefined || hqAddress === undefined
        ? null
        : makeHqWire(
            accountHqApi(client, organizationId, { projectId: hqProjectId, address: hqAddress }),
          ),
    [client, hqAddress, hqProjectId, organizationId],
  );
  useEffect(() => {
    if (showHq === undefined || organizationId === undefined || wire === null) return;
    showHq({ orgId: organizationId, wire });
    return () => showHq(null);
  }, [organizationId, showHq, wire]);

  return null;
}
