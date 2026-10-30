import { captureAccountLifetime } from "./accountLifetime";
/**
 * The HQ this build names, as this tab reaches it (ADR 0001, SPEC §3.3, §4).
 *
 * - **Which HQ:** the one this build names (`VITE_HQ_ORIGIN`, {@link configuredHq}), shared by every
 *   organization: no member list is read for it and no HQ is born.
 * - **Through its door:** HQ's API answers a session HQ issued for a throwaway named
 *   `mate-door:hq:<nonce>`, deleted once the door takes it — one a try was not served with is
 *   presented again on the next, while young, and mints nothing. One API per account, org and HQ
 *   for the account's lifetime; its session is kept across loads as the Mates' are
 *   (`keptSessions.ts`, audit K7), so a load with a live one passes no door.
 * - **Whether it answers:** its structure stream (`hqStructure.ts`): healthy while it serves. An HQ
 *   that stops answering is `unavailable` from the stream's first failure, with that time (SPEC §4).
 */
import {
  sharedHq,
  type HqApi,
  type HqEndpoint,
  type HqParts,
} from "@t3tools/client-runtime/zerops/hq";
import { makeBrowserHqApi, zeropsAccessToken, zeropsOrgStart } from "@t3tools/client-runtime/data";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import { keptHqSessions } from "./keptSessions";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/**
 * The HQ this build names (`VITE_HQ_ORIGIN`): clients take HQ's origin from their configuration
 * (mate-hq `spec/protocol.md` Conventions "Origin"). The one object for an origin, so it keys
 * memos.
 */
let named: HqEndpoint | undefined;
export function configuredHq(): HqEndpoint {
  const origin = import.meta.env.VITE_HQ_ORIGIN.trim();
  const hq = sharedHq(origin);
  if (named?.address !== hq.address) named = hq;
  return named;
}

/** Where the account keeps HQ's session for the organization `clientId` and `hq`. */
const keptHqKey = (clientId: string, hq: HqEndpoint) => `${clientId}:${hq.projectId}:${hq.address}`;

/**
 * HQ's API for this account and org, with the session the account kept for this HQ, else signed in
 * with the person's Zerops access token on the first call. An organization HQ has not started is
 * started by its Owner's or Admin's sign-in.
 */
export function accountHqApi(client: ZeropsApiClient, clientId: string, hq: HqEndpoint): HqApi {
  const accessToken = zeropsAccessToken(client);
  const keptKey = keptHqKey(clientId, hq);
  const active = captureAccountLifetime();
  const nativeEpoch = client.accountEpoch;
  return makeBrowserHqApi({
    address: hq.address,
    kept: {
      read: () => {
        const kept = keptHqSessions.read(keptKey);
        return kept === null ? null : { token: kept.token, expiresAtMs: kept.expiresAtEpochMs };
      },
      keep: ({ token, expiresAt }) => {
        const expiresAtEpochMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtEpochMs)) return;
        // A session another tab kept meanwhile may still be that tab's: it is never revoked from
        // here. It stays kept beside this one, so the account's close ends it with the rest.
        const displaced = keptHqSessions.keep(keptKey, {
          address: hq.address,
          token,
          expiresAtEpochMs,
        });
        if (displaced !== null)
          keptHqSessions.keep(`${keptKey}:displaced:${displaced.token}`, displaced);
      },
      forget: (token) => keptHqSessions.forget(keptKey, token),
    },
    isCurrent: () => active() && client.accountEpoch === nativeEpoch,
    accessToken,
    orgId: clientId,
    startOrganisation: zeropsOrgStart(client, clientId, navigator.locks),
  });
}

/**
 * The HQ of the organization in view, as the person reaches it: its address and its API; `null`
 * with no organization open, and outside a Zerops session.
 */
export function useOfficialHq(): { readonly address: string; readonly api: HqApi } | null {
  const session = useZeropsSessionOptional();
  const client = session?.client;
  const clientId = session?.activeOrganization?.id;
  const hq = configuredHq();
  const api = useMemo(
    () =>
      client === undefined || clientId === undefined ? null : accountHqApi(client, clientId, hq),
    [client, clientId, hq],
  );
  return useMemo(() => (api === null ? null : { address: hq.address, api }), [api, hq]);
}

/** Where an HQ stands, as its stream last said it (`hqStandingAtom`). */
export type HqStanding =
  | { readonly kind: "unknown" }
  /**
   * Serving as the official HQ. `build` the Core it runs and `parts` how they
   * stand, as its stream says them; each absent while it has not yet.
   */
  | {
      readonly kind: "healthy";
      readonly build?: string;
      readonly parts?: HqParts;
    }
  /** Not answering as the official HQ since `since` (wall ms): the last known state stays shown. */
  | { readonly kind: "unavailable"; readonly since: number }
  /**
   * Answering, and refusing this person's sign-in: no outage anybody else shares, so no time it
   * began; the menu's outage line carries HQ's own reason.
   */
  | { readonly kind: "refused" };
