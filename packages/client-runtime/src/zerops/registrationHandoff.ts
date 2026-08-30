/**
 * What `provisioning.start` needs right after an in-app registration: the
 * org the pool claim landed in, and whether the platform actually claimed a
 * ready-made project for it.
 *
 * Kept pure and separate from any component: Cloudflare Turnstile only
 * allows the registration widget on app.zerops.io, so this path cannot be
 * exercised live from any other origin — the decision it makes is proven
 * here, against a registration response, rather than end to end.
 */

import { zeropsClientsFromUser, type ZeropsRegistrationResponse } from "./api.ts";

export interface RegistrationProvisioningStart {
  /** The org to poll for the claimed project, or null when the response named none. */
  readonly clientId: string | null;
  readonly zcpClaimed: boolean | undefined;
}

export function deriveProvisioningStart(
  response: ZeropsRegistrationResponse,
): RegistrationProvisioningStart {
  const organizations = response.user ? zeropsClientsFromUser(response.user) : [];
  return {
    clientId: organizations[0]?.id ?? null,
    zcpClaimed: response.zcpClaimed,
  };
}
