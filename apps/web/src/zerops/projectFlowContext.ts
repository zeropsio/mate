/**
 * The project flow, as every surface reads it (`projectFlow.ts`, D26).
 *
 * One provider reads it for the whole account — the left menu, the projects
 * screen and a Mate's Git tab all show a leg of the same flow, and each
 * reading Gitea for itself is how the account was read seven hundred times a
 * minute once. The value is what was read and the verbs that change it, as
 * the person; a verb re-reads what it changed once it has settled.
 */
import type {
  EnvironmentRow,
  FlowPullRequest,
  FlowReleaseRow,
  GroupEnvironment,
  GroupEnvironmentRowInput,
  GroupEnvironmentTier,
  Moved,
  ProductionRun,
  ReleaseComparison,
  ReleaseEntry,
  ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { createContext, useContext } from "react";

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
 * How a verb went, for the surface it was pressed on: the review stays open and says what
 * happened (pass 16, R6). A refusal carries the sentence `trouble` says too.
 */
export type FlowVerbOutcome =
  /**
   * Done; a release and a roll back name the tag they made, which their review follows. A verb that
   * asked for deploys carries where HQ answered they stand; none where its answer was lost and HQ's
   * records were read back — HQ's stream brings the jobs either way.
   */
  | {
      readonly ok: true;
      readonly tag?: string | undefined;
      readonly deploys?: HqDeployAnswer | undefined;
    }
  | { readonly ok: false; readonly reason: string };

export interface ZeropsProjectFlowValue {
  /**
   * The organization's official HQ, whose addresses name a Mate's changes; `undefined` until its
   * anchor is resolved, and nothing is read as one of its changes until then.
   */
  readonly hqAddress: string | undefined;
  readonly readFailure?: string | undefined;
  readonly groupsRead?: boolean;
  readonly knownGroups?: ReadonlySet<string>;
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  /**
   * Why HQ's last read of an application's releases and repositories did not answer, by its id;
   * what was read before stands in its flow. Nothing while the account's access lapses.
   */
  readonly releaseFailures: ReadonlyMap<string, string>;
  /**
   * What each Zerops project's stop runs, by project id — the platform's
   * answer. A project missing here is unread.
   */
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  /** Every Mate's name by its project, for a surface that meets a bot login (`mate-{projectId}`). */
  readonly mateNames: ReadonlyMap<string, string>;
  /** The verbs in flight, by `flowVerbKey`: a row shows its own running and takes no second click. */
  readonly pending: ReadonlySet<string>;
  /** What the last verb's refusal said, until the next verb. */
  readonly trouble: string | null;
  /**
   * A release made in HQ as the person, of what the offer shows: its `entries`, named its
   * chosen tag (the next patch by default), tagging the `groupHead` it was read with (`release.ts`).
   */
  readonly release: (groupId: string, tag?: string) => Promise<FlowVerbOutcome>;
  /** A new release made in HQ as the person, listing an earlier release's entries (guide 5.6). */
  readonly rollBack: (groupId: string, tag: string) => Promise<FlowVerbOutcome>;
  /**
   * A change squashed into `main` in HQ, as the person, if its head is still `expectedHead` — the
   * head its review showed; none shown, HQ is not asked. HQ's stream brings it merged.
   */
  readonly merge: (
    groupId: string,
    change: { readonly repository: string; readonly number: number },
    expectedHead: string | undefined,
  ) => Promise<FlowVerbOutcome>;
  /** A change closed without merging in HQ, as the person; HQ's stream brings it closed. */
  readonly close: (
    groupId: string,
    change: { readonly repository: string; readonly number: number },
  ) => Promise<FlowVerbOutcome>;
  /**
   * "Run again": the environment `projectId`'s newest deploy of `service`, at `sha` — failed,
   * refused, or live where the service runs something else — asked again in HQ as the person.
   * HQ's stream brings a newer job than `after`.
   */
  readonly redeploy: (
    groupId: string,
    projectId: string,
    deploy: { readonly service: string; readonly sha: string; readonly after: string },
  ) => Promise<FlowVerbOutcome>;
  /**
   * "Add <service>": a service the environment `projectId`'s tier declares and its project lacks,
   * added in HQ as the person — imported, then deployed.
   */
  readonly addService: (
    groupId: string,
    projectId: string,
    service: string,
  ) => Promise<FlowVerbOutcome>;
}

export const ZeropsProjectFlowContext = createContext<ZeropsProjectFlowValue | null>(null);

export function useZeropsProjectFlow(): ZeropsProjectFlowValue {
  const value = useContext(ZeropsProjectFlowContext);
  if (value === null) {
    throw new Error("useZeropsProjectFlow must be used within ZeropsProjectFlowProvider");
  }
  return value;
}

/** The flow where a surface may stand without the provider — a test, a story. */
export function useZeropsProjectFlowOptional(): ZeropsProjectFlowValue | null {
  return useContext(ZeropsProjectFlowContext);
}
