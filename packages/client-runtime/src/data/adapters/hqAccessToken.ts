import type { ZeropsAccess, ZeropsAccessAsk, ZeropsApiClient } from "../../zerops/api.ts";

/**
 * The person's current Zerops access token and its expiry, as HQ's door and an operation's press
 * take them; `ask` says why, which may renew the session first ({@link ZeropsAccessAsk}).
 */
export const zeropsAccessToken =
  (client: Pick<ZeropsApiClient, "accessToken">) =>
  (ask?: ZeropsAccessAsk): Promise<ZeropsAccess> =>
    client.accessToken(ask);
