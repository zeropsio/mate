/**
 * Where the web's Mate connections get their tickets (spec-mate §3.8): the HQ this build names,
 * signed in to as the open account in the Mate's organisation, one API per organisation for the
 * account's lifetime. With no account open, or no HQ named, an attempt waits for the next try.
 */
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";

import { setMateTicketHq } from "~/connection/platform";

import { accountHqApi, configuredHq } from "./accountHq";

/** The open account's tickets, until the returned close. */
export function openMateTickets(client: ZeropsApiClient): () => void {
  const apis = new Map<string, HqApi>();
  return setMateTicketHq((orgId) => {
    const hq = configuredHq();
    if (hq === undefined) return null;
    const known = apis.get(orgId);
    if (known !== undefined) return known;
    const api = accountHqApi(client, orgId, hq);
    apis.set(orgId, api);
    return api;
  });
}
