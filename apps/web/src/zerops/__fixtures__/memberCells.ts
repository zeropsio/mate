/**
 * The account's real cells over a platform that answers only an organization's members, counting
 * each read — so a test sees what sharing the cells do, not what a fake claims.
 *
 * Lives outside `*.test.*` on purpose: it runs `Effect.runPromise`, which
 * `no-manual-effect-runtime-in-tests` forbids in test files.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import {
  makeZeropsCells,
  type AccountScope,
  type OrganizationRef,
  type ZeropsCells,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";

export function makeMemberCells(input: {
  readonly scope: AccountScope;
  readonly organization: OrganizationRef;
  readonly members: () => Promise<ReadonlyArray<ZeropsOrganizationMember>>;
}): Promise<ZeropsCells> {
  const unused = Effect.die("members only");
  return Effect.runPromise(
    makeZeropsCells({
      scope: input.scope,
      access: () => ({
        status: "verified",
        account: input.scope.account,
        accountEpoch: input.scope.epoch,
        verifiedAtMs: 0,
        deadlineMs: Number.MAX_SAFE_INTEGER,
        mutationsAllowed: true,
        organizations: [{ organization: input.organization, mutationsAllowed: true }],
        projects: [],
      }),
      adapter: {
        readOrganizationMembers: () => Effect.promise(input.members),
        readProjectPublicAccess: () => Effect.never,
        readOrganizationLocations: () => unused,
        readServiceAuthorizedAgents: () => unused,
        readServiceMateFlag: () => unused,
        readOrganizationIntegrationTokenGrants: () => unused,
        readServiceVariableNames: () => unused,
      },
    }),
  );
}
