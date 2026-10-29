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
  releaseRunBy,
  nameStopByRelease,
  releaseDeploys,
  releaseInFlight,
  releaseInFlightReason,
  releaseLanding,
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
  type ReleaseContentsSummary,
  type ReleaseComparison,
  type ReleaseEntry,
  type Moved,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  type FlowReleaseRow,
} from "../../zerops/index.ts";
import { hqRefusalWords, type UnreadEnvironment } from "../../zerops/hq/index.ts";
import type { HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { CanonicalHqNavigationApp, HqNavigationChange } from "@t3tools/shared/hqStream";
import { canonicalEnvironmentRow, type CanonicalEnvironmentRow } from "../../zerops/groupRows.ts";
import type { CanonicalGroupEnvironmentRowInput } from "../../zerops/groupDeploys.ts";
import type { Release, HqReleaseTarget } from "@t3tools/shared/hqRelease";
import type { GitReleaseReviewFacts } from "../../zerops/release.ts";

type ComparedCommits = MovedCommits & { readonly again?: (() => void) | undefined };

/** What *Release* offers on a project, when it is offered at all. */
export interface ZeropsReleaseOffer {
  readonly problems?: CanonicalHqNavigationApp["problems"] | undefined;
  readonly missingServices?: ReadonlyArray<string> | undefined;
  readonly releaseTarget?: HqReleaseTarget | undefined;
  readonly git?: GitReleaseReviewFacts | undefined;
  readonly comparisonFailure?:
    | { readonly reason: string; readonly again?: (() => void) | undefined }
    | undefined;
  readonly summary?: ReleaseContentsSummary | undefined;
  /** "pending" while HQ has not read what a release would carry: `summary` then counts nothing. */
  readonly summaryRead?: "pending" | undefined;
  readonly gate: ReleaseGate;
  /** A refusal for missing Production services still has a review; approval reads `gate`. */
  readonly reviewable?: boolean | undefined;
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
  /** Whether HQ's comparison is in: until then `contents` is empty for want of an answer. */
  readonly contentsKnown: boolean;
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
  /** Environments HQ sent that this build cannot read: present, never an application without them. */
  readonly unreadEnvironments: ReadonlyArray<UnreadEnvironment>;
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

/** What a release lists while HQ's repositories or the recipe are not read. */
const NOTHING_TO_LIST: ReadonlyMap<string, string> = new Map();

/**
 * What a release of a group would put live, the production services nothing is told of, and what
 * each production service runs (`productionRuns`) — what a roll back compares from.
 */
export interface ReleaseLive {
  readonly git?: Omit<GitReleaseReviewFacts, "repositories"> | undefined;
  /** What HQ compared; `undefined` where nothing was asked of it (the release stays unasked). */
  readonly moved: ComparedCommits | undefined;
  readonly untold: ReadonlyArray<string>;
  readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
}

/** What to ask HQ of a group's release, and what production runs, which it is asked from. */
export interface ReleasePlan extends CompareReads {
  readonly running: ReadonlyMap<string, ProductionRun>;
}

/** What goes live while nothing has been asked of HQ: what production runs is not known yet. */
export const NOT_COMPARED: MovedCommits = { state: "reading" };
const NOT_ASKED: ReleaseLive = { moved: undefined, untold: [], runs: undefined };

/** What a flow's key says of what goes live: the commits each comparison moves, or its state. */
function liveKey(live: MovedCommits | undefined): unknown {
  if (live?.state !== "known") return live;
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
  readonly navigationOffers?:
    | Readonly<Record<string, CanonicalHqNavigationApp["releaseOffer"] | undefined>>
    | undefined;
  /** Accepted release receipts bridge the answer until HQ's rollout says it ended. */
  readonly acceptedReleases?: ReadonlyMap<string, string>;
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
    const navigationOffer = input.navigationOffers?.[group.groupId];
    const acceptedRelease = input.acceptedReleases?.get(group.groupId);
    const git =
      navigationOffer != null &&
      !("refused" in navigationOffer) &&
      navigationOffer.releaseTarget?.target.kind === "git";
    const stops = git ? undefined : input.stops.get(group.groupId);
    const records = input.releases.get(group.groupId);
    const changes = input.changes?.get(group.groupId);
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
    const { rollouts } = git ? { rollouts: [] } : releaseDeploys(stops?.environments ?? []);
    const listed = (records ?? []).map(flowReleaseOf);
    const newest = listed[0];
    const deploy = {
      // A release HQ ended landed stays on its way until production's own services run it.
      inFlight:
        releaseInFlight({ newest, rollouts }) ??
        releaseLanding({
          newest,
          rollouts,
          earlier: listed.slice(1),
          productions: git ? [] : productionsRunning(stops?.environments ?? []),
        }) ??
        acceptedRelease,
      stalled: releaseStalled({ newest, rollouts }),
    };
    const repos = input.repos.get(group.groupId);
    const recipe = git ? undefined : input.recipes.get(group.groupId);
    const permission = input.permissions.get(group.groupId);
    const live = input.live.get(group.groupId) ?? NOT_ASKED;
    const changesFailure = input.changesRefused.get(group.groupId) ?? input.changesFailure;
    const key = JSON.stringify([
      navigationOffer,
      acceptedRelease,
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
      live.git === undefined
        ? null
        : {
            ...live.git,
            delivery:
              live.git.delivery === undefined
                ? undefined
                : {
                    ...live.git.delivery,
                    lastPushed: [...live.git.delivery.lastPushed],
                  },
          },
    ]);
    let flow = byGroup.get(key);
    if (flow === undefined) {
      flow = projectFlow(
        group,
        { stops, records, changes, changesFailure },
        { repos, recipe, permission, live, navigationOffer, acceptedRelease, review: input.review },
        deploy,
        withheld,
      );
      byGroup.set(key, flow);
    }
    flows.set(group.groupId, flow);
  }
  return flows;
}

/** What each production's services run (`releaseLanding`): a commit, `null` for another name. */
function productionsRunning(
  environments: ReadonlyArray<Pick<GroupEnvironmentRowInput, "tier" | "services">>,
): ReadonlyArray<ReadonlyMap<string, string | null>> {
  return environments
    .filter((environment) => environment.tier === "production")
    .map(
      (environment) =>
        new Map(
          environment.services.flatMap((service) =>
            !service.appVersionName?.trim()
              ? []
              : [[service.hostname, deployedCommit(service.appVersionName) ?? null] as const],
          ),
        ),
    );
}

/**
 * A stop's row. A production is named by the newest release all its services run, where one
 * does; a stage, and a production no release matches, keep the first labelled service's name.
 */
export function canonicalStopRow(
  entry: CanonicalGroupEnvironmentRowInput,
  releases: ReadonlyArray<FlowRelease>,
): CanonicalEnvironmentRow {
  return nameProductionRow(canonicalEnvironmentRow(entry), entry, releases);
}
function nameProductionRow<Row extends Omit<EnvironmentRow, "projectId">>(
  row: Row,
  entry: Pick<GroupEnvironmentRowInput, "tier" | "services">,
  releases: ReadonlyArray<FlowRelease>,
): Row {
  if (entry.tier !== "production") return row;
  const running = new Map<string, string>();
  for (const service of entry.services) {
    const sha = deployedCommit(service.appVersionName);
    if (sha !== undefined) running.set(service.hostname, sha);
  }
  const tag = releaseRunBy(releases, running);
  return tag === undefined ? row : nameStopByRelease(row, tag);
}
function stopRow(
  entry: GroupEnvironmentRowInput,
  releases: ReadonlyArray<FlowRelease>,
): EnvironmentRow {
  return nameProductionRow(environmentRow(entry), entry, releases);
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
    readonly navigationOffer?: CanonicalHqNavigationApp["releaseOffer"] | undefined;
    readonly acceptedRelease?: string | undefined;
  },
  /** The newest release on its way to production, or stalled there (`releaseInFlight`, `releaseStalled`). */
  deploy: { readonly inFlight: string | undefined; readonly stalled: string | undefined },
  /** Why the grant withholds each of the group's projects it withholds alone. */
  withheld: ReadonlyMap<string, string>,
): ZeropsProjectFlow {
  const { stops, records, changes } = halves;
  const navigation = offered.navigationOffer;
  const attachment =
    navigation != null && !("refused" in navigation) ? navigation.releaseTarget : undefined;
  const gitTarget = attachment?.target.kind === "git";
  const environmentInputs = gitTarget ? [] : (stops?.environments ?? []);
  // A production the grant withholds shows nothing it runs, so
  // nothing is measured against it, and no release is listed.
  const withheldProduction = environmentInputs.find(
    (entry) => entry.tier === "production" && withheld.has(entry.projectId),
  );
  const productionWithheld =
    withheldProduction === undefined ? undefined : withheld.get(withheldProduction.projectId);
  const sides = gitTarget
    ? { production: new Map<string, string>(), failed: [] }
    : releaseDeploys(environmentInputs.filter((entry) => !withheld.has(entry.projectId)));
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
  const projected = live.git;
  // The standing and preflight of this very attachment, never of one it replaced.
  const sameAttachment =
    gitTarget &&
    projected?.attachment.environmentId === attachment.environmentId &&
    projected.attachment.createdAt === attachment.createdAt &&
    projected.attachment.target.kind === "git" &&
    projected.attachment.target.branch === attachment.target.branch &&
    projected.attachment.target.delivery === attachment.target.delivery;
  const delivery = sameAttachment ? projected.delivery : undefined;
  const read =
    records === undefined || repos === undefined
      ? undefined
      : gitTarget
        ? releaseCandidate({ target: attachment.target, repos })
        : recipe === undefined
          ? undefined
          : releaseCandidate({ productionRepositories: recipe.productionRepositories, repos });
  const candidate = read?.candidate ?? NOTHING_TO_LIST;
  const offer = {
    entries: releaseEntries(candidate),
    comparison: compareForRelease({
      candidate,
      production: gitTarget ? (delivery?.lastPushed ?? NOTHING_TO_LIST) : sides.production,
    }),
    contents: live.moved?.state === "known" ? live.moved.moved : [],
    contentsKnown: live.moved?.state === "known",
    suggestion: "",
  };
  const ownerGate: ReleaseGate =
    navigation != null && "refused" in navigation
      ? {
          allowed: false,
          reason: hqRefusalWords({ code: navigation.refused, reason: navigation.refused }),
          refusedBy: "hq",
        }
      : offered.acceptedRelease !== undefined
        ? { allowed: false, reason: releaseInFlightReason(offered.acceptedRelease) }
        : navigation === undefined
          ? { allowed: false, reason: "Release offer is unknown." }
          : navigation === null
            ? { allowed: false, reason: "Checking what can be released…" }
            : navigation.gate.allow
              ? { allowed: true }
              : permission?.allowed === false
                ? permission
                : { allowed: false, reason: navigation.gate.reason };
  const gate: ReleaseGate =
    gitTarget && !ownerGate.allowed
      ? ownerGate
      : gitTarget && delivery?.release.allowed === false
        ? { allowed: false, reason: delivery.release.reason ?? delivery.line }
        : offered.review &&
            (read === undefined ||
              live.moved?.state === "reading" ||
              (gitTarget &&
                (delivery === undefined ||
                  navigation == null ||
                  "refused" in navigation ||
                  navigation.head === null)))
          ? { allowed: false, reason: "Checking what can be released…" }
          : offered.review && live.moved?.state === "failed"
            ? {
                allowed: false,
                reason: `Can't check what can be released: ${live.moved.reason.replace(/\.$/u, "")}.`,
              }
            : ownerGate;
  return {
    groupId: group.groupId,
    declarations: stops?.declarations ?? [],
    declarationsRead: stops !== undefined,
    environments: environmentInputs.map((entry) => stopRow(entry, releaseList)),
    environmentInputs,
    unreadEnvironments: stops?.unread ?? [],
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
            ...(navigation != null &&
            !("refused" in navigation) &&
            navigation.problems !== undefined
              ? { problems: navigation.problems }
              : {}),
            releaseTarget: attachment,
            missingServices:
              navigation != null && !("refused" in navigation)
                ? navigation.missingServices
                : undefined,
            gate,
            reviewable:
              gate.allowed ||
              // HQ lists absences only for a person it lets release; overview has no detail
              // permission yet. A later explicit permission refusal still wins.
              (permission?.allowed !== false &&
                navigation != null &&
                !("refused" in navigation) &&
                (navigation.missingServices?.length ?? 0) > 0),
            suggestion:
              navigation != null && !("refused" in navigation)
                ? navigation.suggestion
                : offer.suggestion,
            summary:
              navigation != null && !("refused" in navigation) ? navigation.summary : undefined,
            summaryRead:
              navigation != null && !("refused" in navigation) ? navigation.summaryRead : undefined,
            comparisonFailure: live.moved?.state === "failed" ? live.moved : undefined,
            permission,
            groupHead:
              gitTarget && navigation != null && !("refused" in navigation)
                ? (navigation.head ?? undefined)
                : read?.groupHead,
            ...(gitTarget
              ? {
                  git: {
                    attachment: { ...attachment, target: attachment.target },
                    delivery,
                    repositories: read?.repositories,
                    replaceTokenPermission: projected?.replaceTokenPermission,
                    preflight: sameAttachment ? projected.preflight : undefined,
                  },
                }
              : {}),
            ...deploy,
            inFlight:
              navigation != null && !("refused" in navigation)
                ? (navigation.inFlight ?? deploy.inFlight)
                : deploy.inFlight,
            untold: live.untold,
            runs: gitTarget ? undefined : live.runs,
            repositories: gitTarget
              ? new Map([...candidate.keys()].map((repo) => [repo, repo]))
              : recipe?.productionRepositories,
          }
        : {
            ...offer,
            gate: { allowed: false, reason: productionWithheld },
            reviewable: false,
            permission,
            groupHead: undefined,
            comparison: [],
            entries: [],
            ...deploy,
            contents: [],
            contentsKnown: false,
            untold: [],
            runs: undefined,
            repositories: undefined,
          },
  };
}
