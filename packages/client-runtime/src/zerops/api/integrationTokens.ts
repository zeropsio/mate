import { ZeropsApiError } from "../errors.ts";
import type { ZeropsDoor } from "../api.ts";
import type { ZeropsIntegrationToken } from "../groupReach.ts";

/** The Zerops REST API's integration-token reads: one resource of `../api.ts`'s client. */

/**
 * `GET /client/{id}/integration-token/list` — every token on the account,
 * with the project grants each one carries.
 *
 * The bare `…/integration-token` GET answers 405; the listing is under
 * `/list` (measured 2026-09-06). The platform answers the whole list: `limit`
 * and `offset` are ignored (measured 2026-10-03).
 */
export async function listIntegrationTokens(
  door: ZeropsDoor,
  clientId: string,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ZeropsIntegrationToken>> {
  const body = await door<{ readonly list?: ReadonlyArray<ZeropsIntegrationToken> }>(
    `/client/${clientId}/integration-token/list`,
    { signal: signal ?? null },
  );
  return body.list ?? [];
}

/**
 * `GET /client/{id}/integration-token/{tokenId}` — one token, with the project grants it
 * carries, in the shape the list gives each (HQ and the Mate's door read a token this way): one
 * small answer where the list is every token on the account, whole. `undefined` once the token
 * is gone.
 */
export async function readIntegrationToken(
  door: ZeropsDoor,
  clientId: string,
  tokenId: string,
  signal?: AbortSignal,
): Promise<ZeropsIntegrationToken | undefined> {
  try {
    return await door<ZeropsIntegrationToken>(`/client/${clientId}/integration-token/${tokenId}`, {
      signal: signal ?? null,
    });
  } catch (cause) {
    if (cause instanceof ZeropsApiError && cause.kind === "not-found") return undefined;
    throw cause;
  }
}
