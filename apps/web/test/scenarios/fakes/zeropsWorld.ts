import type { ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";

export interface Organization {
  name: string;
  settings?: Record<string, unknown>;
}
export interface ScenarioWorld extends FakeWorld {
  organizations: Map<string, Organization>;
  people: Map<string, string>;
  /** Grants by membership id, including projects not created yet. */
  projectGrants: Map<string, Record<string, ZeropsOrgRole>>;
}
export interface PersonOptions {
  orgId?: string;
  role?: ZeropsOrgRole | "Developer";
  canCreateProjects?: boolean;
  status?: string;
  grants?: Record<string, ZeropsOrgRole>;
}

export function scenarioWorld(world: FakeWorld & Partial<ScenarioWorld>): ScenarioWorld {
  return Object.assign(world, {
    organizations:
      world.organizations ??
      new Map([...world.members.keys()].map((id) => [id, { name: id === "ORG" ? "KRLS" : id }])),
    people: world.people ?? new Map<string, string>(),
    projectGrants: world.projectGrants ?? new Map<string, Record<string, ZeropsOrgRole>>(),
  });
}

/** A personal credential belongs to a person; each organization's membership owns its rights. */
export function definePerson(world: ScenarioWorld, name: string, options: PersonOptions = {}) {
  const orgId = options.orgId ?? "ORG";
  if (!world.organizations.has(orgId))
    world.organizations.set(orgId, { name: orgId === "ORG" ? "KRLS" : orgId });
  const members = world.members.get(orgId) ?? [];
  const existing = members.find((member) => member.userId === name && member.kind === "person");
  const roleCode =
    options.role === "Developer"
      ? "NO_ACCESS"
      : (options.role ?? existing?.roleCode ?? "NO_ACCESS");
  const canCreateProjects =
    options.canCreateProjects ??
    (options.role === undefined
      ? (existing?.canCreateProjects ?? false)
      : options.role === "Developer" || options.role === "OWNER" || options.role === "ADMIN");
  const member = {
    name,
    kind: "person" as const,
    userId: name,
    clientUserId: existing?.clientUserId ?? (orgId === "ORG" ? `C-${name}` : `C-${orgId}-${name}`),
    roleCode,
    status: options.status ?? existing?.status ?? "ACTIVE",
    canCreateProjects,
  };
  world.members.set(orgId, [...members.filter((row) => row !== existing), member]);
  const grants = options.grants ?? world.projectGrants.get(member.clientUserId) ?? {};
  world.projectGrants.set(member.clientUserId, grants);
  world.projects = world.projects.map((project) =>
    project.orgId !== orgId
      ? project
      : {
          ...project,
          userRoles: [
            ...project.userRoles.filter((grant) => grant.clientUserId !== member.clientUserId),
            ...(grants[project.id]
              ? [{ clientUserId: member.clientUserId, roleCode: grants[project.id]! }]
              : []),
          ],
        },
  );
  const token = name === "owner" ? "personal" : `personal-${name}`;
  const credential = world.tokens.get(token);
  if (!credential || credential.orgId === orgId)
    world.tokens.set(token, {
      id: token,
      name: `Scenario ${name}`,
      orgId,
      roleCode,
      canCreateProjects,
      canViewFinances: false,
      canEditFinances: false,
      projects: [],
      createdMs: credential?.createdMs ?? Date.now(),
      createdByUser: name,
    });
  world.people.set(token, name);
  return { token, member };
}

export function projectRoles(world: ScenarioWorld, projectId: string, orgId = "ORG") {
  return (world.members.get(orgId) ?? []).flatMap((member) => {
    const grant = world.projectGrants.get(member.clientUserId)?.[projectId];
    return grant ? [{ clientUserId: member.clientUserId, roleCode: grant }] : [];
  });
}
