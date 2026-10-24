import { mayBearHq } from "@t3tools/shared/zeropsRoles";

import { zeropsClientsFromUser, type ZeropsApiClient } from "../../zerops/api.ts";

/** The slice of the Zerops client an organisation's start reads and writes. */
export type OrgStartClient = Pick<
  ZeropsApiClient,
  "verifiedUser" | "fetchUser" | "mintIntegrationToken" | "deleteIntegrationToken"
>;

/**
 * The organisation's key, which HQ reads its members with (mate-hq `spec/protocol.md`
 * "Sign-in and tickets"): an integration token `READ_ONLY` with no grant and no flag. Only an
 * active Owner or Admin, as the session's own `GET /user/info` names them, starts the organisation;
 * HQ checks the same.
 */
export function zeropsOrgStart(
  client: OrgStartClient,
  clientId: string,
  locks: LockManager | undefined,
) {
  return {
    mayStart: async () => {
      const user = client.verifiedUser()?.user ?? (await client.fetchUser());
      return mayBearHq(zeropsClientsFromUser(user).find((org) => org.id === clientId));
    },
    mintKey: async () => {
      const minted = await client.mintIntegrationToken({
        clientId,
        name: "mate-hq-org-key",
        roleCode: "READ_ONLY",
        projects: [],
      });
      return { id: minted.id, token: minted.token };
    },
    deleteKey: (tokenId: string) => client.deleteIntegrationToken({ clientId, tokenId }),
    /** One start at a time across this browser's tabs, so a second tab finds the first's. */
    withLock: <T>(name: string, run: () => Promise<T>): Promise<T> =>
      locks === undefined ? run() : (locks.request(name, run) as Promise<T>),
  };
}
