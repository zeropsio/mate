/**
 * Inputs that bring an account's streams up and its scopes to a committed baseline, the way the
 * adapters would: for projection and publication tests that start from a known account.
 */
import { linkKeys, type LinkKey, type ScopeKey } from "../model.ts";
import type { AccountInput, Row } from "../reducer.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { runningScope, type ProcessValue } from "../families/process.ts";
import { projectsScope, type ProjectValue } from "../families/project.ts";
import { activeScope, type VersionValue } from "../families/version.ts";
import { servicesScope, type ServiceValue } from "../families/service.ts";
import { mateVariablesFamily, mateVariablesScope } from "../families/mateVariables.ts";

export const ORG = "org";

const event = (key: LinkKey | ScopeKey, streamEvent: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event: streamEvent,
});

/** A link demanded and open, and each scope's first attempt baselined and live. */
function liveScopes(
  link: LinkKey,
  scopes: ReadonlyArray<{
    readonly scope: ScopeKey;
    readonly via: "zerops-realtime";
    readonly members: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<Row>;
  }>,
): ReadonlyArray<AccountInput> {
  return [
    event(link, { kind: "demand", demanded: true }),
    event(link, { kind: "handshake" }),
    event(link, { kind: "baseline-committed" }),
    ...scopes.flatMap(({ scope, via, members, rows }): AccountInput[] => [
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      event(scope, { kind: "handshake" }),
      { kind: "baseline-begin", scope, generation: 1 },
      { kind: "baseline-commit", scope, generation: 1, via, members, rows },
      event(scope, { kind: "baseline-committed" }),
    ]),
  ];
}

/** A process as its whole row reads: what a test does not name is a plain deploy. */
export const processValue = (
  patch: Pick<ProcessValue, "id" | "projectId"> & Partial<ProcessValue>,
): ProcessValue => ({
  serviceStackIds: [],
  status: "RUNNING",
  actionName: "stack.deploy",
  created: "2026-10-05T18:49:08Z",
  ...patch,
});

export const zeropsVersion = (version: number) => ({ kind: "zerops" as const, version });

/** A project as its whole row reads: what a test does not name is an active one. */
export const projectValue = (
  patch: Pick<ProjectValue, "id"> & Partial<ProjectValue>,
): ProjectValue => ({ name: patch.id, status: "ACTIVE", clientId: ORG, ...patch });

/** An organization's roster read and live: these projects, as their rows read. */
export function liveProjects(
  orgId: string,
  projects: ReadonlyArray<Readonly<Record<string, unknown>> & { readonly id: string }>,
): ReadonlyArray<AccountInput> {
  return liveScopes(linkKeys.zerops(orgId), [
    {
      scope: projectsScope(orgId),
      via: "zerops-realtime",
      members: projects.map((project) => project.id),
      rows: projects.map((project) => ({
        family: "project",
        id: project.id,
        value: projectValue({ clientId: orgId, ...project }),
        revision: zeropsVersion(1),
      })),
    },
  ]);
}

/** An app version as its whole row reads: what a test does not name is an active Git deploy. */
export const versionValue = (
  patch: Pick<VersionValue, "id" | "serviceId"> & Partial<VersionValue>,
): VersionValue => ({ projectId: "p1", status: "ACTIVE", source: "GIT", ...patch });

/** An organization's services read and live: these services, as their rows read. */
export function liveServices(
  orgId: string,
  services: ReadonlyArray<
    Readonly<Record<string, unknown>> & { readonly id: string; readonly projectId: string }
  >,
): ReadonlyArray<AccountInput> {
  return liveScopes(linkKeys.zerops(orgId), [
    {
      scope: servicesScope(orgId),
      via: "zerops-realtime",
      members: services.map((service) => service.id),
      rows: services.map((service) => ({
        family: "service",
        id: service.id,
        value: serviceValue(service),
        revision: zeropsVersion(1),
      })),
    },
  ]);
}

/** A service as its whole row reads: what a test does not name is an active runtime. */
export const serviceValue = (
  patch: Pick<ServiceValue, "id" | "projectId"> & Partial<ServiceValue>,
): ServiceValue => ({ name: patch.id, status: "ACTIVE", ...patch });

/**
 * The organization's link live: its roster, its running work and, where named, its active versions
 * and its services.
 */
export function liveZerops(input: {
  readonly running: ReadonlyArray<Parameters<typeof processValue>[0]>;
  readonly projects?: ReadonlyArray<Parameters<typeof projectValue>[0]>;
  readonly active?: ReadonlyArray<Parameters<typeof versionValue>[0]>;
  readonly services?: ReadonlyArray<Parameters<typeof serviceValue>[0]>;
}): ReadonlyArray<AccountInput> {
  const projects = input.projects ?? [];
  return liveScopes(linkKeys.zerops(ORG), [
    {
      scope: projectsScope(ORG),
      via: "zerops-realtime",
      members: projects.map((project) => project.id),
      rows: projects.map((project) => ({
        family: "project",
        id: project.id,
        value: projectValue(project),
        revision: zeropsVersion(1),
      })),
    },
    {
      scope: runningScope(ORG),
      via: "zerops-realtime",
      members: input.running.map((process) => process.id),
      rows: input.running.map((process) => ({
        family: "process",
        id: process.id,
        value: processValue(process),
        revision: zeropsVersion(1),
      })),
    },
    ...(input.active === undefined
      ? []
      : [
          {
            scope: activeScope(ORG),
            via: "zerops-realtime" as const,
            members: input.active.map((version) => version.id),
            rows: input.active.map((version) => ({
              family: "version" as const,
              id: version.id,
              value: versionValue(version),
              revision: zeropsVersion(1),
            })),
          },
        ]),
    ...(input.services === undefined
      ? []
      : [
          {
            scope: servicesScope(ORG),
            via: "zerops-realtime" as const,
            members: input.services.map((service) => service.id),
            rows: input.services.map((service) => ({
              family: "service" as const,
              id: service.id,
              value: serviceValue(service),
              revision: zeropsVersion(1),
            })),
          },
        ]),
  ]);
}

/**
 * One Mate's container's variables read once: what its search answers of the platform rows
 * (`{ id, serviceStackId, key, content }`) that are this service's.
 */
export function liveMateVariables(
  orgId: string,
  serviceId: string,
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
): ReadonlyArray<AccountInput> {
  const scope = mateVariablesScope(orgId, serviceId);
  const value = mateVariablesFamily.sampled?.decode({
    items: rows.filter((row) => row.serviceStackId === serviceId),
  });
  return [
    event(scope, { kind: "demand", demanded: true }),
    event(scope, { kind: "attempt" }),
    event(scope, { kind: "handshake" }),
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-read",
      members: [serviceId],
      rows:
        value === null || value === undefined
          ? []
          : [
              {
                family: "mateVariables",
                id: serviceId,
                value,
                revision: { kind: "zerops", version: null },
              },
            ],
    },
    event(scope, { kind: "baseline-committed" }),
  ];
}
