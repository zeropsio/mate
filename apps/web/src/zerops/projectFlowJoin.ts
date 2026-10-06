/**
 * An application's flow, joined from the parts each party proves (`projectFlows.ts`): HQ says which
 * of its projects are its stage and production and how each deploy went, what is waiting to land
 * and what landed, and what was released; its recipe says which tiers it can add and the
 * repository each runtime builds from; the account says which projects it holds and what each
 * service runs. Each application's flow is the same object until one of its own parts changes, so
 * one application answering never republishes another.
 */
import {
  deployedCommit,
  environmentRow,
  flowAppChanges,
  flowReleaseOf,
  groupStopsOf,
  releaseRunBy,
  nameStopByRelease,
  releaseDeploys,
  releaseInFlight,
  releaseStalled,
  releaseCandidate,
  compareForRelease,
  releaseEntries,
  releaseRow,
  type AppRecipe,
  type CompareReads,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowRelease,
  type GroupEnvironmentRowInput,
  type GroupStops,
  type MovedCommits,
  type ProductionRun,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import type { HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqNavigationApp, HqNavigationChange } from "@t3tools/shared/hqStream";
import type { Release } from "@t3tools/shared/hqRelease";

import type { ZeropsProjectFlow } from "./projectFlows";
import type { ComparedCommits } from "./useReleaseComparisons";

/** One group's changes as its flow shows them: the open ones a push reached, and the landed. */
export interface GroupChanges {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
}

/** Stands for an application's detail no surface holds, as a key of {@link changeRows}. */
const UNHELD_DETAIL: ReadonlyArray<HqChange> = [];

/**
 * Each application's changes as rows, by the identity of its menu rows and of its detail's changes
 * as HQ last sent them, so an application nothing came down for keeps its rows.
 */
const changeRows = new WeakMap<
  ReadonlyArray<HqNavigationChange>,
  WeakMap<ReadonlyArray<HqChange>, Map<string, GroupChanges>>
>();

/**
 * Every application's changes as its group's flow shows them, at HQ's official address: the open
 * ones from HQ's navigation, with what a held detail adds; and, apart, HQ's refusal of them in its
 * words for each application whose changes it refuses this person.
 */
export function groupChangesOf(
  open: Readonly<Record<string, ReadonlyArray<HqNavigationChange> | { readonly refused: string }>>,
  detail: ReadonlyMap<string, ReadonlyArray<HqChange>>,
  hqAddress: string,
): {
  readonly rows: ReadonlyMap<string, GroupChanges>;
  readonly refused: ReadonlyMap<string, string>;
} {
  const rows = new Map<string, GroupChanges>();
  const refused = new Map<string, string>();
  for (const [appId, listed] of Object.entries(open)) {
    if ("refused" in listed) {
      refused.set(appId, hqRefusalWords({ code: listed.refused, reason: listed.refused }));
      continue;
    }
    const held = detail.get(appId);
    let byDetail = changeRows.get(listed);
    if (byDetail === undefined) {
      byDetail = new WeakMap();
      changeRows.set(listed, byDetail);
    }
    let byAddress = byDetail.get(held ?? UNHELD_DETAIL);
    if (byAddress === undefined) {
      byAddress = new Map();
      byDetail.set(held ?? UNHELD_DETAIL, byAddress);
    }
    let shown = byAddress.get(hqAddress);
    if (shown === undefined) {
      shown = flowAppChanges({ appId, open: listed, detail: held, hqAddress });
      byAddress.set(hqAddress, shown);
    }
    rows.set(appId, shown);
  }
  return { rows, refused };
}

/** What the flow says while HQ has never told it any change, and does not answer. */
export const HQ_CHANGES_UNANSWERED = "HQ is not answering right now.";

/** Each group's stops as last built, with the content they were built from. */
const builtStops = new Map<string, { readonly key: string; readonly stops: GroupStops }>();

/**
 * A group's stops: the same object for as long as what they are built from reads the same, so one
 * group's change never republishes another's flow.
 */
export function groupStopsFor(
  groupId: string,
  input: Parameters<typeof groupStopsOf>[0],
): GroupStops {
  const { recipe } = input;
  const key = JSON.stringify([
    input.environments,
    input.projects,
    [...input.versions],
    [...(input.activeVersions ?? [])],
    recipe === undefined ? null : [recipe.tiers, [...recipe.repositories]],
  ]);
  const before = builtStops.get(groupId);
  if (before?.key === key) return before.stops;
  const stops = groupStopsOf(input);
  builtStops.set(groupId, { key, stops });
  return stops;
}

/** What a release lists while HQ's repositories or the recipe are not read. */
const NOTHING_TO_LIST: ReadonlyMap<string, string> = new Map();

/**
 * What a release of a group would put live, the production services nothing is told of, and what
 * each production service runs (`productionRuns`) — what a roll back compares from.
 */
export interface ReleaseLive {
  readonly moved: ComparedCommits;
  readonly untold: ReadonlyArray<string>;
  readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
}

/** What to ask HQ of a group's release, and what production runs, which it is asked from. */
export interface ReleasePlan extends CompareReads {
  readonly running: ReadonlyMap<string, ProductionRun>;
}

/** What goes live while nothing has been asked of HQ: what production runs is not known yet. */
export const NOT_COMPARED: MovedCommits = { state: "reading" };
const NOT_ASKED: ReleaseLive = { moved: NOT_COMPARED, untold: [], runs: undefined };

/** What a flow's key says of what goes live: the commits each comparison moves, or its state. */
function liveKey(live: MovedCommits): unknown {
  if (live.state !== "known") return live;
  return live.moved.map(({ repository, services, commits, total }) => [
    repository,
    services,
    total,
    commits.map(({ sha }) => sha),
  ]);
}

/** Stands for a part a group has no answer for, as a key of {@link joinedFlows}. */
const UNREAD_HALF = {};

/**
 * Every group's flow, by the identity of its parts — its stops, its releases, its changes: a group
 * whose parts did not change keeps its flow object.
 */
const joinedFlows = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, Map<string, ZeropsProjectFlow>>>
>();

/**
 * Joins each group's parts into its flow. A group is shown once any part
 * answered.
 */
export function joinProjectFlows(input: {
  readonly groups: ReadonlyArray<{ readonly groupId: string }>;
  readonly review?: boolean | undefined;
  readonly navigationOffers?: Readonly<Record<string, HqNavigationApp["releaseOffer"]>> | undefined;
  /** Each group's stops, by its id, while HQ has told its environments. */
  readonly stops: ReadonlyMap<string, GroupStops>;
  /** Each group's releases as HQ records them, newest first, by its id, once HQ answered. */
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  /** Each group's repositories with their `main`, read with its releases. */
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  /** Each group's recipe on `main`: the repository each production runtime builds from. */
  readonly recipes: ReadonlyMap<string, AppRecipe>;
  /** HQ's rule for this person releasing each group, in its words; absent while it cannot be asked. */
  readonly permissions: ReadonlyMap<string, ReleaseGate | undefined>;
  /**
   * What a release of each group would put live, as HQ compared it, and the production services
   * whose commit cannot be told; absent while not asked.
   */
  readonly live: ReadonlyMap<string, ReleaseLive>;
  /** Each group's changes, by its id, once HQ told them; `null` without HQ's address to link. */
  readonly changes: ReadonlyMap<string, GroupChanges> | null;
  /** Why HQ has told nothing of them, while it does not answer. */
  readonly changesFailure: string | undefined;
  /** HQ's refusal of each group's changes to this person, in its words, by its id. */
  readonly changesRefused: ReadonlyMap<string, string>;
  /** Why the grant withholds a project, by project id, for each project it withholds alone. */
  readonly withheld: ReadonlyMap<string, string>;
}): ReadonlyMap<string, ZeropsProjectFlow> {
  const flows = new Map<string, ZeropsProjectFlow>();
  for (const group of input.groups) {
    const stops = input.stops.get(group.groupId);
    const records = input.releases.get(group.groupId);
    const changes = input.changes?.get(group.groupId);
    const navigationOffer = input.navigationOffers?.[group.groupId];
    if (
      stops === undefined &&
      records === undefined &&
      changes === undefined &&
      navigationOffer == null
    )
      continue;
    let byReleases = joinedFlows.get(stops ?? UNREAD_HALF);
    if (byReleases === undefined) {
      byReleases = new WeakMap();
      joinedFlows.set(stops ?? UNREAD_HALF, byReleases);
    }
    let byChanges = byReleases.get(records ?? UNREAD_HALF);
    if (byChanges === undefined) {
      byChanges = new WeakMap();
      byReleases.set(records ?? UNREAD_HALF, byChanges);
    }
    let byGroup = byChanges.get(changes ?? UNREAD_HALF);
    if (byGroup === undefined) {
      byGroup = new Map();
      byChanges.set(changes ?? UNREAD_HALF, byGroup);
    }
    const withheld = new Map(
      (stops?.environments ?? []).flatMap(({ projectId }) => {
        const notice = input.withheld.get(projectId);
        return notice === undefined ? [] : [[projectId, notice] as const];
      }),
    );
    const { rollouts } = releaseDeploys(stops?.environments ?? []);
    const newest = records?.[0] === undefined ? undefined : flowReleaseOf(records[0]);
    const deploy = {
      inFlight: releaseInFlight({ newest, rollouts }),
      stalled: releaseStalled({ newest, rollouts }),
    };
    const repos = input.repos.get(group.groupId);
    const recipe = input.recipes.get(group.groupId);
    const permission = input.permissions.get(group.groupId);
    const live = input.live.get(group.groupId) ?? NOT_ASKED;
    const changesFailure = input.changesRefused.get(group.groupId) ?? input.changesFailure;
    const key = JSON.stringify([
      navigationOffer,
      input.review,
      group.groupId,
      deploy.inFlight ?? null,
      deploy.stalled ?? null,
      changes === undefined ? (changesFailure ?? null) : null,
      [...withheld],
      repos ?? null,
      recipe === undefined ? null : [...recipe.productionRepositories],
      permission ?? null,
      liveKey(live.moved),
      live.untold,
      live.runs === undefined ? null : [...live.runs],
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(
        group,
        { stops, records, changes, changesFailure },
        { repos, recipe, permission, live, navigationOffer, review: input.review },
        deploy,
        withheld,
      );
      byGroup.set(key, flow);
    }
    flows.set(group.groupId, flow);
  }
  return flows;
}

/**
 * A stop's row. A production is named by the newest release all its services run, where one
 * does; a stage, and a production no release matches, keep the first labelled service's name.
 */
function stopRow(
  entry: GroupEnvironmentRowInput,
  releases: ReadonlyArray<FlowRelease>,
): EnvironmentRow {
  const row = environmentRow(entry);
  if (entry.tier !== "production") return row;
  const running = new Map<string, string>();
  for (const service of entry.services) {
    const sha = deployedCommit(service.appVersionName);
    if (sha !== undefined) running.set(service.hostname, sha);
  }
  const tag = releaseRunBy(releases, running);
  return tag === undefined ? row : nameStopByRelease(row, tag);
}

function projectFlow(
  group: { readonly groupId: string },
  halves: {
    readonly stops: GroupStops | undefined;
    /** Its releases as HQ records them, newest first; `undefined` until HQ answered. */
    readonly records: ReadonlyArray<Release> | undefined;
    readonly changes: GroupChanges | undefined;
    readonly changesFailure: string | undefined;
  },
  /** What a release is offered from; each `undefined` until it is read or can be asked. */
  offered: {
    readonly repos: ReadonlyArray<RepoListEntry> | undefined;
    readonly recipe: AppRecipe | undefined;
    readonly permission: ReleaseGate | undefined;
    readonly live: ReleaseLive;
    readonly review?: boolean | undefined;
    readonly navigationOffer?: HqNavigationApp["releaseOffer"] | undefined;
  },
  /** The newest release on its way to production, or stalled there (`releaseInFlight`, `releaseStalled`). */
  deploy: { readonly inFlight: string | undefined; readonly stalled: string | undefined },
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { stops, records, changes } = halves;
  const environmentInputs = stops?.environments ?? [];
  // A production the grant withholds shows nothing it runs, so
  // nothing is measured against it, and no release is listed.
  const withheldProduction = environmentInputs.find(
    (entry) => entry.tier === "production" && withheld.has(entry.projectId),
  );
  const productionWithheld =
    withheldProduction === undefined ? undefined : withheld.get(withheldProduction.projectId);
  const sides = releaseDeploys(environmentInputs.filter((entry) => !withheld.has(entry.projectId)));
  const releaseList = (records ?? []).map(flowReleaseOf);
  const liveTag = releaseRunBy(releaseList, sides.production);
  // Known once HQ has told the environments: an application holds a production in whatever state
  // HQ records it, and one with none has nothing to release to, nor to roll back.
  const hasProduction =
    stops === undefined
      ? undefined
      : environmentInputs.some((entry) => entry.tier === "production");
  const releaseRows = releaseList.map((entry, index) => {
    const row = releaseRow(entry, index, {
      production: sides.production,
      failed: sides.failed,
      live: entry.tag === liveTag,
    });
    return hasProduction === true ? row : { ...row, rollBack: false };
  });
  // Until HQ's releases, its repositories and the recipe are read, nothing is known to release:
  // the gate says it is checking.
  const { repos, recipe, permission, live } = offered;
  const read =
    records === undefined || repos === undefined || recipe === undefined
      ? undefined
      : releaseCandidate({ productionRepositories: recipe.productionRepositories, repos });
  const candidate = read?.candidate ?? NOTHING_TO_LIST;
  const offer = {
    entries: releaseEntries(candidate),
    comparison: compareForRelease({ candidate, production: sides.production }),
    contents: live.moved.state === "known" ? live.moved.moved : [],
    suggestion: "",
  };
  const navigation = offered.navigationOffer;
  const gate: ReleaseGate =
    offered.review && (read === undefined || live.moved.state === "reading")
      ? { allowed: false, reason: "Checking what can be released…" }
      : offered.review && live.moved.state === "failed"
        ? {
            allowed: false,
            reason: `Can't check what can be released: ${live.moved.reason.replace(/\.$/u, "")}.`,
          }
        : navigation == null
          ? { allowed: false, reason: "Checking what can be released…" }
          : "refused" in navigation
            ? {
                allowed: false,
                reason: hqRefusalWords({ code: navigation.refused, reason: navigation.refused }),
                refusedBy: "hq",
              }
            : navigation.gate.allow
              ? { allowed: true }
              : permission?.allowed === false
                ? permission
                : { allowed: false, reason: navigation.gate.reason };
  return {
    groupId: group.groupId,
    declarations: stops?.declarations ?? [],
    declarationsRead: stops !== undefined,
    environments: environmentInputs.map((entry) => stopRow(entry, releaseList)),
    environmentInputs,
    recipeTiers: recipe?.tiers ?? [],
    recipeRead: recipe !== undefined,
    pullRequests: changes?.pullRequests ?? [],
    changesKnown: changes !== undefined,
    changesFailure: changes === undefined ? halves.changesFailure : undefined,
    merged: changes?.merged ?? [],
    releases: releaseRows,
    releasesKnown: records !== undefined,
    repos,
    // A production the grant withholds is measured against nothing, and offers nothing.
    release:
      productionWithheld === undefined
        ? {
            ...offer,
            gate,
            suggestion:
              navigation != null && !("refused" in navigation)
                ? navigation.suggestion
                : offer.suggestion,
            summary:
              navigation != null && !("refused" in navigation) ? navigation.summary : undefined,
            comparisonFailure: live.moved.state === "failed" ? live.moved : undefined,
            permission,
            groupHead: read?.groupHead,
            ...deploy,
            inFlight:
              navigation != null && !("refused" in navigation)
                ? (navigation.inFlight ?? deploy.inFlight)
                : deploy.inFlight,
            untold: live.untold,
            runs: live.runs,
            repositories: recipe?.productionRepositories,
          }
        : {
            ...offer,
            gate: { allowed: false, reason: productionWithheld },
            permission,
            groupHead: undefined,
            comparison: [],
            entries: [],
            ...deploy,
            contents: [],
            untold: [],
            runs: undefined,
            repositories: undefined,
          },
  };
}
