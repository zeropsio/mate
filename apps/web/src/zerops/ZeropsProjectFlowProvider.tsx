/**
 * Reads every project's flow once for the whole account, and holds the verbs
 * that move it (`projectFlowContext.ts`, D26).
 *
 * Each part is read from the party that can prove it. HQ says which of a
 * group's projects are its stage and production, and how each deploy of
 * theirs went (`hqEnvironmentsAtom`), and what is waiting to land and what
 * landed — its Mates' changes (`hqChangesAtom`) — both down the
 * organization's stream; its recipe says which tiers a group can add and the
 * repository each runtime builds from (`useZeropsAppRecipes`). The account
 * says which projects a group holds and which version each service runs, as
 * its store states it, and HQ says what was released (`useZeropsAppReleases`).
 * Each group's flow is the same object until one of its own parts changes, so
 * one group answering never republishes another.
 *
 * A release is offered as HQ offers it (`useReleasePermission`) of each production
 * runtime at its repository's `main` as HQ lists it, and made — or rolled
 * back — in HQ, as the person. What each stop runs is the account's
 * stops' answer (`account/stops.ts`). A change is merged
 * and closed in HQ, as the person, and comes back down HQ's stream.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  deployedCommit,
  environmentRow,
  flowChanges,
  flowReleaseOf,
  flowVerbKey,
  groupStopsOf,
  releaseRunBy,
  nameStopByRelease,
  projectNameInApp,
  readZeropsMembership,
  releaseDeploys,
  releaseInFlight,
  releaseStalled,
  releaseCandidate,
  releaseOffer,
  releaseReads,
  releaseRow,
  statedActiveVersions,
  statedVersionNames,
  movedCommits,
  productionRuns,
  summarizeEnvironmentServices,
  type AppRecipe,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowRelease,
  type GroupEnvironmentRowInput,
  type GroupStopProject,
  type GroupStops,
  type FlowVerb,
  type CompareReads,
  type MovedCommits,
  type ProductionRun,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import { HQ_NOT_OPEN, hqRefusalWords, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import { type Deployment } from "@t3tools/client-runtime/zerops/flow";
import {
  ZeropsProjectId,
  ZeropsServiceId,
  type ServiceRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { ChangeLink, HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import type { Release } from "@t3tools/shared/hqRelease";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { hqChangesAtom, hqDown, hqEnvironmentsAtom, hqNavigationAtom } from "../state/zerops";
import { useDetailProjects } from "./accountEnvironments";
import { useStatedVersions, useStopDeployments } from "./accountForge";
import { accountHqApi, useAccountHq } from "./accountHq";
import {
  ZeropsProjectFlowContext,
  type FlowVerbOutcome,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
import { useZeropsAppRecipes } from "./useZeropsAppRecipes";
import { useZeropsAppReleases } from "./useZeropsAppReleases";
import { useZeropsCompares, type ComparedCommits } from "./useZeropsCompares";
import { useReleasePermission } from "./useChangeOffers";
import { useZeropsRegistry } from "./useZeropsRegistry";
import {
  findInventoryProjectRef,
  HeldInventoryContext,
  inventoryProjectRefKey,
  projectAuthority,
  withheldProjectNotice,
} from "./inventoryContext";
import { useProjectsServices } from "./ZeropsAccountData";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY_FLOWS: ReadonlyMap<string, ZeropsProjectFlow> = new Map();
const NO_FAILURES: ReadonlyMap<string, string> = new Map();
/** What a second press of a verb that is still running says: the first one is the one that counts. */
export const VERB_ALREADY_RUNNING = "It is already on its way.";

const refused = (reason: string): FlowVerbOutcome => ({ ok: false, reason });

/** A change's verb, merge or close, which HQ answers. */
type ChangeVerb = Extract<FlowVerb, { readonly kind: "merge" | "close" }>;

/** What a merge refused for a head nobody was shown says: HQ's own words for it. */
const HEAD_NOT_SHOWN = hqRefusalWords({ code: "conflict", reason: "head_moved" });
/** What a verb says when its project's flow has not been read at all. */
const NOT_READ_YET = "This project has not been read yet.";
/** What a release says while the recipe has nothing on `main` to tag: HQ's own words for it. */
const NO_GROUP_MAIN = hqRefusalWords({ code: "conflict", reason: "no_group_main" });

