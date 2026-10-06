/**
 * An application's flow — its environments, what is waiting, what was released — as each surface
 * that draws it reads it (`projectFlowJoin.ts`): read for the applications the surface draws, held
 * while it draws them, from the account's store and, in transit, the account's inventory. The
 * verbs that move a flow are the account's operations (`flowVerbs.ts`).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  appsEnvironments,
  shownHqAppChangesAtom,
  type AppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import {
  flowReleaseOf,
  movedCommits,
  productionRuns,
  projectNameInApp,
  readZeropsMembership,
  releaseCandidate,
  releaseReads,
  statedActiveVersions,
  statedVersionNames,
  summarizeEnvironmentServices,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupEnvironment,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentTier,
  type GroupStopProject,
  type GroupStops,
  type Moved,
  type ProductionRun,
  type ReleaseComparison,
  type ReleaseEntry,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import {
  ZeropsProjectId,
  ZeropsServiceId,
  type ServiceRef,
} from "@t3tools/client-runtime/zerops/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { Atom } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo } from "react";

import { hqDown, hqNavigationAtom } from "../state/zerops";
import { useDetailProjects } from "./accountEnvironments";
import { useStatedVersions, useStopDeployments } from "./accountForge";
import { useAccountHq } from "./accountHq";
import {
  findInventoryProjectRef,
  HeldInventoryContext,
  InventoryContext,
  inventoryProjectRefKey,
  type Inventory,
  projectAuthority,
  useZeropsInventory,
  withheldProjectNotice,
} from "./inventoryContext";
import {
  groupChangesOf,
  groupStopsFor,
  HQ_CHANGES_UNANSWERED,
  joinProjectFlows,
  NOT_COMPARED,
  type GroupChanges,
  type ReleaseLive,
  type ReleasePlan,
} from "./projectFlowJoin";
import { releaseGateOf, useOfferReading } from "./appOffers";
import { useHqAppDetailHold, useHqAppRecipes, useHqAppReleases } from "./useHqAppDetail";
import { useReleaseComparisons } from "./useReleaseComparisons";
import { useProjectsServices } from "./ZeropsAccountData";
import { useZeropsSession, useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** What *Release* offers on a project, when it is offered at all. */
export interface ZeropsReleaseOffer {
  readonly comparisonFailure?:
    | { readonly reason: string; readonly again?: (() => void) | undefined }
    | undefined;
  readonly gate: ReleaseGate;
  /**
   * HQ's offer to this person (`can`'s `release`), its refusal in words; `undefined` while HQ
   * has not said. HQ asks it again at the press.
   */
  readonly permission: ReleaseGate | undefined;
  /** The recipe's `main` as read with the offer: what the release tags; HQ refuses one that moved. */
  readonly groupHead: string | undefined;
  /** The next patch, suggested from the newest existing tag. */
  readonly suggestion: string;
  readonly comparison: ReadonlyArray<ReleaseComparison>;
  /** What the tag would list — what the verb tags, so it matches what was shown. */
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /** The release tag on its way to production (`releaseInFlight`); Release waits for it. */
  readonly inFlight: string | undefined;
  /** The newest release, once HQ ended its deploy with some of it not live (`releaseStalled`). */
  readonly stalled: string | undefined;
  /**
   * What pressing it would put live, per repository HQ compared (`movedCommits`): the commits
   * `main` has that its services do not run. With squash merges each is one task delivered.
   * Nothing until all of it is known — the gate holds Release until then.
   */
  readonly contents: ReadonlyArray<Moved>;
  /** Production's services whose commit cannot be told: what goes live on them is not said. */
  readonly untold: ReadonlyArray<string>;
  /**
   * What each production service runs (`productionRuns`), whole; `undefined` until it is known. A
   * roll back compares from it what leaves production and what comes back.
   */
  readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
  /** The repository each production runtime builds from (the recipe's); `undefined` until read. */
  readonly repositories: ReadonlyMap<string, string> | undefined;
}

