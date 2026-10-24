/** The organisation's Chief has a dedicated record; every general Mate list reads this partition. */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject } from "../../zerops/api.ts";
import { zeropsStructure } from "../../zerops/hq/structure.ts";
import { placementsScope, type PlacementValue } from "../families/hqNavigation.ts";
import { SHOWN_MATES } from "../families/mateLink.ts";
import { projectsScope } from "../families/project.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { hqMateIdentities } from "./hqMateIdentity.ts";
import { hqMateOverview, hqMates } from "./hqMates.ts";
import { canonicalHqMenuNavigation } from "./hqNavigation.ts";
import { organizationProjects } from "./projects.ts";

/** The organisation's Chief as this reader's navigation holds it: the entry HQ marks `org`. */
export type DirectoryChief =
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly projectId: string; readonly placement: PlacementValue };
export interface HqMateDirectory {
  readonly chief: DirectoryChief;
  readonly mates: Readonly<Record<string, PlacementValue>>;
  readonly chiefProjectIds: ReadonlyArray<string>;
  readonly chiefEnvironmentIds: ReadonlyArray<EnvironmentId>;
}

export const EMPTY_MATE_DIRECTORY: HqMateDirectory = {
  chief: { kind: "unknown" },
  mates: {},
  chiefProjectIds: [],
  chiefEnvironmentIds: [],
};

/** Tags classify a Chief before its mark is read; HQ's `chief: "org"` names the organisation's. */
export function isListedMateProject(
  directory: HqMateDirectory,
  project: Pick<ZeropsProject, "id" | "tagList">,
): boolean {
  return !project.tagList?.includes("chief") && !directory.chiefProjectIds.includes(project.id);
}
export function isListedMateEnvironment(
  directory: HqMateDirectory,
  environmentId: EnvironmentId,
): boolean {
  return !directory.chiefEnvironmentIds.includes(environmentId);
}

export const hqMateDirectory: Projection<string, HqMateDirectory> = {
  name: "hqMateDirectory",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = placementsScope(orgId);
    const chiefs = new Set<string>();
    const placements: Record<string, PlacementValue> = {};
    let marked: Extract<DirectoryChief, { kind: "present" }> | undefined;
    let unknown = read.coverage(scope) !== "complete";
    for (const id of read.members(scope).ids) {
      const fact = read.fact("placement", id);
      if (fact.kind !== "known") {
        unknown = true;
        continue;
      }
      placements[id] = fact.value;
      if (fact.value.person?.chief !== undefined) chiefs.add(id);
      if (fact.value.person?.chief === "org")
        marked = { kind: "present", projectId: id, placement: fact.value };
    }
    for (const id of read.members(projectsScope(orgId)).ids) {
      const project = read.fact("project", id);
      if (project.kind === "known" && project.value.tagList?.includes("chief")) chiefs.add(id);
    }
    const chiefProjectIds = [...chiefs];
    const chiefEnvironmentIds = new Set<EnvironmentId>();
    for (const projectId of chiefProjectIds) {
      const overviewId = hqMateOverview.derive(read, { orgId, projectId })?.identity?.environmentId;
      if (overviewId !== undefined) chiefEnvironmentIds.add(overviewId);
      for (const key of read.index(SHOWN_MATES.name, SHOWN_MATES.key)) {
        const link = read.fact("mateLink", key);
        if (link.kind !== "known" || link.value.projectId !== projectId) continue;
        const { environment } = link.value;
        const id =
          environment.credential.kind === "held"
            ? environment.credential.environmentId
            : environment.record;
        if (id !== null) chiefEnvironmentIds.add(id);
      }
    }
    return {
      chief: marked ?? { kind: unknown ? "unknown" : "absent" },
      mates: Object.fromEntries(Object.entries(placements).filter(([id]) => !chiefs.has(id))),
      chiefProjectIds,
      chiefEnvironmentIds: [...chiefEnvironmentIds],
    };
  },
  equals: sameValue,
};

export const organizationMateListProjects = {
  name: "organizationMateListProjects",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const projects = organizationProjects.derive(read, orgId);
    const directory = hqMateDirectory.derive(read, orgId);
    return {
      ...projects,
      projects: projects.projects.filter((project) => isListedMateProject(directory, project)),
    };
  },
  equals: sameValue,
} satisfies Projection<string, ReturnType<typeof organizationProjects.derive>>;

export const canonicalHqListNavigation = {
  name: "canonicalHqListNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const navigation = canonicalHqMenuNavigation.derive(read, orgId);
    const directory = hqMateDirectory.derive(read, orgId);
    const chiefIds = new Set(directory.chiefProjectIds);
    const structure = navigation.structure;
    if (structure === null) return navigation;
    return {
      ...navigation,
      structure: {
        ...structure,
        ...(structure.unheld === undefined
          ? {}
          : {
              unheld: Object.fromEntries(
                Object.entries(structure.unheld).filter(([id]) => !chiefIds.has(id)),
              ),
            }),
        apps: structure.apps.flatMap((app) => {
          const projects = app.projects.filter(({ projectId }) => !chiefIds.has(projectId));
          return projects.length === 0 && app.projects.length > 0 ? [] : [{ ...app, projects }];
        }),
        ungrouped: structure.ungrouped.filter(({ projectId }) => !chiefIds.has(projectId)),
      },
    };
  },
  equals: sameValue,
} satisfies Projection<string, ReturnType<typeof canonicalHqMenuNavigation.derive>>;

export const hqListNavigation = {
  name: "hqListNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const navigation = canonicalHqListNavigation.derive(read, orgId);
    return {
      ...navigation,
      structure: navigation.structure === null ? null : zeropsStructure(navigation.structure),
    };
  },
  equals: sameValue,
} satisfies Projection<
  string,
  Omit<ReturnType<typeof canonicalHqListNavigation.derive>, "structure"> & {
    readonly structure: ReturnType<typeof zeropsStructure> | null;
  }
>;

export const hqListedMateIdentities: typeof hqMateIdentities = {
  name: "hqListedMateIdentities",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const directory = hqMateDirectory.derive(read, orgId);
    return Object.fromEntries(
      Object.entries(hqMateIdentities.derive(read, orgId)).filter(
        ([id]) => directory.mates[id] !== undefined,
      ),
    );
  },
  equals: sameValue,
};
export const hqListedMates: typeof hqMates = {
  name: "hqListedMates",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const directory = hqMateDirectory.derive(read, orgId);
    const mates = hqMates.derive(read, orgId);
    return {
      ...mates,
      mates: Object.fromEntries(
        Object.entries(mates.mates).filter(([id]) => directory.mates[id] !== undefined),
      ),
    };
  },
  equals: sameValue,
};
