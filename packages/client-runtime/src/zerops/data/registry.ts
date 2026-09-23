/**
 * The account's group registry as knowledge (DESIGN §2.B B3): a projection of the Gitea project's
 * pushed tags (B2), per organization.
 *
 * Tags that are not known give a registry that is not known — unread, being read, failed or gone,
 * never the empty registry. An entry is kept whatever the account knows of its project, and says
 * what that is: a project the account read is `present`, one it has not read is `unknown`, and one
 * whose absence carries evidence is `stale` with that evidence. An entry for a deleted project is
 * neither dropped, which would hide what the broker's rights loop still reads, nor shown as a
 * member that is there.
 *
 * Pure: no I/O, no clock.
 */
import {
  parseZeropsRegistry,
  type ZeropsRegistryGroup,
  type ZeropsRegistryProject,
} from "../groupRegistry.ts";
import type { AbsenceEvidence, Known } from "../knowledge/known.ts";

export type RegistryEntryStanding =
  | { readonly kind: "present" }
  | { readonly kind: "unknown" }
  /** The project is gone, and this is how the account knows. */
  | { readonly kind: "stale"; readonly evidence: AbsenceEvidence };

export interface RegistryMemberView extends ZeropsRegistryProject {
  readonly standing: RegistryEntryStanding;
}

export interface RegistryGroupView extends Omit<ZeropsRegistryGroup, "projects"> {
  readonly projects: ReadonlyArray<RegistryMemberView>;
}

export interface RegistryView {
  readonly groups: ReadonlyArray<RegistryGroupView>;
  /** Members marked for removal (`mate:leaving:`). */
  readonly leaving: ReadonlyArray<string>;
}

function standingOf(project: Known<unknown>): RegistryEntryStanding {
  switch (project.state) {
    case "known":
      return { kind: "present" };
    case "gone":
      return { kind: "stale", evidence: project.evidence };
    case "unread":
    case "reading":
    case "failed":
      return { kind: "unknown" };
  }
}

/**
 * The registry the Gitea project's tags state, each entry beside what the account knows of its
 * project (`projectOf`).
 */
export function selectRegistry(
  tags: Known<ReadonlyArray<string>>,
  projectOf: (projectId: string) => Known<unknown>,
): Known<RegistryView> {
  if (tags.state !== "known") return tags;
  const registry = parseZeropsRegistry(tags.value);
  return {
    ...tags,
    value: {
      groups: registry.groups.map((group) => ({
        ...group,
        projects: group.projects.map((project) => ({
          ...project,
          standing: standingOf(projectOf(project.projectId)),
        })),
      })),
      leaving: registry.leaving,
    },
  };
}
