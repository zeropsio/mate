/**
 * What a write to a project's `tagList` means (DESIGN §2.B B2, §6.5): a patch, applied by the
 * TagWriter to a list it has just read, never a list a caller computed from an older copy.
 *
 * `PUT /project/{id}` replaces the list wholesale, so a caller that sent the list it held would
 * delete every tag written since it read. A patch says only what it changes; every other tag —
 * a person's own, another writer's, one this client cannot parse — is carried through.
 *
 * Each patch is idempotent: applied to a list it already holds, it changes nothing. That is how
 * the writer tells a write that landed from one another writer replaced.
 *
 * Pure: no I/O, no clock.
 */
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import { planGroupMembership, planGroupRegistration } from "../groupCreation.ts";
import { parseZeropsRegistry } from "../groupRegistry.ts";
import {
  withZeropsBotTag,
  withZeropsGroupTags,
  withZeropsMateTag,
  type ZeropsEnvironmentRole,
} from "../groups.ts";
import { withMateSignerTag } from "../mateAccess.ts";

export type ProjectTagPatch =
  /** Moves a project into a group, out of one, or changes its role or the group's mirrored name. */
  | {
      readonly kind: "group-membership";
      readonly next: {
        readonly groupId?: string;
        readonly role?: ZeropsEnvironmentRole;
        readonly label?: string;
      };
    }
  /** Names the project's agent; a non-blank name also declares the Mate. */
  | { readonly kind: "agent-name"; readonly name: string }
  /** Records who signed an agent in (D6). */
  | { readonly kind: "agent-signer"; readonly agentId: string; readonly userId: string }
  /** A group in the account's registry, on its Gitea project; its slug is derived here. */
  | { readonly kind: "registry-group"; readonly groupId: string; readonly name: string }
  /** A project in a registered group as a Mate, a stage or the production. */
  | {
      readonly kind: "registry-member";
      readonly groupId: string;
      readonly projectId: string;
      readonly member: RoleProjectKind;
      /**
       * Projects the platform answered `projectNotFound` for: a member of the group naming one is
       * dropped in the same write (`planGroupMembership`, 2026-09-24).
       */
      readonly gone?: ReadonlyArray<string> | undefined;
    };

export type ProjectTagRefusal =
  /** The registry names no such group — yet, when its own write has not landed. */
  | { readonly code: "group-unknown"; readonly reason: string }
  /** The registry holds something that contradicts the patch; the words say what. */
  | { readonly code: "registry-conflict"; readonly reason: string }
  /**
   * The group's one production is another project, named so the caller can ask the platform
   * whether it still exists — and write again with it `gone` when it does not.
   */
  | { readonly code: "production-held"; readonly reason: string; readonly projectId: string };

export type ProjectTagPatchResult =
  | { readonly ok: true; readonly tags: ReadonlyArray<string> }
  | { readonly ok: false; readonly refusal: ProjectTagRefusal };

const changed = (tags: ReadonlyArray<string>): ProjectTagPatchResult => ({ ok: true, tags });

/** The list the patch leaves, or why the list it was given does not take it. */
export function applyProjectTagPatch(
  tags: ReadonlyArray<string>,
  patch: ProjectTagPatch,
): ProjectTagPatchResult {
  switch (patch.kind) {
    case "group-membership":
      return changed(withZeropsGroupTags(tags, patch.next));
    case "agent-name": {
      const named = withZeropsBotTag(tags, patch.name);
      return changed(patch.name.trim().length === 0 ? named : withZeropsMateTag(named));
    }
    case "agent-signer":
      return changed(withMateSignerTag(tags, patch.agentId, patch.userId));
    case "registry-group": {
      const registry = parseZeropsRegistry(tags);
      // The group is there: our own earlier write, read back.
      if (registry.groups.some((group) => group.groupId === patch.groupId)) return changed(tags);
      const registration = planGroupRegistration({
        name: patch.name,
        groupId: patch.groupId,
        registry,
      });
      return registration.ok
        ? changed(registration.plan.tagList)
        : { ok: false, refusal: { code: "registry-conflict", reason: registration.reason } };
    }
    case "registry-member": {
      const registry = parseZeropsRegistry(tags);
      if (!registry.groups.some((group) => group.groupId === patch.groupId)) {
        return {
          ok: false,
          refusal: { code: "group-unknown", reason: "That project is not in the registry yet." },
        };
      }
      const membership = planGroupMembership({
        registry,
        groupId: patch.groupId,
        projectId: patch.projectId,
        kind: patch.member,
        gone: patch.gone,
      });
      if (membership.ok) return changed(membership.tagList);
      return {
        ok: false,
        refusal:
          membership.production === undefined
            ? { code: "registry-conflict", reason: membership.reason }
            : {
                code: "production-held",
                reason: membership.reason,
                projectId: membership.production,
              },
      };
    }
  }
}

/** Whether two lists hold the same tags, however the platform ordered them. */
export function sameProjectTags(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((tag, index) => tag === sortedRight[index]);
}