/** One project's flow: its environments, what is waiting, what was released. */
export interface ZeropsProjectFlow {
  readonly groupId: string;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /**
   * Whether HQ has told the project's environments: until then `declarations` is empty for want of
   * an answer, not because the project has none.
   */
  readonly declarationsRead: boolean;
  /** Stages first, then the production — the order code travels. */
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
  /** The tiers the recipe on `main` holds; empty until it is read (`recipeRead`). */
  readonly recipeTiers: ReadonlyArray<GroupEnvironmentTier>;
  /** Whether the recipe on `main` is read: until it is, `recipeTiers` is empty for want of an answer. */
  readonly recipeRead: boolean;
  /** Every open change a push reached on the project's repositories, as HQ's stream says. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /**
   * Whether HQ's stream has told the project's changes: until then
   * `pullRequests` is empty for want of an answer, not of a change, and the
   * left menu draws no change row. Once told, they stand through a stream
   * that goes quiet.
   */
  readonly changesKnown: boolean;
  /**
   * Why its changes were never told: HQ not answering while none are held. `undefined` once
   * they are, or while HQ answers.
   */
  readonly changesFailure?: string | undefined;
  /** The changes that have landed — what a conversation's timeline places. */
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /**
   * Whether HQ has answered the application's releases: until then `releases` is empty for want
   * of an answer, and production's chip says only what the platform says.
   */
  readonly releasesKnown: boolean;
  /**
   * The application's repositories with their `main`, as HQ last listed them; `undefined` until it
   * answered. What a history and a release read from.
   */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly release: ZeropsReleaseOffer;
}

/**
 * Applications' flows as the surfaces that draw them read them, with what the account says around
 * them. One surface's flows are read for the applications it draws, and each application's detail
 * is held only while one is drawn.
 */
export interface ProjectFlows {
  /**
   * The organization's official HQ, whose addresses name a Mate's changes; `undefined` until its
   * anchor is resolved, and nothing is read as one of its changes until then.
   */
  readonly hqAddress: string | undefined;
  readonly readFailure: string | undefined;
  /** Whether HQ's navigation has said the organization's applications. */
  readonly groupsRead: boolean;
  readonly knownGroups: ReadonlySet<string>;
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  /**
   * Why HQ's last read of an application's releases and repositories did not answer, by its id;
   * what was read before stands in its flow.
   */
  readonly releaseFailures: ReadonlyMap<string, string>;
}

const EMPTY_FLOWS: ReadonlyMap<string, ZeropsProjectFlow> = new Map();
const NO_ENVIRONMENTS: Readonly<Record<string, AppEnvironmentsRead>> = {};
const NO_ENVIRONMENTS_ATOM = Atom.make(NO_ENVIRONMENTS);
const NO_APPS: ReadonlyArray<string> = [];

/** The applications a surface draws: those named, or every one HQ's navigation lists. */
export type FlowApps = ReadonlyArray<string> | "every";

/** The organization's official HQ's address, once its anchor is resolved. */
export function useHqAddress(): string | undefined {
  const session = useZeropsSessionOptional();
  const { hq } = useAccountHq(session?.activeOrganization?.id);
  return hq.kind === "official" ? hq.address : undefined;
}

/** Every Mate's name by its project, for a surface that meets a bot login (`mate-{projectId}`). */
export function useMateNames(): ReadonlyMap<string, string> {
  const inventory = useZeropsInventory();
  return useMemo(
    () => new Map(inventory.projects.map((project) => [project.id, projectNameInApp(project)])),
    [inventory.projects],
  );
}

/** Every application HQ's navigation lists for the organization in view. */
export function useEveryAppId(): ReadonlyArray<string> {
  const apps = useAtomValue(hqNavigationAtom).structure?.apps;
  return useMemo(
    () => (apps === undefined || apps.length === 0 ? NO_APPS : apps.map(({ id }) => id)),
    [apps],
  );
}

/** The named applications' stage and production as HQ's navigation says them, by id. */
export function useAppsEnvironments(
  appIds: ReadonlyArray<string>,
): Readonly<Record<string, AppEnvironmentsRead>> {
  // The account's reads as mounted: what every surface over HQ's navigation reads through.
  const account = useAtomValue(accountReadsAtom);
  return useAtomValue(
    account === null || account.orgId === null || appIds.length === 0
      ? NO_ENVIRONMENTS_ATOM
      : account.data.project(appsEnvironments, { orgId: account.orgId, appIds }),
  );
}

/** What a surface over applications' changes reads: their rows, at HQ's official address. */
export interface AppsChanges {
  readonly hqAddress: string | undefined;
  /** Each application's changes once HQ told them; one not told yet is absent. */
  readonly changes: ReadonlyMap<string, GroupChanges>;
}

const NO_CHANGES: ReadonlyMap<string, GroupChanges> = new Map();
const NO_REFUSALS: ReadonlyMap<string, string> = new Map();

