import type { ZeropsAccess, ZeropsApiClient } from "../../zerops/api.ts";

/**
 * The person's current Zerops access token and its expiry, as HQ's door takes them; `refused`, a
 * token HQ refused, asks Zerops again unless a renewal has already replaced it.
 */
export const zeropsAccessToken =
  (client: Pick<ZeropsApiClient, "accessToken">) =>
  (refused?: string): Promise<ZeropsAccess> =>
    client.accessToken(refused);
