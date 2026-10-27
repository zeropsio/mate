/**
 * An application's flow — its environments, what is waiting, what was released — as each surface
 * that draws it reads it (`projectFlowJoin.ts`): read for the applications the surface draws, held
 * while it draws them, from the account's store and, in transit, the account's inventory. The
 * verbs that move a flow are the account's operations (`flowVerbs.ts`).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  canonicalAppEnvironments,
  shownHqAppChangesAtom,
  type CanonicalAppEnvironmentsRead,
  canonicalProjectFlow,
  projectApplications,
} from "@t3tools/client-runtime/data";
import type { CanonicalHqEnvironment } from "@t3tools/client-runtime/zerops/hq";
import {
  flowReleaseOf,
  gitProductionRuns,
  movedCommits,
  productionRuns,
  projectNameInApp,
  readZeropsMembership,
  releaseCandidate,
  releaseReads,
  summarizeEnvironmentServices,
  type GroupStopProject,
} from "@t3tools/client-runtime/zerops";
import {
  ZeropsProjectId,
  ZeropsServiceId,
  type ServiceRef,
} from "@t3tools/client-runtime/zerops/data";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo } from "react";

import { hqNavigationAtom } from "../state/zerops";
import { useDetailProjects } from "./accountEnvironments";
import { useStatedVersions, useStopDeployments } from "./accountForge";
import { configuredHq } from "./accountHq";
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
  HQ_CHANGES_UNANSWERED,
  NOT_COMPARED,
  type GroupChanges,
  type ReleaseLive,
  type ReleasePlan,
} from "@t3tools/client-runtime/data";
import { releaseGateOf, useOfferReading } from "./appOffers";
import { useHqAppDetailHold, useHqAppRecipes, useHqAppReleases } from "./useHqAppDetail";
import { useReleaseComparisons } from "./useReleaseComparisons";
import { useProjection, useProjectsServices } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type {
  CanonicalProjectFlow as ZeropsProjectFlow,
  ZeropsReleaseOffer,
} from "@t3tools/client-runtime/data";
import type { CanonicalProjectFlow as ZeropsProjectFlow } from "@t3tools/client-runtime/data";

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
type RuntimeEnvironmentsRead = Omit<CanonicalAppEnvironmentsRead, "environments"> & {
  readonly environments: ReadonlyArray<CanonicalHqEnvironment> | undefined;
};
const NO_ENVIRONMENTS: Readonly<Record<string, RuntimeEnvironmentsRead>> = {};
const NO_ENVIRONMENTS_ATOM = Atom.make(NO_ENVIRONMENTS);
const NO_APPS: ReadonlyArray<string> = [];

/** The applications a surface draws: those named, or every one HQ's navigation lists. */
export type FlowApps = ReadonlyArray<string> | "every";