/**
 * A verb whose call landed, waiting until its effect is read: a release, for the application's
 * releases to list it; a change merged or closed, for HQ's stream to no longer hold it open; a
 * deploy asked again, for HQ's stream to bring the job that answers it.
 */
interface HeldVerb {
  readonly groupId: string;
  readonly against:
    | { readonly kind: "release"; readonly tag: string }
    | { readonly kind: "change"; readonly repository: string; readonly number: number }
    | {
        readonly kind: "deploy";
        readonly projectId: string;
        readonly service: string;
        /** The service's newest job when it was asked: read once a newer one is there. */
        readonly after: string;
      };
}

/** Whether the held verb's effect is read, or HQ can no longer say it: nothing then holds it. */
function effectRead(held: HeldVerb, failed: boolean, flow: ZeropsProjectFlow | undefined): boolean {
  const { against } = held;
  if (failed) return true;
  if (against.kind === "release")
    return flow?.releases.some((entry) => entry.tag === against.tag) ?? false;
  if (against.kind === "deploy") {
    const latest = flow?.environmentInputs
      .find((entry) => entry.projectId === against.projectId)
      ?.services.find((service) => service.hostname === against.service)?.deploy?.latest;
    return latest === undefined || latest.id !== against.after;
  }
  return !(
    flow?.pullRequests.some(
      (pull) => pull.repository === against.repository && pull.number === against.number,
    ) ?? false
  );
}

/** One group's changes as its flow shows them: the open ones a push reached, and the landed. */
export interface GroupChanges {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
}

/** A group HQ holds no change of. */
const NO_CHANGES: GroupChanges = { pullRequests: [], merged: [] };

/**
 * Each application's changes as rows, by the identity of its changes as HQ last sent them, so an
 * application nothing came down for keeps its rows.
 */
const changeRows = new WeakMap<ReadonlyArray<HqChange>, Map<string, GroupChanges>>();

/** Every application's changes as its group's flow shows them, at HQ's official address. */
function groupChangesOf(
  changes: ReadonlyMap<string, ReadonlyArray<HqChange>>,
  hqAddress: string,
): ReadonlyMap<string, GroupChanges> {
  const byGroup = new Map<string, GroupChanges>();
  for (const [appId, list] of changes) {
    let byAddress = changeRows.get(list);
    if (byAddress === undefined) {
      byAddress = new Map();
      changeRows.set(list, byAddress);
    }
    let rows = byAddress.get(hqAddress);
    if (rows === undefined) {
      rows = flowChanges({ changes: list, hqAddress });
      byAddress.set(hqAddress, rows);
    }
    byGroup.set(appId, rows);
  }
  return byGroup;
}

/** What the flow says while HQ has never told it any change, and does not answer. */
export const HQ_CHANGES_UNANSWERED = "HQ is not answering right now.";

/** Each group's stops as last built, with the content they were built from. */
const builtStops = new Map<string, { readonly key: string; readonly stops: GroupStops }>();

/**
 * A group's stops: the same object for as long as what they are built from reads the same, so one
 * group's change never republishes another's flow.
 */
