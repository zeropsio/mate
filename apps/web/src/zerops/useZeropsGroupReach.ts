/**
 * Keeps every Mate's token reaching exactly its group.
 *
 * The decision is `groupReach.ts`; this is the shell that reads the account
 * and performs the writes. It runs off the same candidate list the projects
 * screen already has, because that list *is* the group — membership is a tag
 * on each project — and a screen that can see a group is the only thing that
 * can keep a container's reach honest.
 *
 * Running on every read is deliberate and cheap. A token write changes grants,
 * never a container's environment, so nothing restarts, and an account whose
 * groups have not moved plans no writes at all. That is the whole reason this
 * lives here rather than at creation time: an environment added, renamed or
 * removed from anywhere — this client, another device, the Zerops GUI — is
 * reconciled the next time somebody looks at their projects.
 *
 * Failures are swallowed on purpose. This is a background repair of something
 * the user did not ask for; a token the account is not allowed to rewrite, or
 * a network that dropped, must not put an error on a screen that is otherwise
 * fine. The next read tries again.
 */

import { useEffect, useRef } from "react";

import {
  planAccountGroupReach,
  type ZeropsApiClient,
  type ZeropsGroupReachGroup,
} from "@t3tools/client-runtime/zerops";

/** Serialises a plan input so an unchanged account is not re-read. */
function groupsKey(groups: ReadonlyArray<ZeropsGroupReachGroup>): string {
  return groups
    .map(
      (group) =>
        `${[...group.projectIds].sort().join(",")}|${[...group.mateProjectIds].sort().join(",")}`,
    )
    .sort()
    .join(";");
}

export function useZeropsGroupReach(input: {
  readonly client: ZeropsApiClient;
  readonly clientId: string | undefined;
  readonly groups: ReadonlyArray<ZeropsGroupReachGroup>;
  readonly enabled: boolean;
}): void {
  const { client, clientId, groups, enabled } = input;
  const lastKey = useRef<string | null>(null);
  const key = groupsKey(groups);

  useEffect(() => {
    // A group of one has no sibling to reach, so an account of solo Mates
    // never lists the tokens at all.
    if (!enabled || clientId === undefined || groups.every((g) => g.projectIds.length < 2)) return;
    if (lastKey.current === `${clientId}:${key}`) return;
    lastKey.current = `${clientId}:${key}`;

    let cancelled = false;
    void (async () => {
      try {
        const tokens = await client.listIntegrationTokens(clientId);
        if (cancelled) return;
        for (const write of planAccountGroupReach({ groups, tokens })) {
          if (cancelled) return;
          await client.setIntegrationTokenProjects({ clientId, ...write });
        }
      } catch {
        // Background repair: try again on the next read rather than showing
        // the user an error about something they did not ask for.
        lastKey.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, clientId, enabled, groups, key]);
}
