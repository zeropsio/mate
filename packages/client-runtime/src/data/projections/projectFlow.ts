/** One application's flow from keyed owner facts; reading it holds no app detail. */
import { appRecipeOf, groupStopsOf, summarizeEnvironmentServices } from "../../zerops/index.ts";
import { nameUnderApp } from "../../zerops/groups.ts";
import { hqRefusalWords } from "../../zerops/hq/index.ts";
import type { GroupStopProject } from "../../zerops/groupDeploys.ts";
import type { ZeropsOrganization } from "../../zerops/api.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { appEnvironments } from "./appEnvironments.ts";
import { hqAppDetail } from "./hqAppDetail.ts";
import { platformAccess } from "./platformAccess.ts";
import { projectServices } from "./services.ts";
import { serviceRuns } from "./serviceRuns.ts";
import {
  groupChangesOf,
  joinProjectFlows,
  HQ_CHANGES_UNANSWERED,
  type ZeropsProjectFlow,
} from "./projectFlowJoin.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness } from "./freshness.ts";
import type { HqAppContents } from "../../zerops/hq/index.ts";

/** Application membership and availability, without joining placements, people or history. */
export const projectApplications: Projection<
  string,
  {
    readonly ids: ReadonlyArray<string>;
    readonly read: boolean;
    readonly unavailable: boolean;
  }
> = {
  name: "projectApplications",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = hqAppsScope(orgId);
    const freshness = scopeFreshness(read, scope);
    return {
      ids: read.members(scope).ids.filter((id) => read.fact("hqApp", id).kind === "known"),
      read: freshness.complete && freshness.live,
      unavailable:
        !freshness.live &&
        (freshness.complete || freshness.reconnecting || freshness.unavailableReason !== undefined),
    };
  },
  equals: sameValue,
};

/** A row's current contents and explicit changes refusal come from its own app record. */
export const projectSummary: Projection<
  { readonly orgId: string; readonly appId: string },
  {
    readonly contents: HqAppContents | undefined;
    readonly changesRefused: boolean;
  }
> = {
  name: "projectSummary",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, { orgId, appId }) => {
    const app = read.fact("hqApp", appId);
    const listed = read.members(hqAppsScope(orgId)).ids.includes(appId);
    return {
      contents:
        listed && app.kind === "known" && scopeFreshness(read, hqAppsScope(orgId)).live
          ? app.value.contents
          : undefined,
      changesRefused:
        listed &&
        app.kind === "known" &&
        app.value.changes !== undefined &&
        "refused" in app.value.changes,
    };
  },
  equals: sameValue,
};

export interface ProjectFlowKey {
  readonly orgId: string;
  readonly appId: string;
  readonly hqAddress: string | undefined;
  readonly viewer: ZeropsOrganization | undefined;
}

export const projectFlow: Projection<ProjectFlowKey, ZeropsProjectFlow | undefined> = {
  name: "projectFlow",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, key) => {
    const { orgId, appId, hqAddress, viewer } = key;
    if (!read.members(hqAppsScope(orgId)).ids.includes(appId)) return undefined;
    const fact = read.fact("hqApp", appId);
    if (fact.kind !== "known") return undefined;
    const app = fact.value;
    const detail = hqAppDetail.derive(read, key);
    const { stage, production } = detail.recipes;
    const recipe =
      stage === undefined || production === undefined
        ? undefined
        : appRecipeOf({
            stage: stage.state === "present" ? stage.importYaml : null,
            production: production.state === "present" ? production.importYaml : null,
          });
    const projectIds =
      app.projectIds ??
      read.members(placementsScope(orgId)).ids.filter((id) => {
        const placement = read.fact("placement", id);
        return placement.kind === "known" && placement.value.appId === appId;
      });
    const projects: GroupStopProject[] = [];
    const versions = new Map<string, string>();
    const activeVersions = new Map<string, string | null>();
    const withheld = new Map<string, string>();
    for (const projectId of projectIds) {
      const access = platformAccess.derive(read, { orgId, viewer, projectId });
      if (access.kind !== "allowed") {
        if (access.kind === "denied")
          withheld.set(projectId, "You no longer have access to this project.");
        continue;
      }
      const project = read.fact("project", projectId);
      if (project.kind !== "known") continue;
      const services = summarizeEnvironmentServices(
        projectServices.derive(read, { orgId, projectId }).services ?? [],
      ).deployable;
      projects.push({
        projectId,
        name: nameUnderApp(project.value.name, app.name),
        services,
      });
      for (const { serviceId } of services) {
        const runs = serviceRuns.derive(read, { orgId, serviceId });
        if (typeof runs === "string") continue;
        activeVersions.set(serviceId, runs.activeId);
        if (runs.name !== null) versions.set(serviceId, runs.name);
      }
    }
    const environments = appEnvironments.derive(read, key).environments;
    const changes =
      hqAddress === undefined || app.changes === undefined
        ? undefined
        : groupChangesOf(
            { [appId]: app.changes },
            new Map(detail.changes === undefined ? [] : [[appId, detail.changes]]),
            hqAddress,
          );
    const link = read.stream(linkKeys.hq(orgId));
    const unavailable =
      link.phase === "refused" ||
      link.phase === "recovering" ||
      link.phase === "reauthenticating" ||
      link.phase === "unsupported";
    const flow = joinProjectFlows({
      groups: [{ groupId: appId }],
      navigationOffers: { [appId]: app.releaseOffer },
      stops: new Map(
        environments === undefined
          ? []
          : [[appId, groupStopsOf({ environments, projects, versions, activeVersions, recipe })]],
      ),
      releases: new Map(detail.releases === undefined ? [] : [[appId, detail.releases]]),
      repos: new Map(detail.repos === undefined ? [] : [[appId, detail.repos]]),
      recipes: new Map(recipe === undefined ? [] : [[appId, recipe]]),
      permissions: new Map(),
      live: new Map(),
      changes: changes?.rows ?? null,
      changesFailure: unavailable ? HQ_CHANGES_UNANSWERED : undefined,
      changesRefused: changes?.refused ?? new Map(),
      withheld,
    }).get(appId);
    if (flow === undefined || !unavailable) return flow;
    return {
      ...flow,
      release: {
        ...flow.release,
        gate: {
          allowed: false,
          reason:
            link.phase === "refused"
              ? hqRefusalWords({
                  code: link.fault?.code ?? "refused",
                  reason: link.fault?.message ?? "HQ read refused",
                })
              : HQ_CHANGES_UNANSWERED,
        },
      },
    };
  },
  equals: (a, b) =>
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      sameValue(
        {
          ...a,
          release: {
            ...a.release,
            runs: a.release.runs === undefined ? undefined : [...a.release.runs],
            repositories:
              a.release.repositories === undefined ? undefined : [...a.release.repositories],
          },
        },
        {
          ...b,
          release: {
            ...b.release,
            runs: b.release.runs === undefined ? undefined : [...b.release.runs],
            repositories:
              b.release.repositories === undefined ? undefined : [...b.release.repositories],
          },
        },
      )),
};
