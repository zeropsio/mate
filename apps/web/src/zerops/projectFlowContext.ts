/**
 * The project flow, as every surface reads it (`projectFlow.ts`, D26).
 *
 * One provider reads it for the whole account — the left menu, the projects
 * screen and a Mate's Git tab all show a leg of the same flow, and each
 * reading Gitea for itself is how the account was read seven hundred times a
 * minute once (`useZeropsGroupDeploys`). The value is what was read and the
 * verbs that change it, as the person; a verb re-reads what it changed once
 * it has settled.
 */
import type {
  EnvironmentRow,
  FlowPullRequest,
  FlowReleaseRow,
  GroupEnvironment,
  GroupEnvironmentRowInput,
  MissingEnvironmentRow,
  ReleaseComparison,
  ReleaseEntry,
  ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { createContext, useContext } from "react";

import type { ReleaseContent } from "./useZeropsGroupDeploys";

/** What *Release* offers on a project, when it is offered at all. */
export interface ZeropsReleaseOffer {
  readonly gate: ReleaseGate;
  /** The next patch, suggested from the newest existing tag. */
  readonly suggestion: string;
  readonly comparison: ReadonlyArray<ReleaseComparison>;
  /** What the tag would list — what the verb tags, so it matches what was shown. */
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /**
   * What pressing it would carry: per service, the commits `main` has that the
   * service is not running. With squash merges each is one task delivered.
   */
  readonly contents: ReadonlyArray<ReleaseContent>;
}

/** One project's flow: its environments, what is waiting, what was released. */
export interface ZeropsProjectFlow {
  readonly groupId: string;
  /** The project's Gitea org. */
  readonly slug: string;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /** Stages first, then the production — the order code travels. */
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
  /** The tiers the recipe offers and the project lacks — the rows that ask. */
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
  /** Every open pull request on the project's repositories, code and recipe. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** The changes that have landed — what a conversation's timeline places. */
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  readonly release: ZeropsReleaseOffer;
}

export interface ZeropsProjectFlowValue {
  readonly giteaOrigin: string | undefined;
  /**
   * Whether this tab holds a Gitea session, or is replacing one after a 401; without one nothing
   * below is read.
   */
  readonly signedIn: boolean;
  /**
   * Why there is no session: a refusal at once, a Gitea or broker that does not answer only after
   * two failed tries.
   */
  readonly signInTrouble: string | null;
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  /**
   * What each Zerops project's stop runs, by project id — the platform's
   * answer, read whether or not Gitea is. A project missing here is unread.
   */
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  /** Each group's Gitea org, from the registry — known before its flow has been read. */
  readonly slugs: ReadonlyMap<string, string>;
  /** Every Mate's name by its project, for a surface that meets a bot login (`mate-{projectId}`). */
  readonly mateNames: ReadonlyMap<string, string>;
  /** The verbs in flight, by `flowVerbKey`: a row shows its own running and takes no second click. */
  readonly pending: ReadonlySet<string>;
  /** What the last verb's refusal said, until the next verb. */
  readonly trouble: string | null;
  /** Merges it in Gitea as the person; Gitea's own permissions are the gate. */
  readonly mergePullRequest: (
    slug: string,
    pull: Pick<FlowPullRequest, "repository" | "number">,
  ) => Promise<void>;
  /** Opens one in Gitea as the person, from a branch onto the repository's default. */
  readonly createPullRequest: (
    slug: string,
    input: {
      readonly repository: string;
      readonly head: string;
      readonly base: string;
      readonly title: string;
    },
  ) => Promise<void>;
  /** Tags what the stage runs as the next release (`release.ts`). */
  readonly release: (groupId: string) => Promise<void>;
  /** A new tag listing an earlier release's commits (guide 5.6). */
  readonly rollBack: (groupId: string, tag: string) => Promise<void>;
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