/** The address of the HQ this build names. */
export function useHqAddress(): string {
  return configuredHq().address;
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
): Readonly<Record<string, RuntimeEnvironmentsRead>> {
  // The account's reads as mounted: what every surface over HQ's navigation reads through.
  const account = useAtomValue(accountReadsAtom);
  const key = appIds.join("\n");
  const atom = useMemo(() => {
    const orgId = account?.orgId;
    if (account === null || orgId == null || key === "") return NO_ENVIRONMENTS_ATOM;
    return Atom.make((get) =>
      Object.fromEntries(
        key.split("\n").map((appId) => {
          const answer = get(account.data.project(canonicalAppEnvironments, { orgId, appId }));
          // Runtime consumers retain canonical identity while excluding Git push jobs.
          return [
            appId,
            {
              ...answer,
              environments: answer.environments?.filter(
                (environment): environment is CanonicalHqEnvironment =>
                  environment.target.kind === "zerops",
              ),
            },
          ];
        }),
      ),
    );
  }, [account, key]);
  return useAtomValue(atom);
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
const NO_FLOW_NAVIGATION = Atom.make({ ids: NO_APPS, read: false, unavailable: false });

/** Navigation status is shared with routes that must resolve a target before any project read. */
export function useFlowNavigation(orgId: string | null) {
  const navigation = useProjection(projectApplications, orgId, NO_FLOW_NAVIGATION);
  return useMemo(
    () => ({
      hqAddress: configuredHq().address,
      readFailure: navigation.unavailable ? HQ_CHANGES_UNANSWERED : undefined,
      groupsRead: navigation.read,
      knownGroups: new Set(navigation.ids),
    }),
    [navigation],
  );
}

export function useCompactProjectFlows(
  apps: FlowApps,
  reviews?: ReadonlyMap<
    string,
    NonNullable<Parameters<typeof canonicalProjectFlow.derive>[1]["review"]>
  >,
): ProjectFlows {
  const account = useAtomValue(accountReadsAtom);
  const session = useZeropsSession();
  const orgId = session.activeOrganization?.id;
  const navigation = useFlowNavigation(orgId ?? null);
  const hqAddress = navigation.hqAddress;
  const appKey = apps === "every" ? null : apps.join("\n");
  const atom = useMemo(
    () =>
      Atom.make((get): ProjectFlows => {
        if (
          account === null ||
          account.orgId == null ||
          account.orgId !== orgId ||
          session.status !== "signed-in"
        )
          return {
            hqAddress,
            readFailure: undefined,
            groupsRead: false,
            knownGroups: new Set(),
            flows: EMPTY_FLOWS,
            releaseFailures: new Map(),
          };
        const ids = navigation.knownGroups;
        const flows = new Map<string, ZeropsProjectFlow>();
        for (const appId of ids) {
          if (appKey !== null && !appKey.split("\n").includes(appId)) continue;
          const flow = get(
            account.data.project(canonicalProjectFlow, {
              orgId: account.orgId,
              appId,
              hqAddress,
              viewer: session.activeOrganization ?? undefined,
              review: reviews?.get(appId),
            }),
          );
          if (flow === undefined) continue;
          flows.set(appId, flow);
        }
        return {
          hqAddress,
          readFailure: navigation.readFailure,
          groupsRead: navigation.groupsRead,
          knownGroups: navigation.knownGroups,
          flows,
          releaseFailures: new Map(),
        };
      }),
    [
      account,
      orgId,
      session.status,
      session.activeOrganization,
      hqAddress,
      appKey,
      reviews,
      navigation,
    ],
  );
  return useAtomValue(atom);
}

export function useProjectFlows(
  apps: FlowApps,
  options: { readonly compare?: boolean; readonly plan?: boolean } = {},
): ProjectFlows {
  const compare = options.compare === true;
  // Planned, a release is read from what the store holds (what production runs, what it builds
  // from); compared, HQ is also asked what its commits move.
  const planned = compare || options.plan === true;
  const canonical = useCompactProjectFlows(apps);
  const session = useZeropsSession();
  const inventory = useZeropsInventory();
  const clientId = session.activeOrganization?.id;

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
  useHqAppDetailHold(planned ? appIds : NO_APPS);
  const recipes = useHqAppRecipes(appIds);
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
  const gitLive = useMemo(() => {
    const values = new Map<
      string,
      Omit<NonNullable<ZeropsProjectFlow["release"]["git"]>, "repositories">
    >();
    for (const appId of appIds) {
      const app = told?.find((entry) => entry.id === appId);
      const attachment = canonical.flows.get(appId)?.release.git?.attachment;
      if (attachment?.target.kind !== "git") continue;
      const flow = canonical.flows.get(appId);
      const replacement = offers.state(app?.can, "replace_remote_token");
      values.set(appId, {
        attachment: { ...attachment, target: attachment.target },
        delivery: flow?.release.git?.delivery,
        preflight: flow?.release.git?.preflight,
        replaceTokenPermission:
          replacement.kind === "allowed"
            ? { allowed: true }
            : {
                allowed: false,
                reason: offers.words(replacement) ?? "HQ has not offered token replacement.",
              },
      });
    }
    return values;
  }, [appIds, told, offers, canonical.flows]);

  // What a release of each group would put live: what HQ compares from what production runs to each
  // runtime's `main` (`releaseReads`) — asked only for a surface that shows it, and only once the
  // store has stated what each production service runs, as a version not read yet would read as
  // running nothing.
  const releasePlans = useMemo(() => {
    const plans = new Map<string, ReleasePlan>();
    if (!planned) return plans;
    for (const groupId of appIds) {
      const recipe = recipes.get(groupId);
      const repos = appRepos.get(groupId);
      const records = releaseRecords.get(groupId);
      const production = canonical.flows
        .get(groupId)
        ?.environmentInputs.find(
          (entry) => entry.tier === "production" && entry.target.kind === "zerops",
        );
      const git = gitLive.get(groupId);
      if (git !== undefined && repos !== undefined && records !== undefined) {
        const candidate = releaseCandidate({ target: git.attachment.target, repos }).candidate;
        const running = gitProductionRuns({
          repositories: candidate.keys(),
          lastPushed: git.delivery?.lastPushed,
        });
        if (running === undefined) continue;
        plans.set(groupId, {
          ...releaseReads({
            productionRepositories: new Map([...candidate.keys()].map((repo) => [repo, repo])),
            candidate,
            running,
          }),
          running,
        });
        continue;
      }
      if (recipe === undefined || repos === undefined || records === undefined) continue;
      // Nothing is compared for an application with no production: there is nothing to release to.
      if (production === undefined || production.target.kind !== "zerops") continue;
      const target = production.target;
      const productionId = ZeropsProjectId.make(target.projectId);
      if (withheld.has(productionId)) continue;
      const listed = heldServices[productionId]?.services !== undefined;
      const running = productionRuns({
        services: listed
          ? groupProjects.get(groupId)?.find(({ projectId }) => projectId === target.projectId)
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
    planned,
    groupProjects,
    canonical.flows,
    gitLive,
    heldServices,
    recipes,
    releaseRecords,
    stated,
    withheld,
  ]);
  const compareAsks = useMemo(
    () => new Map(compare ? [...releasePlans].map(([groupId, plan]) => [groupId, plan.reads]) : []),
    [compare, releasePlans],
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
              moved: !compare
                ? undefined
                : answered === undefined
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
    [compare, compares, releasePlans],
  );
  const reviews = useMemo(
    () =>
      planned
        ? new Map(
            appIds.map((id) => [
              id,
              {
                permission: permissions.get(id),
                live: {
                  ...(live.get(id) ?? {
                    moved: compare ? NOT_COMPARED : undefined,
                    untold: [],
                    runs: undefined,
                  }),
                  git: gitLive.get(id),
                },
              },
            ]),
          )
        : undefined,
    [appIds, compare, planned, permissions, live, gitLive],
  );
  const reviewed = useCompactProjectFlows(apps, reviews);
  const flows = reviewed.flows;

  // Time to the first pull request row, per group, for diagnostics.
  useEffect(() => {
    for (const flow of flows.values()) {
      if (flow.pullRequests.length > 0)
        mateDiagnostics.recordOnce({ kind: "flow-pr-row", groupId: flow.groupId });
    }
  }, [flows]);

  return useMemo<ProjectFlows>(
    () => ({ ...reviewed, releaseFailures }),
    [reviewed, releaseFailures],
  );
}
