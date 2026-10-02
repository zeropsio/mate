/**
 * What the client offers a person to do with HQ's structure, decided by the rule HQ enforces (`can`,
 * `@t3tools/shared/zeropsPermissions`) over the facts the client holds — cached ones: the session's
 * own membership and the projects the listing read.
 *
 * The one place a writing verb is asked over cached facts: an offer writes nothing, and HQ decides
 * the write itself over facts it reads at that moment (`Facts<"fresh">`, whose type rule stands).
 * Nothing else in the client asks `can`, and nothing builds fresh facts (the lint rule
 * `t3code/no-direct-permission-rule` holds it, this module's import its one ledgered exception).
 * A person the client does not know is offered nothing.
 *
 * Pure (rule R1).
 *
 * @module offers
 */
import {
  can,
  type Facts,
  type FactsFor,
  type Held,
  type Principal,
  type Targets,
  type Verb,
} from "@t3tools/shared/zeropsPermissions";
import { ZEROPS_ACTIVE_MEMBER_STATUS } from "@t3tools/shared/zeropsRoles";

import type { HqPlacement } from "./hq/placement.ts";

/** The person asking, as the session knows them: who they are, and their membership. */
export interface OfferViewer {
  readonly userId: string;
  /** Their member row's id: what a project's grants name. */
  readonly clientUserId: string;
  readonly roleCode: string | undefined;
  readonly canCreateProjects: boolean | undefined;
}

/** The person with the facts the client holds about them. */
export interface OfferAsker {
  readonly principal: Principal;
  readonly facts: Facts<"cached">;
}

/**
 * The person asking, with their own membership as the only member the client vouches for (an
 * active one: the session's) and the projects it holds; none where the client knows no one.
 */
export function offerAsker(
  viewer: OfferViewer | undefined,
  projects: ReadonlyArray<{
    readonly id: string;
    readonly userRoles?:
      | ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>
      | undefined;
  }>,
): OfferAsker | null {
  if (viewer === undefined) return null;
  return {
    principal: { kind: "person", userId: viewer.userId },
    facts: {
      freshness: "cached",
      members: [
        {
          userId: viewer.userId,
          clientUserId: viewer.clientUserId,
          roleCode: viewer.roleCode ?? "",
          status: ZEROPS_ACTIVE_MEMBER_STATUS,
          canCreateProjects: viewer.canCreateProjects === true,
        },
      ],
      projects: projects.map((project) => ({ id: project.id, userRoles: project.userRoles ?? [] })),
    },
  };
}

/** Whether to offer the person `verb` on `target`: HQ's rule over the cached facts; never unasked. */
export function mayOffer<V extends Verb>(
  asker: OfferAsker | null,
  verb: V,
  target: Targets[V],
): boolean {
  if (asker === null) return false;
  // The one place cached facts stand in for fresh ones: an offer, never a write.
  const facts = asker.facts as unknown as FactsFor<V>;
  return can(asker.principal, verb, target, facts).allow;
}

/** What HQ holds a project as, from where it places it: `none` where it places it nowhere. */
export function heldOf(project: { readonly hq?: HqPlacement | undefined }): Held {
  const placed = project.hq;
  if (placed === undefined) return "none";
  return placed.appId === null ? "mate" : placed.kind;
}
