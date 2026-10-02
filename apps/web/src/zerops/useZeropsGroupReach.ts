/**
 * Keeps every Mate's token reaching exactly its group, holding no more of that
 * group than it needs, and carrying no one-time mint — and every project in
 * the group from handing its variables to each of its own containers.
 *
 * The decision is `groupReach.ts`; this is the shell that reads the account
 * and performs the writes. It runs off the same candidate list the projects
 * screen already has, because that list *is* the group — membership is a tag
 * on each project — and a screen that can see a group is the only thing that
 * can keep a container's reach honest.
 *
 * It plans whenever what it decides on moves — the groups' shape or the token
 * list's grants — and only then. A token write changes grants, never a
 * container's environment, so nothing restarts, and an account whose groups
 * have not moved plans no writes at all. That is the whole reason this lives
 * here rather than at creation time: an environment added, renamed or removed
 * from anywhere — this client, another device, the Zerops GUI — is reconciled
 * the next time somebody looks at their projects. When, what is remembered,
 * and what a refusal costs is the driver's (`useZeropsGroupReach.logic.ts`);
 * it reads nothing itself, only the shared token list this hook is shown.
 *
 * Every Mate is read, solo ones included. Reach is not the only thing the plan
 * decides any more: it also lowers the token the platform minted with `ADMIN`
 * to `BASIC_USER` (guide 0.2), and that is how a Mate this client never
 * created — the pool's from sign-up, an older account's — is secured at all. A
 * group of one used to be skipped because it had no sibling to reach; it has a
 * token to lower.
 *
 * A refused write never puts an error on a screen that is otherwise fine —
 * this is a background repair the person did not ask for. It is logged once
 * and planned again after its back-off.
 *
 * This reconcile never restarts a Mate (spec-mate §3 B-1/B-2/B-3): a birth
 * has exactly one restart and it runs before anyone is admitted, in
 * `provisioning.ts`'s `hardening` phase. A reach running from a page a
 * person is already in must not carry that restart along with it —
 * `isolateProjectEnv` used to run here too and would throw someone already
 * inside a conversation out of it mid-session.
 *
 * The delegation drop (guide 0.4) lives in the birth now too
 * (`ZeropsApiClient.hardenMate`, run from `hardening`) — the one-time mint a
 * Mate this client never created still needs the reconcile's other half, the
 * token-widening plan below, but the delegation itself is dropped once, at
 * birth, never re-read here.
 *
 * The plan's key covers the token set, not only the group shape: a token
 * that appears after a Mate finishes hardening changes nothing about which
 * projects are in which group, and is still a reason to plan (measured live
 * 2026-09-22, a hardened Mate's token still carrying a delegation).
 */

import {
  selectTokenGrants,
  type TokensCellRequest,
  type ZeropsIntegrationTokenGrantMetadata,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsGroupReachGroup, ZeropsIntegrationToken } from "@t3tools/client-runtime/zerops";
import { useEffect, useMemo } from "react";

import { tokenWrites } from "./tokenWriteLock";
import { groupReachDriverFor, makeGroupReachDriver } from "./useZeropsGroupReach.logic";
import { runZeropsCommand, useKnown, useZeropsData } from "./zeropsDataContext";

/** Restores the existing planner shape from credential-free grant metadata. */
export function integrationTokensFromGrantMetadata(
  metadata: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>,
): ReadonlyArray<ZeropsIntegrationToken> {
  return metadata.map((token) => ({
    id: token.tokenId,
    name: token.name,
    projects: token.grants,
    ...(token.roleCode === undefined ? {} : { roleCode: token.roleCode }),
    ...(token.created === undefined ? {} : { created: token.created }),
    ...(token.createdByUser === undefined ? {} : { createdByUser: token.createdByUser }),
  }));
}

export function useZeropsGroupReach(input: {
  readonly clientId: string | undefined;
  readonly groups: ReadonlyArray<ZeropsGroupReachGroup>;
  /** The group listing is a complete read: a part of one would strip siblings from tokens. */
  readonly enabled: boolean;
}): void {
  const { clientId, groups, enabled } = input;
  const { organizationRef, runtime } = useZeropsData();
  const hasMate = groups.some((group) => group.mateProjectIds.length > 0);
  // Held while the screen shows a Mate, not only while it may plan: a demand dropped and taken
  // again past the list's freshness would read it again on every inventory refresh.
  const request = useMemo<TokensCellRequest | null>(
    () =>
      clientId !== undefined && hasMate
        ? {
            kind: "tokens",
            account: runtime.scope,
            organization: organizationRef(clientId),
          }
        : null,
    [clientId, hasMate, organizationRef, runtime.scope],
  );
  const shown = useKnown(request === null ? null : runtime.cells.known(request));
  const grants = selectTokenGrants(shown);
  const grantMetadata = grants.status === "known" ? grants.grants : null;
  const listingComplete = shown.state === "known" && shown.coverage === "complete";
  // Which read the list is: a read newer than our write that still shows the old grants is repaired.
  const listingRead = shown.state === "known" ? shown.asOf.ordinal : Number.NEGATIVE_INFINITY;
  const tokens = useMemo(
    () => (grantMetadata === null ? null : integrationTokensFromGrantMetadata(grantMetadata)),
    [grantMetadata],
  );

  const driver = useMemo(
    () =>
      clientId === undefined
        ? null
        : groupReachDriverFor(runtime, clientId, () => makeGroupReachDriver({ hold: tokenWrites })),
    [clientId, runtime],
  );

  // Declared before the observation: a screen opened again lends its writes first, then plans.
  useEffect(() => {
    if (driver === null || clientId === undefined) return;
    const organization = organizationRef(clientId);
    return driver.attach({
      write: (write) =>
        runZeropsCommand(
          runtime.commands.setIntegrationTokenProjects({ organization, ...write }),
        ).then(() => undefined),
      report: ({ name, cause, retryInMs }) => {
        console.warn(
          `The group reach of ${name} was refused; it is planned again in ${Math.round(retryInMs / 1000)} s.`,
          cause,
        );
      },
    });
  }, [clientId, driver, organizationRef, runtime.commands]);

  // Every render may hand over new arrays; the driver plans only when their keys moved.
  useEffect(() => {
    // An account with no Mate has no token of ours to touch.
    if (driver === null || !enabled || !hasMate || tokens === null) return;
    driver.observe({ groups, listing: tokens, complete: listingComplete, read: listingRead });
  }, [driver, enabled, groups, hasMate, listingComplete, listingRead, tokens]);
}