function groupStopsFor(groupId: string, input: Parameters<typeof groupStopsOf>[0]): GroupStops {
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
interface ReleaseLive {
  readonly moved: ComparedCommits;
  readonly untold: ReadonlyArray<string>;
  readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
}

/** What to ask HQ of a group's release, and what production runs, which it is asked from. */
interface ReleasePlan extends CompareReads {
  readonly running: ReadonlyMap<string, ProductionRun>;
}

/** What goes live while nothing has been asked of HQ: what production runs is not known yet. */
const NOT_COMPARED: MovedCommits = { state: "reading" };
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
  /** Each group's changes, by its id; `null` while HQ has told nothing of them. */
  readonly changes: ReadonlyMap<string, GroupChanges> | null;
  /** Why HQ has told nothing of them, while it does not answer. */
  readonly changesFailure: string | undefined;
  /** Why the grant withholds a project, by project id, for each project it withholds alone. */
  readonly withheld: ReadonlyMap<string, string>;
}): ReadonlyMap<string, ZeropsProjectFlow> {
  const flows = new Map<string, ZeropsProjectFlow>();
  for (const group of input.groups) {
    const stops = input.stops.get(group.groupId);
    const records = input.releases.get(group.groupId);
    const changes =
      input.changes === null ? undefined : (input.changes.get(group.groupId) ?? NO_CHANGES);
    if (stops === undefined && records === undefined && changes === undefined) continue;
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
    const key = JSON.stringify([
      group.groupId,
      deploy.inFlight ?? null,
      deploy.stalled ?? null,
      changes === undefined ? (input.changesFailure ?? null) : null,
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
        { stops, records, changes, changesFailure: input.changesFailure },
        { repos, recipe, permission, live },
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
  },
  /** The newest release on its way to production, or stalled there (`releaseInFlight`, `releaseStalled`). */
  deploy: { readonly inFlight: string | undefined; readonly stalled: string | undefined },
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { stops, records, changes } = halves;
  const environmentInputs = stops?.environments ?? [];
  // A production the grant withholds shows nothing it runs (DESIGN §3.4), so
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
  const offer = releaseOffer({
    permission: read === undefined ? undefined : permission,
    candidate: read === undefined ? NOTHING_TO_LIST : read.candidate,
    production: sides.production,
    inFlight: deploy.inFlight,
    tags: releaseList.map(({ tag }) => tag),
    live: live.moved,
    hasProduction,
  });
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
            comparisonFailure: live.moved.state === "failed" ? live.moved : undefined,
            permission,
            groupHead: read?.groupHead,
            ...deploy,
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

export function ZeropsProjectFlowProvider({ children }: { readonly children: ReactNode }) {
  const session = useZeropsSession();
  const inventory = useZeropsInventory();
  const organization = session.activeOrganization;
  const clientId = organization?.id;
  const signedInToMate = session.status === "signed-in";

  const registry = useZeropsRegistry();

  /**
   * Every group the registry knows, with the projects the account tags into
   * it and their runtime services — the account's half of every row. Read from
   * the inventory as held: a project the grant withholds is still in its group
   * (DESIGN M7), and its stop renders withheld where it is drawn.
   */
  const held = useContext(HeldInventoryContext);
  const heldProjectIds = useMemo(
    () => (held === null ? [] : held.projects.map(({ id }) => id)),
    [held],
  );
  const heldServices = useProjectsServices(heldProjectIds);
  const groupProjects = useMemo(
    () =>
      new Map(
        registry.registry.groups.map((entry) => [
          entry.groupId,
          (held === null ? [] : held.projects)
            .filter((project) => readZeropsMembership(project).groupId === entry.groupId)
            .map((project): GroupStopProject => {
              const services = heldServices[project.id]?.services;
              const { role } = readZeropsMembership(project);
              return {
                projectId: project.id,
                name: projectNameInApp(project),
                ...(role === undefined ? {} : { role }),
                services:
                  services === undefined
                    ? []
                    : summarizeEnvironmentServices(services).deployable.map(
                        ({ serviceId, hostname }) => ({ serviceId, hostname }),
                      ),
              };
            }),
        ]),
      ),
    [held, heldServices, registry.registry.groups],
  );
  // What each group service runs, as the account's stops state it, read live.
  const statedServices = useMemo(
    () =>
      [...groupProjects.values()].flat().flatMap((project) => {
        // The inventory keys each ref by its project key, never by the bare id (F10).
        const ref = findInventoryProjectRef(
          { projectRefs: inventory.projectRefs },
          project.projectId,
        );
        if (ref === null) return [];
        return project.services.map((service): ServiceRef => ({
          kind: "service",
          project: ref,
          serviceId: ZeropsServiceId.make(service.serviceId),
        }));
      }),
    [groupProjects, inventory.projectRefs],
  );
  const stated = useStatedVersions(statedServices);
  const flowGroups = useMemo(
    () => registry.registry.groups.map(({ groupId }) => ({ groupId })),
    [registry.registry.groups],
  );

  const hqStructure = useAtomValue(hqNavigationAtom);
  const hqChanges = useAtomValue(hqChangesAtom);
  const recipes = useZeropsAppRecipes();

  // Each group's stops, from HQ's environments and the account's half.
  const heldEnvironments = useAtomValue(hqEnvironmentsAtom);
  const groupStops = useMemo(() => {
    const built = new Map<string, GroupStops>();
    if (heldEnvironments === null) return built;
    for (const [groupId, projects] of groupProjects) {
      const environments = heldEnvironments.get(groupId);
      if (environments === undefined) continue;
      const statedHere = new Map(
        projects.flatMap(({ services }) =>
          services.flatMap(({ serviceId }) => {
            const version = stated.get(serviceId);
            return version === undefined ? [] : [[serviceId, version] as const];
          }),
        ),
      );
      built.set(
        groupId,
        groupStopsFor(groupId, {
          environments,
          projects,
          versions: statedVersionNames(statedHere),
          activeVersions: statedActiveVersions(statedHere),
          recipe: recipes.get(groupId),
        }),
      );
    }
    return built;
  }, [groupProjects, heldEnvironments, recipes, stated]);

  const detailProjects = useDetailProjects();
  /** Detail owns its demand; visible production/stage chips hold their own leases. Observe all refs. */
  const stops = useMemo(() => {
    const inactive = new Set(
      inventory.projects.filter(({ status }) => status !== "ACTIVE").map(({ id }) => id),
    );
    return [...inventory.projectRefs.values()].flatMap((ref) => {
      const authority = inventory.authority.get(inventoryProjectRefKey(ref));
      const refused = authority?.kind === "withheld" && authority.reason === "access-denied";
      return refused || inactive.has(ref.projectId) || !detailProjects.has(ref.projectId)
        ? []
        : [ref];
    });
  }, [detailProjects, inventory.authority, inventory.projectRefs, inventory.projects]);
  const stopDeployments = useStopDeployments([...inventory.projectRefs.values()], stops);
  // A project the grant withholds shows its stop withheld, at this read (DESIGN §4.2 G12), demanded
  // or not.
  const deployments = useMemo<ReadonlyMap<string, Shown<Deployment>>>(
    () =>
      new Map(
        [...inventory.projectRefs.values()].flatMap(({ projectId }) => {
          const authority = projectAuthority(inventory, projectId);
          if (authority.kind === "withheld") {
            return [
              [
                projectId,
                { state: "withheld", reason: authority.reason, cause: authority.cause },
              ] as const,
            ];
          }
          const deployment = stopDeployments.get(projectId);
          return deployment === undefined ? [] : [[projectId, deployment] as const];
        }),
      ),
    [inventory, stopDeployments],
  );

  const [trouble, setTrouble] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const {
    releases: releaseRecords,
    repos: appRepos,
    failures: releaseFailures,
  } = useZeropsAppReleases();

  /**
   * Why the grant withholds each project it withholds alone; a lapse withholds every flow below
   * instead (DESIGN §3.4).
   */
  const withheld = useMemo(
    () =>
      new Map(
        [...inventory.projectRefs.values()].flatMap(({ projectId }) => {
          const notice = withheldProjectNotice(inventory, projectId);
          return notice === null ? [] : [[projectId, notice] as const];
        }),
      ),
    [inventory],
  );

  // A Mate's changes, down the organization's HQ stream, linked at its official address: the
  // flows stand on them wherever HQ answers.
  const accountHq = useAccountHq(clientId);
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;
  const hqApi = useMemo(
    () =>
      accountHq.hq.kind === "official" && clientId !== undefined
        ? accountHqApi(session.client, clientId, accountHq.hq)
        : null,
    [accountHq.hq, clientId, session.client],
  );
  const changes = useMemo(
    () =>
      hqChanges === null || hqAddress === undefined ? null : groupChangesOf(hqChanges, hqAddress),
    [hqAddress, hqChanges],
  );
  const changesFailure = hqDown(hqStructure) ? HQ_CHANGES_UNANSWERED : undefined;
  // HQ's rule for this person releasing each group, in its words.
  const releasePermissionOf = useReleasePermission();
  const permissions = useMemo(
    () => new Map(flowGroups.map(({ groupId }) => [groupId, releasePermissionOf(groupId)])),
    [flowGroups, releasePermissionOf],
  );
  // What a release of each group would put live: what HQ compares from what production runs to each
  // runtime's `main` (`releaseReads`) — asked only once the store has stated what each production
  // service runs, as a version not read yet would read as running nothing.
  const releasePlans = useMemo(() => {
    const plans = new Map<string, ReleasePlan>();
    for (const { groupId } of flowGroups) {
      const recipe = recipes.get(groupId);
      const repos = appRepos.get(groupId);
      const records = releaseRecords.get(groupId);
      const production = groupStops
        .get(groupId)
        ?.environments.find((entry) => entry.tier === "production");
      if (recipe === undefined || repos === undefined || records === undefined) continue;
      // Nothing is compared for an application with no production: there is nothing to release to.
      if (production === undefined) continue;
      const productionId = ZeropsProjectId.make(production.projectId);
      if (withheld.has(productionId)) continue;
      const listed = heldServices[productionId]?.services !== undefined;
      const running = productionRuns({
        services: listed
          ? groupProjects.get(groupId)?.find(({ projectId }) => projectId === production.projectId)
              ?.services
          : undefined,
        stated,
        named: [
          ...recipe.productionRepositories.keys(),
          ...production.services.map(({ hostname }) => hostname),
        ],
        deploys: new Map(
          production.services.flatMap(({ hostname, deploy }) =>
            deploy === undefined ? [] : [[hostname, deploy] as const],
          ),
        ),
        releases: records.map(flowReleaseOf),
      });
      if (running === undefined) continue;
      const { productionRepositories } = recipe;
      plans.set(groupId, {
        ...releaseReads({
          productionRepositories,
          candidate: releaseCandidate({ productionRepositories, repos }).candidate,
          running,
        }),
        running,
      });
    }
    return plans;
  }, [
    appRepos,
    flowGroups,
    groupProjects,
    groupStops,
    heldServices,
    recipes,
    releaseRecords,
    stated,
    withheld,
  ]);
  const compareAsks = useMemo(
    () => new Map([...releasePlans].map(([groupId, plan]) => [groupId, plan.reads])),
    [releasePlans],
  );
  const compares = useZeropsCompares(compareAsks);
  const live = useMemo(
    () =>
      new Map(
        [...releasePlans].map(([groupId, plan]) => {
          const answered = compares.get(groupId);
          return [
            groupId,
            {
              moved:
                answered === undefined
                  ? NOT_COMPARED
                  : {
                      ...movedCommits({ reads: plan.reads, ...answered }),
                      again: () => answered.again(plan.reads),
                    },
              untold: plan.untold,
              runs: plan.running,
            },
          ];
        }),
      ),
    [compares, releasePlans],
  );
  const flows = useMemo<ReadonlyMap<string, ZeropsProjectFlow>>(
    () =>
      signedInToMate
        ? joinProjectFlows({
            groups: flowGroups,
            stops: groupStops,
            releases: releaseRecords,
            repos: appRepos,
            recipes,
            permissions,
            live,
            changes,
            changesFailure,
            withheld,
          })
        : EMPTY_FLOWS,
    [
      appRepos,
      changes,
      changesFailure,
      flowGroups,
      groupStops,
      live,
      permissions,
      recipes,
      releaseRecords,
      signedInToMate,
      withheld,
    ],
  );

  // Time to the first pull request row, per group, for diagnostics.
  useEffect(() => {
    for (const flow of flows.values()) {
      if (flow.pullRequests.length > 0)
        mateDiagnostics.recordOnce({ kind: "flow-pr-row", groupId: flow.groupId });
    }
  }, [flows]);

  /**
   * The verbs running now, by key. A second press before React draws the first as pending would
   * otherwise act twice — for a release, a second tag.
   */
  const running = useRef(new Set<string>());

  /**
   * Holds the verb's key in `pending` while it runs. Its effect arrives through HQ's stream;
   * how it went is `act`'s answer, and a verb already running answers that it is.
   */
  const run = useCallback(
    async (verb: FlowVerb, act: () => Promise<FlowVerbOutcome>): Promise<FlowVerbOutcome> => {
      const key = flowVerbKey(verb);
      if (running.current.has(key)) return refused(VERB_ALREADY_RUNNING);
      running.current.add(key);
      setPending((current) => new Set(current).add(key));
      try {
        return await act();
      } finally {
        running.current.delete(key);
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  /**
   * A verb whose call landed, by its key, with the effect it waits to read. The verb stays pending
   * until HQ's answer reads it, or HQ can no longer say it — the group's releases fail to read, or
   * HQ refuses its stream: until then a second press would do it twice — a second release, a second
   * deploy. A stream that blinks reconnects and brings the effect back; no clock lets it go. A
   * settled entry is dropped.
   */
  const [awaiting, setAwaiting] = useState<ReadonlyMap<string, HeldVerb>>(() => new Map());
  const hold = useCallback((verb: FlowVerb, groupId: string, against: HeldVerb["against"]) => {
    setAwaiting((current) => new Map(current).set(flowVerbKey(verb), { groupId, against }));
  }, []);

  const mateNames = useMemo(
    () => new Map(inventory.projects.map((project) => [project.id, projectNameInApp(project)])),
    [inventory.projects],
  );

  /** Says a refusal where the verbs are, and hands it back to the surface that pressed it. */
  const refuse = useCallback((reason: string): FlowVerbOutcome => {
    setTrouble(reason);
    return refused(reason);
  }, []);

  /**
   * A release made in HQ as the person, of exactly what its offer shows: its entries and chosen
   * name (the next patch by default), tagging the recipe's `main` it was read with — HQ refuses
   * one that moved since and checks the name against every release under its lock.
   * Held until the application's releases list it; HQ's refusal is said in its words.
   */
  const release = useCallback(
    async (groupId: string, tag?: string): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return refused(HQ_NOT_OPEN);
      const offer = flows.get(groupId)?.release;
      if (offer === undefined) return refused(NOT_READ_YET);
      if (!offer.gate.allowed) return refused(offer.gate.reason);
      const { groupHead } = offer;
      if (groupHead === undefined) return refuse(NO_GROUP_MAIN);
      const verb: FlowVerb = { kind: "release", groupId };
      return run(verb, async () => {
        try {
          const { made, deploys } = await hqApi.release(groupId, {
            tag: tag ?? offer.suggestion,
            groupHead,
            entries: offer.entries.map(({ service, commit }) => ({ service, sha: commit })),
          });
          setTrouble(null);
          hold(verb, groupId, { kind: "release", tag: made.tag });
          return { ok: true, tag: made.tag, deploys };
        } catch (cause) {
          return refuse(zeropsErrorMessage(cause));
        }
      });
    },
    [flows, hold, hqApi, refuse, run],
  );

  /**
   * Production back to an earlier release, in HQ as the person: a new release of its entries,
   * tagging the recipe's `main` as last read — HQ refuses one that moved since. Held until the
   * application's releases list it; HQ's refusal is said in its words.
   */
  const rollBack = useCallback(
    async (groupId: string, earlier: string): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return refused(HQ_NOT_OPEN);
      const verb: FlowVerb = { kind: "roll-back", groupId, tag: earlier };
      return run(verb, async () => {
        const groupHead = appRepos
          .get(groupId)
          ?.find((repo) => repo.name === RECIPE_REPO)?.mainHead;
        if (groupHead == null) return refuse(NO_GROUP_MAIN);
        try {
          const { made, deploys } = await hqApi.rollback(groupId, earlier, { groupHead });
          setTrouble(null);
          hold(verb, groupId, { kind: "release", tag: made.tag });
          return { ok: true, tag: made.tag, deploys };
        } catch (cause) {
          return refuse(zeropsErrorMessage(cause));
        }
      });
    },
    [appRepos, hold, hqApi, refuse, run],
  );

  /**
   * A change merged or closed in HQ, as the person: held until HQ's stream no longer holds it open,
   * nothing read again; HQ's refusal is handed back in its words to the review that pressed it, and
   * a merge's deploys as HQ answered them.
   */
  const changeVerb = useCallback(
    async (
      verb: ChangeVerb,
      act: (api: HqApi, link: ChangeLink) => Promise<HqDeployAnswer | undefined>,
    ): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return refused(HQ_NOT_OPEN);
      const link = { appId: verb.groupId, repo: verb.repository, number: verb.number };
      return run(verb, async () => {
        let deploys: HqDeployAnswer | undefined;
        try {
          deploys = await act(hqApi, link);
        } catch (cause) {
          return refused(zeropsErrorMessage(cause));
        }
        hold(verb, verb.groupId, {
          kind: "change",
          repository: verb.repository,
          number: verb.number,
        });
        return { ok: true, deploys };
      });
    },
    [hold, hqApi, run],
  );

  const merge = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
      expectedHead: string | undefined,
    ): Promise<FlowVerbOutcome> => {
      // Only the head whose change was shown: one nobody saw is never merged, and HQ is not asked.
      if (expectedHead === undefined) return Promise.resolve(refused(HEAD_NOT_SHOWN));
      return changeVerb({ kind: "merge", groupId, ...change }, async (api, link) => {
        const { deploys } = await api.mergeChange(link, expectedHead);
        return deploys;
      });
    },
    [changeVerb],
  );

  const close = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
    ): Promise<FlowVerbOutcome> =>
      changeVerb({ kind: "close", groupId, ...change }, async (api, link) => {
        await api.closeChange(link);
        return undefined;
      }),
    [changeVerb],
  );

  const redeploy = useCallback(
    (
      groupId: string,
      projectId: string,
      deploy: { readonly service: string; readonly sha: string; readonly after: string },
    ): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return Promise.resolve(refused(HQ_NOT_OPEN));
      const environment = flows
        .get(groupId)
        ?.environmentInputs.find((entry) => entry.projectId === projectId)?.environment;
      if (environment === undefined) return Promise.resolve(refused(NOT_READ_YET));
      const verb: FlowVerb = { kind: "redeploy", groupId, projectId, service: deploy.service };
      return run(verb, async () => {
        let deploys: HqDeployAnswer;
        try {
          deploys = await hqApi.redeploy(groupId, environment, {
            service: deploy.service,
            sha: deploy.sha,
          });
        } catch (cause) {
          return refused(zeropsErrorMessage(cause));
        }
        hold(verb, groupId, {
          kind: "deploy",
          projectId,
          service: deploy.service,
          after: deploy.after,
        });
        return { ok: true, deploys };
      });
    },
    [flows, hold, hqApi, run],
  );

  const addService = useCallback(
    (groupId: string, projectId: string, service: string): Promise<FlowVerbOutcome> => {
      if (hqApi === null) return Promise.resolve(refused(HQ_NOT_OPEN));
      const environment = flows
        .get(groupId)
        ?.environmentInputs.find((entry) => entry.projectId === projectId)?.environment;
      if (environment === undefined) return Promise.resolve(refused(NOT_READ_YET));
      const verb: FlowVerb = { kind: "add-service", groupId, projectId, service };
      return run(verb, async () => {
        try {
          return { ok: true, deploys: await hqApi.addService(groupId, environment, service) };
        } catch (cause) {
          return refused(zeropsErrorMessage(cause));
        }
      });
    },
    [flows, hqApi, run],
  );

  // While the account's access lapses, the groups the registry names and what was read of them
  // are withheld with every project (§3.1); the reads themselves are kept for the next grant.
  const lapsed = inventory.account.kind === "withheld";
  // A held verb waits for its effect in the group's flow, or for its streamed release read to
  // fail or HQ to refuse its stream — not reconnecting it: the wait then has nothing left to hold.
  const streamRefused = hqStructure.refusal !== null;
  const settled = useMemo(
    () =>
      [...awaiting].filter(([, entry]) =>
        effectRead(
          entry,
          releaseFailures.has(entry.groupId) || streamRefused,
          flows.get(entry.groupId),
        ),
      ),
    [awaiting, flows, releaseFailures, streamRefused],
  );
  useEffect(() => {
    if (settled.length === 0) return;
    setAwaiting((current) => {
      const next = new Map(current);
      for (const [key, entry] of settled) if (next.get(key) === entry) next.delete(key);
      return next;
    });
  }, [settled]);
  const pendingOrHeld = useMemo<ReadonlySet<string>>(() => {
    const waiting = [...awaiting.keys()].filter((key) => !settled.some(([done]) => done === key));
    return waiting.length === 0 ? pending : new Set([...pending, ...waiting]);
  }, [awaiting, pending, settled]);
  const value = useMemo<ZeropsProjectFlowValue>(
    () => ({
      hqAddress,
      readFailure:
        changesFailure ??
        (accountHq.status === "failed"
          ? "The organization's HQ could not be read."
          : accountHq.status === "ready" && accountHq.hq.kind !== "official"
            ? "This organization has no HQ."
            : lapsed
              ? "Project access is being checked."
              : undefined),
      groupsRead: hqStructure.live && !registry.loading,
      knownGroups: new Set(registry.registry.groups.map(({ groupId }) => groupId)),
      flows: lapsed ? EMPTY_FLOWS : flows,
      releaseFailures: lapsed ? NO_FAILURES : releaseFailures,
      deployments,
      mateNames,
      pending: pendingOrHeld,
      trouble,
      release,
      rollBack,
      merge,
      close,
      redeploy,
      addService,
    }),
    [
      addService,
      close,
      deployments,
      flows,
      hqAddress,
      lapsed,
      registry,
      changesFailure,
      accountHq.hq.kind,
      accountHq.status,
      hqStructure,
      mateNames,
      merge,
      pendingOrHeld,
      redeploy,
      release,
      releaseFailures,
      rollBack,
      trouble,
    ],
  );

  return (
    <ZeropsProjectFlowContext.Provider value={value}>{children}</ZeropsProjectFlowContext.Provider>
  );
}
