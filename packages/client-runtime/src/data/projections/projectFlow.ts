/** One application's flow from keyed owner facts; reading it holds no app detail. */
import { ProjectId } from "@t3tools/contracts";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import {
  canonicalGroupStopsOf,
  codeRepositoriesOf,
  zeropsStops,
  type CanonicalGroupStops,
} from "../../zerops/groupDeploys.ts";
import type { CanonicalEnvironmentRow } from "../../zerops/groupRows.ts";
import { flowReleaseOf, appRecipeOf, summarizeEnvironmentServices } from "../../zerops/index.ts";
import { nameUnderApp } from "../../zerops/groups.ts";
import { readyGitPreflight } from "../../zerops/release.ts";
import { knownPresentation } from "../../zerops/knowledge/presentation.ts";
import { hqRefusalWords } from "../../zerops/hq/index.ts";
import type { GroupStopProject } from "../../zerops/groupDeploys.ts";
import type { ZeropsOrganization } from "../../zerops/api.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { canonicalAppEnvironments } from "./appEnvironments.ts";
import { hqAppDetail } from "./hqAppDetail.ts";
import { platformAccess } from "./platformAccess.ts";
import { projectServices } from "./services.ts";
import { serviceRuns } from "./serviceRuns.ts";
import {
  canonicalStopRow,
  groupChangesOf,
  joinProjectFlows,
  HQ_CHANGES_UNANSWERED,
  type ZeropsProjectFlow,
  type ReleaseLive,
} from "./projectFlowJoin.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness, scopeSlow } from "./freshness.ts";
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
      // A slow HQ on a connection that holds is working, not unanswered.
      unavailable:
        !freshness.live &&
        !scopeSlow(read, scope) &&
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
  readonly review?:
    | {
        readonly permission: ZeropsProjectFlow["release"]["permission"];
        readonly live: ReleaseLive;
      }
    | undefined;
}

export interface CanonicalProjectFlow extends Omit<
  ZeropsProjectFlow,
  "declarations" | "environments" | "environmentInputs"
