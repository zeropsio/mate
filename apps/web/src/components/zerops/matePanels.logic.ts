/**
 * What a Mate's Zerops and Git panels say about where its work stands and where it goes, in the
 * words the project's pages use (the pages pass, 2026-11-09: "Nothing is stopping it" and "No code
 * here yet" were the panel's own phrases).
 *
 * Pure: the panels' containers read, this words, the panels draw.
 */
import {
  ENVIRONMENT_NOT_ADDED,
  GIT_UNREADABLE_LINE,
  type FlowPullRequest,
  type GitBlock,
  type GroupFlow,
} from "@t3tools/client-runtime/zerops";
import type { MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import {
  cardChanges,
  mateChangesForReview,
  type CardChange,
  type PlaceLine,
} from "./projects/projectCard.logic";
import {
  applicationStage,
  lineChangeKey,
  nextReleaseView,
  openChangeWords,
  type LineWork,
  type NextReleaseInput,
  type ProjectLineInput,
} from "./system";

/** One row of a repository's work, as a change row draws it. */
export type GitWorkRow =
  /** HQ has not told the changes: the row's place is held, never filled with a guess. */
  | { readonly kind: "held" }
  /** The Mate's change: its title, then where it stands. */
  | {
      readonly kind: "change";
      readonly pull: FlowPullRequest;
      readonly state: string;
      readonly tone: ServiceStatusToneId;
      readonly open: boolean;
      readonly at: string | undefined;
    }
  /** Work that is no change yet, or a checkout that could not be read: one plain sentence. */
  | { readonly kind: "plain"; readonly title: string; readonly tone: ServiceStatusToneId };

/** "1 file not committed yet" — the container's own fact, which outranks a calm state. */
export function uncommittedWords(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"} not committed yet`;
}

/** What a repository's work says in its rows' place while its remote does not answer. */
export const WORK_AWAITS_REPOSITORY = "Changes appear here once the repository answers.";

/** Block states that say nothing a person must act on: work on disk is the fresher news. */
const CALM = new Set<GitBlock["state"]>(["untouched", "unpushed", "in-review"]);

/**
 * A repository's work as rows. With no change, the one sentence `gitTab.ts` gives its state — or,
 * where its state is calm, what waits on disk. An open change under review says where it stands,
 * or what of its work is not committed or pushed yet. A landed change says where it went in the
 * project's own words (`landedWords`, "Merged · waits for production"), under a row for each kind
 * of new work since — files on disk, commits not pushed. A change whose checkout no longer reads
 * as a repository is drawn as it stands, never as one under review.
 *
 * A remote that does not answer is the repository's trouble, said once on the repository's own
 * line (`ZeropsGitPanel`): no row is made of it, and nothing is counted against a remote that
 * was not reached. The rows are then the changes HQ tells, as HQ tells them — none where it
 * tells none.
 */
export function gitWorkRows(
  block: GitBlock,
  change:
    | {
        readonly pull: FlowPullRequest;
        /** Where a landed change went, as the project's change rows say it. */
        readonly landedWords: string | undefined;
      }
    | undefined,
): ReadonlyArray<GitWorkRow> {
  const verdict = block.verdict;
  // Trouble is proved before HQ answers; the changes still are not told.
  if (verdict === undefined || block.state === "unread") return [{ kind: "held" }];
  if (block.state === "unreadable")
    return [{ kind: "plain", title: GIT_UNREADABLE_LINE, tone: "failed" }];
  const troubled = block.trouble.length > 0;
  if (troubled) {
    if (change === undefined) return [];
    const { pull } = change;
    if (pull.merged)
      return [
        {
          kind: "change",
          pull,
          state: change.landedWords ?? "Merged",
          tone: "off",
          open: false,
          at: pull.mergedAt ?? pull.updatedAt,
        },
      ];
    const open = openChangeWords(pull);
    return [
      { kind: "change", pull, state: open.words, tone: open.tone, open: true, at: pull.updatedAt },
    ];
  }
  const uncommitted = block.changed.length;
  const onDisk =
    uncommitted > 0 && verdict.tone !== "attention" ? uncommittedWords(uncommitted) : undefined;
  const unpushed = block.unpushed;
  if (change === undefined)
    return [
      {
        kind: "plain",
        title: onDisk !== undefined && CALM.has(block.state) ? onDisk : verdict.text,
        tone: onDisk !== undefined && CALM.has(block.state) ? "busy" : verdict.tone,
      },
    ];
  const { pull } = change;
  if (block.state === "in-review") {
    // Fresher news than a calm review: work on disk, then commits the change does not have yet.
    const fresher = verdict.tone === "attention" ? undefined : (onDisk ?? unpushed);
    return [
      {
        kind: "change",
        pull,
        state: fresher ?? verdict.text,
        tone: fresher === undefined ? verdict.tone : "busy",
        open: true,
        at: pull.updatedAt,
      },
    ];
  }
  const since: ReadonlyArray<GitWorkRow> = [
    ...(onDisk === undefined
      ? []
      : [{ kind: "plain" as const, title: onDisk, tone: "busy" as const }]),
    ...(unpushed === undefined
      ? []
      : [{ kind: "plain" as const, title: unpushed, tone: "busy" as const }]),
  ];
  if (pull.merged)
    return [
      ...since,
      {
        kind: "change",
        pull,
        state: change.landedWords ?? "Merged",
        tone: "off",
        open: false,
        at: pull.mergedAt ?? pull.updatedAt,
      },
    ];
  // Still open, but the checkout says nothing of a review (it is no repository now): the change as
  // HQ tells it — its review is still the way to it.
  const open = openChangeWords(pull);
  return [
    { kind: "change", pull, state: open.words, tone: open.tone, open: true, at: pull.updatedAt },
  ];
}

/** "Dana's services", "Acme Notes' page": a name's own thing, as English writes it. */
export function possessive(name: string, thing: string): string {
  return `${name}${/s$/iu.test(name) ? "'" : "'s"} ${thing}`;
}

/**
 * The places a Mate's panels list in their project card, with a line where a stage would stand
 * when the project has none: production first, as the project's pages do, the same in every panel.
 */
export function panelPlaces(places: ReadonlyArray<PlaceLine>): ReadonlyArray<PlaceLine> {
  const stages = places.filter((line) => line.kind === "stage");
  const production = places.filter((line) => line.kind === "production");
  const shown: ReadonlyArray<PlaceLine> =
    stages.length > 0
      ? stages
      : [
          {
            kind: "stage",
            name: "stage",
            projectId: undefined,
            addresses: [],
            dot: "none",
            words: [ENVIRONMENT_NOT_ADDED],
            trouble: false,
            nothingDeployed: true,
          },
        ];
  return [...production, ...shown];
}

/** The project's line for one Mate, less its work on disk (`ProjectLineInput` without `work`). */
export type MateLine = Omit<ProjectLineInput, "work">;

/**
 * The project's line as a Mate's Code page draws it: the project's stations, this Mate's changes
 * as beads and everybody else's as a count. Its changes wait on the viewer where the one list says
 * so (`useViewerWaits`: `waits`).
 */
export function mateLineInput(input: {
  readonly flow: Pick<GroupFlow, "mates" | "production" | "stages" | "pullRequests">;
  /** The project's places, the pages' own lines. */
  readonly places: ReadonlyArray<PlaceLine>;
  /** The project's changes (`pageChanges`); `undefined` while they are unread. */
  readonly changes: ReadonlyArray<CardChange> | undefined;
  readonly next: NextReleaseInput | null;
  /** The Mate, by its project, and its tint. */
  readonly mate: { readonly projectId: string; readonly tint: MateTintId | undefined };
  /** Its changes in review wait on the viewer. */
  readonly waits: boolean;
}): MateLine {
  const { flow, mate, next } = input;
  return {
    flow,
    places: input.places,
    tintOf: (projectId) => (projectId === mate.projectId ? mate.tint : undefined),
    changes: input.changes ?? [],
    changesKnown: input.changes !== undefined,
    waiting: new Set(
      input.waits ? mateChangesForReview(flow, mate.projectId).map(lineChangeKey) : [],
    ),
    release: {
      view: next === null ? { kind: "none" } : nextReleaseView(next),
      ready: next?.ready,
    },
    mine: mate.projectId,
  };
}

/**
 * A Mate's work on disk that is no change yet, as its line draws it: files not committed, else
 * commits not pushed, one per repository whose checkout was read.
 */
export function lineWork(
  repositories: ReadonlyArray<{ readonly block: GitBlock }>,
  mateProjectId: string,
): ReadonlyArray<LineWork> {
  return repositories.flatMap(({ block }): ReadonlyArray<LineWork> => {
    if (block.trouble.length > 0 || block.state === "unread" || block.state === "unreadable")
      return [];
    const title =
      block.changed.length > 0 ? uncommittedWords(block.changed.length) : block.unpushed;
    return title === undefined
      ? []
      : [{ key: block.repository, mateProjectId, title, words: NOT_A_CHANGE_YET }];
  });
}

/** Work on disk, under its bead's title: it is no change the project lists. */
export const NOT_A_CHANGE_YET = "Not a change yet";

/**
 * Where a landed change went, in the words the project's change rows say it (`cardChanges`): in a
 * release, on stage, or merged and not released yet. `undefined` where the project's flow does not
 * list it.
 */
export function landedChangeWords(
  flow: ZeropsProjectFlow,
  change: FlowPullRequest,
): string | undefined {
  const stage = applicationStage(flow)?.stage;
  return cardChanges({
    open: [],
    merged: flow.merged,
    releases: flow.releasesKnown ? flow.releases : [],
    stage,
    production: flow.environments.some((entry) => entry.tier === "production"),
    limit: flow.merged.length,
  }).find((row) => row.pull.repository === change.repository && row.pull.number === change.number)
    ?.words;
}