/** The named applications' open changes as HQ's navigation lists them, by id. */
function useOpenChanges(appIds: ReadonlyArray<string>) {
  const every = useAtomValue(shownHqAppChangesAtom);
  return useMemo(
    () =>
      Object.fromEntries(
        appIds.flatMap((appId) => (appId in every ? [[appId, every[appId]!]] : [])),
      ),
    [appIds, every],
  );
}

/**
 * The named applications' changes as rows, at HQ's official address: the open ones from HQ's
 * navigation with what a held detail adds, and HQ's refusal of them to this person, apart.
 */
function useChangeRows(appIds: ReadonlyArray<string>, hqAddress: string | undefined) {
  const open = useOpenChanges(appIds);
  const { changes: detail } = useHqAppReleases(appIds);
  return useMemo(
    () =>
      hqAddress === undefined
        ? { rows: NO_CHANGES, refused: NO_REFUSALS }
        : groupChangesOf(open, detail, hqAddress),
    [detail, hqAddress, open],
  );
}

/**
 * The changes of the applications a surface draws — the open ones HQ's navigation lists, and the
 * landed ones a held detail adds. Nothing is linked as one of HQ's changes until its official
 * address is known.
 */
export function useAppsChanges(appIds: ReadonlyArray<string>): AppsChanges {
  const hqAddress = useHqAddress();
  const { rows } = useChangeRows(appIds, hqAddress);
  return useMemo(() => ({ hqAddress, changes: rows }), [hqAddress, rows]);
}

const NO_INVENTORY = {
  projects: [],
  projectRefs: new Map(),
  authority: new Map(),
} as unknown as Inventory;

/**
 * What each Zerops project's stop runs, by project id — the platform's answer, read for the
 * projects a detail holds; a project the grant withholds says so, at this read.
 * Only the projects named, where a surface names them. A project missing here is unread.
 */