> {
  readonly declarations: CanonicalGroupStops["declarations"];
  readonly environments: ReadonlyArray<CanonicalEnvironmentRow>;
  readonly environmentInputs: CanonicalGroupStops["environments"];
  /**
   * The repositories a Mate ships code to (`codeRepositoriesOf`), as HQ lists them; `undefined`
   * until HQ said its repositories and the recipe's stage and production.
   */
  readonly codeRepos: ReadonlyArray<RepoListEntry> | undefined;
  /** The Mate tier as `main` holds it: what pairs a Mate's dev with each part's preview; `undefined` while unread. */
  readonly mateTier: string | undefined;
}
export const canonicalProjectFlow: Projection<ProjectFlowKey, CanonicalProjectFlow | undefined> = {
  name: "canonicalProjectFlow",
  keyOf: (key) =>
    JSON.stringify({
      ...key,
      review:
        key.review === undefined
          ? undefined
          : {
              ...key.review,
              live: {
                ...key.review.live,
                runs: key.review.live.runs === undefined ? undefined : [...key.review.live.runs],
              },
            },
    }),
  derive: (read, key) => {
    const { orgId, appId, hqAddress, viewer } = key;
    if (!read.members(hqAppsScope(orgId)).ids.includes(appId)) return undefined;
    const fact = read.fact("hqApp", appId);
    if (fact.kind !== "known") return undefined;
    const app = fact.value;
    const detail = hqAppDetail.derive(read, key);
    const { mate, stage, production } = detail.recipes;
    const recipe =
      stage === undefined || production === undefined
        ? undefined
        : appRecipeOf({
            stage: stage.state === "present" ? stage.importYaml : null,
            production: production.state === "present" ? production.importYaml : null,
          });
    const code = codeRepositoriesOf(
      [mate, stage, production].flatMap((tier) =>
        tier?.state === "present" ? [tier.importYaml] : [],
      ),
    );
    const environments = canonicalAppEnvironments.derive(read, key).environments;
    const projectIds = [
      ...new Set(
        (environments ?? []).flatMap((environment) =>
          environment.target.kind === "zerops" ? [environment.target.projectId] : [],
        ),
      ),
    ];
    const projects: (Omit<GroupStopProject, "projectId"> & { readonly projectId: ProjectId })[] =
      [];
    const versions = new Map<string, string>();
    const activeVersions = new Map<string, string | null>();
    const withheld = new Map<string, string>();
    for (const projectId of projectIds) {
      const access = platformAccess.derive(read, { orgId, viewer, projectId });
      if (access.kind !== "allowed") {
        if (access.kind === "denied") {
          const notice = knownPresentation(
            { state: "withheld", reason: "access-denied", cause: null },
            {
              subject: "this project",
              entity: "project",
              source: "zerops",
              checking: null,
              negative: null,
            },
            { nowMs: 0, updateOffered: false },
          );
          if (notice.message !== null) withheld.set(projectId, notice.message.text);
        }
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
    const stops =
      environments === undefined
        ? undefined
        : canonicalGroupStopsOf({
            unread: canonicalAppEnvironments.derive(read, key).unread,
            environments,
            projects,
            versions,
            activeVersions,
            recipe,
            git: {
              releases: detail.releases,
              repos: detail.repos,
              preflight: detail.preflight,
              live: scopeFreshness(read, hqAppsScope(orgId)).live,
            },
          });
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
      stops: new Map(stops === undefined ? [] : [[appId, zeropsStops(stops)]]),
      releases: new Map(detail.releases === undefined ? [] : [[appId, detail.releases]]),
      repos: new Map(detail.repos === undefined ? [] : [[appId, detail.repos]]),
      recipes: new Map(recipe === undefined ? [] : [[appId, recipe]]),
      review: key.review !== undefined,
      permissions: new Map(
        key.review?.permission === undefined ? [] : [[appId, key.review.permission]],
      ),
      live: new Map(key.review === undefined ? [] : [[appId, key.review.live]]),
      changes: changes?.rows ?? null,
      changesFailure: unavailable ? HQ_CHANGES_UNANSWERED : undefined,
      changesRefused: changes?.refused ?? new Map(),
      withheld,
    }).get(appId);
    if (flow === undefined) return undefined;
    const git = flow.release.git;
    const delivery =
      git === undefined
        ? undefined
        : stops?.environments.find((entry) => entry.id === git.attachment.environmentId)?.git;
    const canonical: CanonicalProjectFlow = {
      ...flow,
      release:
        git === undefined
          ? flow.release
          : {
              ...flow.release,
              git: {
                ...git,
                delivery,
                preflight: readyGitPreflight({
                  entries: flow.release.entries,
                  branch: git.attachment.target.branch,
                  repos: detail.repos,
                  reviews: detail.preflight,
                }),
              },
            },
      declarations: stops?.declarations ?? [],
      environmentInputs: stops?.environments ?? [],
      codeRepos:
        recipe === undefined || detail.repos === undefined
          ? undefined
          : detail.repos.filter(({ name }) => code.has(name)),
      mateTier: mate?.state === "present" ? mate.importYaml : undefined,
      environments: (stops?.environments ?? []).map((entry) =>
        canonicalStopRow(entry, (detail.releases ?? []).map(flowReleaseOf)),
      ),
    };
    if (!unavailable) return canonical;
    return {
      ...canonical,
      release: {
        ...canonical.release,
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

/** @deprecated Project DTOs retained until web/mobile migrate their consumers. */
export const projectFlow: Projection<ProjectFlowKey, ZeropsProjectFlow | undefined> = {
  ...canonicalProjectFlow,
  name: "projectFlow",
  equals: sameValue,
  derive: (read, key) => {
    const flow = canonicalProjectFlow.derive(read, key);
    if (flow === undefined) return undefined;
    const stops = zeropsStops({
      declarations: flow.declarations,
      environments: flow.environmentInputs,
      unread: flow.unreadEnvironments,
    });
    return {
      ...flow,
      declarations: stops.declarations,
      environmentInputs: stops.environments,
      environments: flow.environments.flatMap(({ id: _id, target, ...row }) =>
        target.kind === "zerops" ? [{ ...row, projectId: target.projectId }] : [],
      ),
    };
  },
};
