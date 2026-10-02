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
  /** The release tag on its way to production (`releaseInFlight`); Release waits for it. */
  readonly inFlight: string | undefined;
  /** The group repo's `main` head this offer was read with — the commit its tag points at. */
  readonly target: string | undefined;
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
  /**
   * Whether `environments.yaml` has been read: until then `declarations` is empty for want of an
   * answer, not because the group declares nothing.
   */
  readonly declarationsRead: boolean;
  /** Stages first, then the production — the order code travels. */
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
  /**
   * `main`'s head per production service, as the deploy half read it — what
   * tells a release's review which of its commits is newest, and so which the
   * stage runs (`stageMarks.ts`).
   */
  readonly mainHeads: ReadonlyMap<string, string>;
  /** The tiers the recipe offers and the project lacks — the rows that ask. */
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
  /** Every open change a push reached on the project's repositories, as HQ's stream says. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /**
   * Whether HQ's stream has told the project's changes: until then
   * `pullRequests` is empty for want of an answer, not of a change, and the
   * left menu draws the change rows it remembers (`menuMemory.ts`). Once told,
   * they stand through a stream that goes quiet.
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
  readonly release: ZeropsReleaseOffer;
}

/**
 * How a verb went, for the surface it was pressed on: the review stays open and says what
 * happened (pass 16, R6). A refusal carries the sentence `trouble` says too.
 */
export type FlowVerbOutcome =
  /** Done; a release and a roll back name the tag they made, which their review follows. */
  | { readonly ok: true; readonly tag?: string | undefined }
  | { readonly ok: false; readonly reason: string };

export interface ZeropsProjectFlowValue {
  readonly giteaOrigin: string | undefined;
  /**
   * The organization's official HQ, whose addresses name a Mate's changes; `undefined` until its
   * anchor is resolved, and nothing is read as one of its changes until then.
   */
  readonly hqAddress: string | undefined;
  /**
   * Whether what was read as the person stands: this tab holds a Gitea session, or is getting one
   * back after holding it — stale, with the cause in `trouble` after two failed tries. Without it
   * the flows are empty.
   */
  readonly signedIn: boolean;
  /**
   * A Gitea request can go out as the person now. False while the flows stand with no token held:
   * a surface starts no Gitea read or write then, and runs one once this turns true.
   */
  readonly readable: boolean;
  /**
   * Why no token is held: a refusal at once, a Gitea or broker that does not answer only after
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
  /**
   * While the flows stand with no token, why ({@link signInTrouble}); otherwise what the last
   * verb's refusal said, until the next verb.
   */
  readonly trouble: string | null;
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
  readonly release: (groupId: string) => Promise<FlowVerbOutcome>;
  /** A new tag listing an earlier release's commits (guide 5.6). */
  readonly rollBack: (groupId: string, tag: string) => Promise<FlowVerbOutcome>;
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