export function useStopDeploymentsShown(
  projectIds?: ReadonlyArray<string>,
): ReadonlyMap<string, Shown<Deployment>> {
  const inventory = useContext(InventoryContext) ?? NO_INVENTORY;
  const detailProjects = useDetailProjects();
  const named = projectIds === undefined ? null : projectIds.join("\n");
  const refs = useMemo(
    () =>
      [...inventory.projectRefs.values()].filter(
        ({ projectId }) => named === null || named.split("\n").includes(projectId),
      ),
    [inventory.projectRefs, named],
  );
  const stops = useMemo(() => {
    const inactive = new Set(
      inventory.projects.filter(({ status }) => status !== "ACTIVE").map(({ id }) => id),
    );
    return refs.flatMap((ref) => {
      const authority = inventory.authority.get(inventoryProjectRefKey(ref));
      const refused = authority?.kind === "withheld" && authority.reason === "access-denied";
      return refused || inactive.has(ref.projectId) || !detailProjects.has(ref.projectId)
        ? []
        : [ref];
    });
  }, [detailProjects, inventory.authority, inventory.projects, refs]);
  const stopDeployments = useStopDeployments(refs, stops);
  return useMemo<ReadonlyMap<string, Shown<Deployment>>>(
    () =>
      new Map(
        refs.flatMap(({ projectId }) => {
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
    [inventory, refs, stopDeployments],
  );
}

/**
 * The flows of the applications a surface draws (`every` one, for a surface over the whole
 * organization), joined from what each party proves. Releases, repositories and recipes read
 * whatever detail the surface explicitly holds; navigation holds none. What a release
 * would put live is compared only for a surface that shows it (`compare`), and only while it is
 * drawn; elsewhere the offer stays unasked.
 */
export function useProjectFlows(
  apps: FlowApps,
  options: { readonly compare?: boolean } = {},
): ProjectFlows {
  const compare = options.compare === true;
  const session = useZeropsSession();
  const inventory = useZeropsInventory();
  const clientId = session.activeOrganization?.id;
  const signedInToMate = session.status === "signed-in";

  // The organization's applications as HQ's navigation lists them; none before it said them.
  const hqStructure = useAtomValue(hqNavigationAtom);
  const told = hqStructure.orgId === clientId ? hqStructure.structure?.apps : undefined;
  const appKey = apps === "every" ? null : apps.join("\n");
  const flowGroups = useMemo(
    () =>
      (told ?? [])
        .filter(({ id }) => appKey === null || appKey.split("\n").includes(id))
        .map(({ id }) => ({ groupId: id })),
    [appKey, told],
  );
  const appIds = useMemo(
    () => (flowGroups.length === 0 ? NO_APPS : flowGroups.map(({ groupId }) => groupId)),
    [flowGroups],
  );

  /**
   * Each drawn group, with the projects the account tags into it and their runtime services — the
   * account's half of every row. Read from the inventory as held: a project the grant withholds is
   * still in its group, and its stop renders withheld where it is drawn.
   */
  const held = useContext(HeldInventoryContext);
  const heldProjects = useMemo(
    () =>
      (held === null ? [] : held.projects).filter((project) => {
        const { groupId } = readZeropsMembership(project);
        return groupId !== undefined && appIds.includes(groupId);
      }),
    [appIds, held],
  );
  const heldServices = useProjectsServices(
    useMemo(() => heldProjects.map(({ id }) => id), [heldProjects]),
  );
  const groupProjects = useMemo(
    () =>
      new Map(
        appIds.map((groupId) => [
          groupId,
          heldProjects
            .filter((project) => readZeropsMembership(project).groupId === groupId)
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
    [appIds, heldProjects, heldServices],
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

  // Comparing a release is detail demand; navigation only reads already held detail.
  useHqAppDetailHold(compare ? appIds : NO_APPS);
  const recipes = useHqAppRecipes(appIds);
  // Each group's stage and production, as HQ's navigation says them.
  const environments = useAppsEnvironments(appIds);

  // Each group's stops, from HQ's environments and the account's half.
  const groupStops = useMemo(() => {
    const built = new Map<string, GroupStops>();
    for (const [groupId, projects] of groupProjects) {
      const told = environments[groupId]?.environments;
      if (told === undefined) continue;
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
          environments: told,
          projects,
          versions: statedVersionNames(statedHere),
          activeVersions: statedActiveVersions(statedHere),
          recipe: recipes.get(groupId),
        }),
      );
    }
    return built;
  }, [environments, groupProjects, recipes, stated]);

  const {
    releases: releaseRecords,
    repos: appRepos,
    failures: releaseFailures,
  } = useHqAppReleases(appIds);

  /** Why the grant withholds each project it withholds alone: hidden per project at the read. */
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

  // A Mate's changes, linked at the organization's official address: the flows stand on them
  // wherever HQ answers.
  const accountHq = useAccountHq(clientId);
  const hqAddress = accountHq.hq.kind === "official" ? accountHq.hq.address : undefined;
  const shownChanges = useChangeRows(appIds, hqAddress);
  const changes = hqAddress === undefined ? null : shownChanges.rows;
  const changesRefused = shownChanges.refused;
  const changesFailure = hqDown(hqStructure) ? HQ_CHANGES_UNANSWERED : undefined;
  // HQ's rule for this person releasing each group, in its words.
  const offers = useOfferReading();
  const permissions = useMemo(
    () =>
      new Map(
        appIds.map((groupId) => [
          groupId,
          releaseGateOf(offers, told?.find(({ id }) => id === groupId)?.can),
        ]),
      ),
    [appIds, told, offers],
  );
  // What a release of each group would put live: what HQ compares from what production runs to each
  // runtime's `main` (`releaseReads`) — asked only for a surface that shows it, and only once the
  // store has stated what each production service runs, as a version not read yet would read as
  // running nothing.
  const releasePlans = useMemo(() => {
    const plans = new Map<string, ReleasePlan>();
    if (!compare) return plans;
    for (const groupId of appIds) {
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
    appIds,
    appRepos,
    compare,
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
  const compares = useReleaseComparisons(compareAsks);
  const live = useMemo(
    () =>
      new Map(
        [...releasePlans].map(([groupId, plan]): [string, ReleaseLive] => {
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
            changesRefused,
            withheld,
          })
        : EMPTY_FLOWS,
    [
      appRepos,
      changes,
      changesFailure,
      changesRefused,
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

  const knownGroups = useMemo(() => new Set((told ?? []).map(({ id }) => id)), [told]);
  return useMemo<ProjectFlows>(
    () => ({
      hqAddress,
      readFailure:
        changesFailure ??
        (accountHq.status === "failed"
          ? "The organization's HQ could not be read."
          : accountHq.status === "ready" && accountHq.hq.kind !== "official"
            ? "This organization has no HQ."
            : undefined),
      groupsRead: hqStructure.live && told !== undefined,
      knownGroups,
      flows,
      releaseFailures,
    }),
    [
      accountHq.hq.kind,
      accountHq.status,
      changesFailure,
      flows,
      hqAddress,
      hqStructure.live,
      knownGroups,
      told,
      releaseFailures,
    ],
  );
}
