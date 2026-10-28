/**
 * Review: what every change, release, roll-back and crew task says before it
 * moves, and what pressing its one button does (pass 16, R2 · R5 · R6).
 *
 * The same act had five doors that behaved differently, and none of them said
 * whether it was safe: a menu row merged on one click, a Git tab merged on
 * another, rolling production back asked nothing. The review is the one door,
 * and it leads with one verdict — a box that says whether it is safe and why,
 * or what blocks it and who fixes it — then the button named for what it does,
 * with the consequence beside it in a sentence.
 *
 * Every word the review says is here, so a harness and a test can read every
 * state of it without a forge behind them, and no surface grows a second
 * opinion (R5). The press itself — running, refused, done — is the caller's
 * to hold and hand in: the words follow it.
 *
 * Pure: no network, no clock, no platform globals (rule R1). The caller passes
 * the clock.
 *
 * @module reviewVerdict
 */

import { tokenExpiryLabel, type HqRepoRemote } from "@t3tools/shared/hqChanges";
import type { ChangePipeline } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";

import type { AppDeployRollout } from "./hq/deployHandover.logic.ts";
import type { MergeabilityKind } from "./changeMergeability.ts";
import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import { hqRefusalWords } from "./hq/refusals.ts";
import type { FlowPullRequestKind } from "./projectFlow.ts";
import type { RecipeReach } from "./recipeReach.ts";
import type { RecipeTier } from "./recipeTier.ts";
import type { MovedCommits } from "./releaseCompare.ts";
import {
  GIT_PREFLIGHT_PENDING,
  RELEASE_CHECKING,
  releaseNothingReason,
  type ReleaseGate,
  type GitReleaseReviewFacts,
  type GitReleaseRepository,
} from "./release.ts";

/**
 * The word on every door to a change's review. Never *Merge*: that is the review's own button,
 * pressed after the change was read (R1).
 */
export const REVIEW_LABEL = "Review";
/** The word on every door to the next release's review; *Release* is the review's own button. */
export const REVIEW_RELEASE_LABEL = "Review release";

/**
 * The verdict box's look: green passed, amber needs you, red broken, a
 * spinner while it moves, ink for what is over, and grey for no signal.
 */
export type ReviewTone = "ok" | "attention" | "failed" | "busy" | "done" | "quiet";

export type ReviewState =
  | "ready"
  | "behind-clean"
  | "behind"
  | "conflict"
  | "empty"
  | "checking"
  | "checks-running"
  | "checks-failed"
  | "checks-unknown"
  | "merging"
  | "merge-refused"
  | "merged"
  | "close-confirm"
  | "closing"
  | "close-refused"
  | "closed"
  | "release-ready"
  | "release-blocked"
  | "releasing"
  | "released"
  | "release-failed"
  | "release-stalled"
  | "release-superseded"
  | "rollback-ready"
  | "rollback-blocked"
  | "rolling-back"
  | "rolled-back"
  | "rollback-failed"
  | "rollback-stalled"
  | "rollback-superseded"
  | "rollback-refused"
  | "land-ready"
  | "land-now"
  | "land-conflict"
  | "land-check-failed"
  | "land-check-running"
  | "land-waiting"
  | "land-review"
  | "land-parked"
  | "land-discarded"
  | "land-not-yet"
  | "landing"
  | "land-refused"
  | "landed";

/**
 * A problem handed to a Mate: what failed, when, the error, and what to do —
 * the shape `fixRequest.ts` writes into the Mate's composer (S6).
 */
export interface ReviewFixProblem {
  readonly what: string;
  readonly at?: string | undefined;
  readonly error?: string | undefined;
  readonly logLines?: ReadonlyArray<string> | undefined;
  readonly logName?: string | undefined;
  readonly ask: string;
}

export interface ReviewFix {
  /** The words after "Ask Nova to": `resolve it`, `fix it`, `update it`. */
  readonly verb: string;
  readonly problem: ReviewFixProblem;
}

export interface ReviewVerdict {
  readonly state: ReviewState;
  readonly tone: ReviewTone;
  /** The one line that answers "is it safe?", in weight. */
  readonly title: string;
  /** Why, quietly, under it. Every state has one, so the box keeps its height as it moves. */
  readonly why: string;
  /** Where handing it to a Mate is what moves it. */
  readonly fix: ReviewFix | undefined;
}

/** The review's one button. */
export interface ReviewPrimary {
  readonly label: string;
  /** It can be pressed. */
  readonly enabled: boolean;
  /** ⌘↵ presses it, and the review opens with the focus on it. */
  readonly safe: boolean;
  /**
   * Its keys shown before it takes them: a Merge waiting for its change to be read keeps the
   * width it will have, so nothing in the foot moves once it can be pressed.
   */
  readonly shortcut?: true;
}

/** A quiet word in the foot beside the one button: a change's *Close without merging…*. */
export interface ReviewSecondary {
  readonly label: string;
  readonly enabled: boolean;
}

/**
 * The one question a review may ask after a merge: where the code should run, with a button for
 * each environment the person may add — production's is *Put it live*, which makes it and releases
 * to it in one step — and a quiet way to say not now. It is asked once and remembers nothing: no
 * answer is stored, and no later merge asks it.
 */
export interface ReviewQuestion {
  readonly text: string;
  /**
   * Equal peers, in the order stage, production; none is the default. Each says in one short line
   * what it gives, so neither is a guess (a run 2 follow-up: two equal buttons, nothing between them).
   */
  readonly options: ReadonlyArray<{
    readonly tier: GroupEnvironmentTier;
    readonly label: string;
    readonly hint: string;
  }>;
  /** The word that closes the question and keeps the slots in the application's page. */
  readonly dismiss: string;
}

export interface ReviewModel {
  readonly pipeline?:
    | {
        readonly checks: ChangePipeline["checks"];
        readonly why: string | undefined;
      }
    | undefined;
  readonly verdict: ReviewVerdict;
  /** What pressing does, said beside the button — or, once it is over, where things stand. */
  readonly consequence: string;
  /** `undefined` where there is nothing left to press. */
  readonly primary: ReviewPrimary | undefined;
  readonly secondary?: ReviewSecondary | undefined;
  /** Where the code should run, asked once after the first code merge (`ReviewQuestion`). */
  readonly question?: ReviewQuestion | undefined;
}

/** The press, as the caller holds it: running, refused with HQ's words, or done. */
export type ReviewPress =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "refused"; readonly reason: string }
  /**
   * Done: where HQ answered the deploys it asked for stand, where it answered (`hqDeploys`), and
   * the rollout they are of, which an answer that handed planning over is followed by.
   */
  | {
      readonly kind: "done";
      readonly deploys?: HqDeployAnswer | undefined;
      readonly rollout?: AppDeployRollout | undefined;
    };

/**
 * Closing a change without merging, as the caller holds it: asked — the review is its one
 * confirmation — then pressed like any verb.
 */
export type ReviewClose = ReviewPress | { readonly kind: "asked" };

/** `Just now`, `20 minutes ago`, `5 hours ago`, `3 days ago` — or nothing for a time it cannot read. */
export function reviewAge(at: string, now: number): string | undefined {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return undefined;
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago`;
  return `${String(Math.floor(hours / 24))} days ago`;
}

/** `a`, `a and b`, `a, b and c`. */
function listed(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** `a`, `a or b`, `a, b or c`. */
function either(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1) ?? ""}`;
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** A file's own name: what a sentence names it by. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// A change
// ---------------------------------------------------------------------------

export interface ChangeReviewInput {
  readonly pull: {
    readonly number: number;
    readonly headSha?: string | undefined;
    /** Open with nothing pushed yet (`FlowPullRequest.unpushed`). */
    readonly unpushed?: true | undefined;
    readonly pipeline?: ChangePipeline | undefined;
    readonly kind: FlowPullRequestKind;
    readonly baseBranch: string;
    readonly mergeability: MergeabilityKind;
    readonly merged: boolean;
    readonly mergedAt: string | undefined;
    /** `closed` for one no longer open — merged, or closed without merging. */
    readonly state?: string | undefined;
    /** Whether `main` has moved on past the commit it was cut from. */
    readonly behind: boolean;
    /** Whether it asks for review: its Mate described it at its head. Absent reads as ready. */
    readonly ready?: boolean | undefined;
    /** On a draft described before a push: why it is a draft again (`HqChange.draftReason`). */
    readonly draftReason?: string | undefined;
    /** HQ's word, once it merged, that it was the application's first merged code change. */
    readonly firstCodeMerge?: boolean | undefined;
    /** HQ's word, once it merged, that GitHub merged it of a head no person merged in Mate. */
    readonly landedOutside?: boolean | undefined;
    /** HQ's word that it is open and its Mate is no longer one of the application's. */
    readonly mateGone?: true | undefined;
    /** HQ's word, once it closed without merging, that its own Mate closed it. */
    readonly closedByMate?: true | undefined;
  };
  /** The name of the Mate that wrote it: only Mates open changes (SPEC §5.4). */
  readonly mateName: string;
  /**
   * How far its files were read for the head it is at. Merge takes only a head whose change was
   * shown: it waits while they are read, and one that could not be read is merged only by a
   * deliberate press. `unread`: HQ never said which head it is at, and the wait for it is over —
   * Merge would name no head, so it stays off.
   */
  readonly readout: "reading" | "read" | "failed" | "unread";
  /** How many commits it squashes, where they were read. */
  readonly commits?: number | undefined;
  /**
   * For a change that no longer merges: the files `main` changed under it, and the newest
   * commit that did, where they were read.
   */
  readonly conflict?:
    | {
        readonly files: ReadonlyArray<string>;
        readonly by: { readonly subject: string; readonly at?: string | undefined } | undefined;
      }
    | undefined;
  /** Where `main` goes next: a production a release puts it in front of, a stage that follows it. */
  readonly downstream: { readonly production: boolean; readonly stage: boolean };
  /**
   * Whether the application holds a production in any state — declared, being made, failed — which
   * is as good as present: the question after the first merge is never asked of it.
   */
  readonly productionHeld?: boolean | undefined;
  /**
   * The environments this person may add now: those the recipe on `main` holds, the application
   * lacks, and HQ offers the person (`add_stage` / `add_production`). Absent, none: nothing is offered on a guess.
   */
  readonly addable?: { readonly stage: boolean; readonly production: boolean } | undefined;
  /**
   * Once merged: how many changes wait for production now (`undefined` until the release is
   * compared), and what production runs.
   */
  readonly waiting?:
    | { readonly count: number | undefined; readonly live: string | undefined }
    | undefined;
  /**
   * The flow's release gate, shared with the release review. A recipe change is never released —
   * a release tags the code in the service repositories.
   */
  readonly release?: ReleaseGate | undefined;
  /**
   * For a recipe change, what merging it does to the project (`recipeReach`), once its files are
   * read; `undefined` until then.
   */
  readonly recipe?: RecipeReach | undefined;
  /**
   * What HQ offers the person (`can`, `useChangeOffers`): Merge and Close only where it does;
   * `undefined` while HQ has not said, and Merge waits for it.
   */
  readonly offered: { readonly merge: boolean; readonly close: boolean } | undefined;
  readonly press?: ReviewPress | undefined;
  readonly close?: ReviewClose | undefined;
  /** The application's Mates a change whose Mate is gone may be handed to. */
  readonly heirs?: ReadonlyArray<{ readonly projectId: string; readonly name: string }> | undefined;
  readonly hand?: ReviewHand | undefined;
  readonly now: number;
}

/** Handing a change whose Mate is gone to another Mate, as the caller holds it. */
export type ReviewHand =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly to: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "done"; readonly to: string };

/** What a change whose Mate is gone says, and the Mates it may be handed to. */
export interface ReviewOrphan {
  readonly text: string;
  readonly options: ReadonlyArray<{
    readonly projectId: string;
    readonly label: string;
    readonly enabled: boolean;
  }>;
}

export interface ChangeReviewModel extends ReviewModel {
  readonly orphan?: ReviewOrphan | undefined;
}

/** What merging takes, said where Merge would stand for a person HQ would refuse it to. */
const MERGE_NOT_OFFERED = hqRefusalWords({ code: "forbidden", reason: "not_app_developer" });

/** The close's own button, once the review asks it. */
const CLOSE_LABEL = "Close without merging";
/** The word that asks it, quiet in the foot. */
const CLOSE_OFFER: ReviewSecondary = { label: `${CLOSE_LABEL}…`, enabled: true };
/** The way back from the ask. */
const KEEP_OPEN: ReviewSecondary = { label: "Keep it open", enabled: true };

/** A change no longer open and never merged: nothing more to press. */
function closedReview(base: string, why: string): ReviewModel {
  return {
    verdict: {
      state: "closed",
      tone: "done",
      title: "Closed without merging",
      why,
      fix: undefined,
    },
    consequence: `It never reached ${base}; nothing merges from here.`,
    primary: undefined,
  };
}

/** Closing without merging, asked or pressed: the review is its one confirmation, never ⌘↵'s. */
function closeReview(
  input: ChangeReviewInput,
  close: Exclude<ReviewClose, { readonly kind: "idle" | "done" }>,
): ReviewModel {
  const { pull } = input;
  const number = `#${String(pull.number)}`;
  const allowed = input.offered?.close === true;
  const consequence = allowed
    ? `Closes ${number} for good; ${input.mateName}'s branch stays as it is.`
    : input.offered === undefined
      ? "Closing waits: HQ has not said whether you may close this change."
      : "HQ no longer offers Close for this change.";
  const primary = (enabled: boolean): ReviewPrimary => ({
    label: CLOSE_LABEL,
    enabled,
    safe: false,
  });
  switch (close.kind) {
    case "asked":
      return {
        verdict: {
          state: "close-confirm",
          tone: "attention",
          title: `Close ${number} without merging?`,
          why: `Nothing of it reaches ${pull.baseBranch}`,
          fix: undefined,
        },
        consequence,
        primary: primary(allowed),
        secondary: KEEP_OPEN,
      };
    case "running":
      return {
        verdict: {
          state: "closing",
          tone: "busy",
          title: `Closing ${number}`,
          why: "Without merging",
          fix: undefined,
        },
        consequence,
        primary: primary(false),
      };
    case "refused":
      return {
        verdict: {
          state: "close-refused",
          tone: "attention",
          title: "Not closed",
          why: close.reason,
          fix: undefined,
        },
        consequence,
        // A second try is the person's deliberate press, as Merge's is.
        primary: primary(allowed),
        secondary: KEEP_OPEN,
      };
  }
}

/** `Adds this change to main.` — its commits are the Commits fold's to count, not the foot's. */
function mergeSentence(pull: ChangeReviewInput["pull"], behind: boolean, unshown: boolean): string {
  const unseen = unshown ? " without its files shown" : "";
  const onTop = behind ? ", on top of changes it wasn't checked with" : "";
  return `Adds this change to ${pull.baseBranch}${unseen}${onTop}.`;
}

/** What any recipe change does, which is all that can be said of one before its files are read. */
const RECIPE_UNREAD =
  "Each environment gets any service added to its recipe, created empty; the services it has stay as they are.";

/** Who a recipe change's merge adds services to: the stages and the production made from it. */
function recipeGainers(
  reach: RecipeReach,
): { readonly who: string; readonly one: boolean; readonly recipes: string } | undefined {
  const stages = reach.stages === 0 ? undefined : reach.stages === 1 ? "the stage" : "the stages";
  if (stages === undefined) {
    return reach.production ? { who: "production", one: true, recipes: "its recipe" } : undefined;
  }
  if (reach.production) {
    return { who: `${stages} and production`, one: false, recipes: "their recipes" };
  }
  return reach.stages === 1
    ? { who: stages, one: true, recipes: "its recipe" }
    : { who: stages, one: false, recipes: "their recipe" };
}

/** What is made later from a recipe it changes, as a sentence names it. */
const MADE_LATER: Record<RecipeTier, string> = {
  mate: "a Mate",
  stage: "a stage",
  production: "a production",
};

/** A sentence's first word takes a capital. */
function capitalized(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * What merging a recipe change does, in the person's words (`recipeReach`): the stages and the
 * production made from a recipe it changes get any service it adds, created empty, and nothing
 * else of them changes; a Mate, a stage or a production made later is made from it. Never a
 * release: a release tags code, and a recipe is what the environments are made from.
 */
function recipeSentence(reach: RecipeReach | undefined): string {
  if (reach === undefined) return RECIPE_UNREAD;
  const gainers = recipeGainers(reach);
  const later = reach.later.map((tier) => MADE_LATER[tier]);
  const unchanged =
    later.length === 0 && reach.unused.length > 0
      ? `Nothing in this project is made from the ${either(reach.unused)} recipe, so no environment changes.`
      : "No environment changes.";
  return sentences(
    gainers === undefined
      ? undefined
      : `${capitalized(gainers.who)} ${gainers.one ? "gets" : "get"} any service added to ${gainers.recipes}, created empty; the services ${gainers.one ? "it has" : "they have"} stay as they are.`,
    gainers === undefined ? unchanged : undefined,
    later.length === 0
      ? undefined
      : `${capitalized(either(later))} added later is made from the new recipe.`,
  );
}

/** What a recipe change's merge did, in the few words after its age. */
function recipeNext(reach: RecipeReach | undefined, base: string): string {
  if (reach === undefined) return `it's on ${base}`;
  const gainers = recipeGainers(reach);
  if (gainers === undefined) return "no environment changes";
  return `${gainers.who} ${gainers.one ? "gets" : "get"} any new service`;
}

/** What happens once `main` has it, as far as anything downstream goes. */
function afterMain(input: ChangeReviewInput): string | undefined {
  if (input.pull.kind === "recipe") return recipeSentence(input.recipe);
  if (input.downstream.production) return "Production isn't touched until you release.";
  if (input.downstream.stage) return `The stage picks it up from ${input.pull.baseBranch}.`;
  return undefined;
}

function sentences(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part) => part !== undefined && part.length > 0).join(" ");
}

function changePipelineOf(pull: ChangeReviewInput["pull"]): NonNullable<ReviewModel["pipeline"]> {
  const pipeline = pull.pipeline;
  if (pipeline === undefined) {
    return { checks: [], why: "Repository check requirements are unknown." };
  }
  if (pull.headSha === undefined || pipeline.head !== pull.headSha) {
    return {
      checks: pipeline.checks.map((check) => ({
        ...check,
        requirement: "unknown",
        state: "unknown",
      })),
      why: "Pipeline checks have not been read for this head.",
    };
  }
  return {
    checks: pipeline.checks,
    why:
      pipeline.requirements === "unknown" ||
      pipeline.checks.some((check) => check.requirement === "unknown")
        ? "Repository check requirements are unknown."
        : pipeline.checks.length === 0
          ? "No pipeline checks."
          : undefined,
  };
}

/**
 * The change's own verdict, before anything was pressed: whether it can merge now, and why not. Every
 * door that merges a change asks it first — the review's Merge and *Put it live* alike — and the
 * composer's strip says it of a change that does not merge (`mateNextStep`). The clock only ages
 * the commit that conflicts: a caller that read no conflict passes none.
 */
export function changeMergeVerdict(
  input: Pick<ChangeReviewInput, "pull" | "mateName" | "conflict" | "commits"> &
    Partial<Pick<ChangeReviewInput, "now">>,
): {
  readonly verdict: ReviewVerdict;
  readonly enabled: boolean;
} {
  const { pull } = input;
  const base = pull.baseBranch;
  const who = input.mateName;

  if (pull.mergeability === "conflicting") {
    const files = input.conflict?.files ?? [];
    const resolve: ReviewFix = {
      verb: "resolve it",
      problem: {
        what:
          files.length === 0
            ? `Change #${String(pull.number)} no longer merges cleanly into ${base}`
            : `Change #${String(pull.number)} conflicts with ${base} in ${listed(files.map(baseName))}`,
        ask: `Merge ${base} into it, resolve the conflicts, and deliver it again.`,
      },
    };
    if (files.length === 0) {
      return {
        enabled: false,
        verdict: {
          state: "behind",
          tone: "attention",
          title: `Behind ${base}`,
          why: `It no longer merges cleanly: ${base} moved on since ${who} branched`,
          fix: resolve,
        },
      };
    }
    const where = files.length <= 2 ? listed(files.map(baseName)) : `${String(files.length)} files`;
    const by = input.conflict?.by;
    const number = by === undefined ? undefined : /\(#(\d+)\)\s*$/u.exec(by.subject)?.[1];
    const author =
      by === undefined ? undefined : number === undefined ? `“${by.subject}”` : `#${number}`;
    const age =
      by?.at === undefined || input.now === undefined
        ? undefined
        : reviewAge(by.at, input.now)?.toLowerCase();
    const it = files.length === 1 ? "it" : "them";
    return {
      enabled: false,
      verdict: {
        state: "conflict",
        tone: "attention",
        title: `Conflicts with ${base} in ${where}`,
        why:
          author === undefined
            ? "It no longer merges cleanly"
            : `${author} changed ${it} on ${base}${age === undefined ? "" : ` ${age}`}`,
        fix: resolve,
      },
    };
  }

  if (pull.mergeability === "empty") {
    return {
      enabled: false,
      verdict: {
        state: "empty",
        tone: "quiet",
        title: "Nothing to merge",
        why: `${base} already has all of it`,
        fix: undefined,
      },
    };
  }

  if (pull.mergeability === "checking") {
    return {
      enabled: false,
      verdict: {
        state: "checking",
        tone: "busy",
        title: "Checking whether it merges cleanly",
        why: "HQ works it out after every push",
        fix: undefined,
      },
    };
  }

  const required = changePipelineOf(pull).checks.filter(
    (check) => check.requirement === "required" && check.state !== "passed",
  );
  if (required.length > 0) {
    const failed = required.some((check) => check.state === "failed");
    const unknown = required.some((check) => check.state === "unknown");
    const names = listed(required.map((check) => check.name));
    return {
      enabled: false,
      verdict: {
        state: failed ? "checks-failed" : unknown ? "checks-unknown" : "checks-running",
        tone: failed ? "failed" : unknown ? "quiet" : "busy",
        title: failed
          ? "Required checks failed"
          : unknown
            ? "Required checks unknown"
            : "Required checks running",
        why: `${names}: required by the repository. ${failed ? "Ask the Mate to fix the failed checks and push again." : unknown ? "Wait for current check evidence." : "Wait for the checks to finish."}`,
        fix: failed
          ? {
              verb: "fix it",
              problem: {
                what: `Required pipeline checks failed for change #${String(pull.number)}: ${names}`,
                ask: "Fix the failed checks and deliver the change again.",
              },
            }
          : undefined,
      },
    };
  }

  const commits =
    input.commits === undefined ? undefined : count(input.commits, "commit", "commits");
  if (pull.behind) {
    return {
      enabled: true,
      verdict: {
        state: "behind-clean",
        tone: "attention",
        title: `Behind ${base}`,
        why: `${base} moved on since ${who} branched · it still merges cleanly`,
        fix: {
          verb: "update it",
          problem: {
            what: `Change #${String(pull.number)} is behind ${base}`,
            ask: `Merge ${base} into it, check it still works, and deliver it again.`,
          },
        },
      },
    };
  }

  // Quiet, not green: no signal about a change is not a good signal. A draft merges as well,
  // but says its words are not of its latest work: its Mate has not described that yet — or, one
  // described before, why HQ made it a draft again though its own diff may be as it was.
  const draft = pull.ready === false;
  const again = draft ? draftAgain(pull.draftReason) : undefined;
  return {
    enabled: true,
    verdict: {
      state: "ready",
      tone: "quiet",
      title: draft ? "Draft" : "Ready to merge",
      why: [
        again !== undefined
          ? `HQ couldn't ${again.couldNot} the latest push${again.inTime ? " in time" : ""}, so ${who} needs to describe it again`
          : draft
            ? `${who} hasn't described its latest work`
            : undefined,
        `No conflicts with ${base}`,
        commits,
      ]
        .filter((part) => part !== undefined)
        .join(" · "),
      fix:
        again === undefined
          ? undefined
          : {
              verb: "describe it again",
              problem: {
                what: `Change #${String(pull.number)} is a draft again: HQ couldn't ${again.couldNot} its latest push${again.inTime ? " in time" : ""}`,
                ask: "Describe the change again as it is now.",
              },
            },
    },
  };
}

/**
 * Why HQ made a described change a draft again, for the reasons this client knows: its check of
 * the push ran out of time, or it could not read the push. A later HQ's reason says nothing more
 * than a draft does.
 */
function draftAgain(
  reason: string | undefined,
): { readonly couldNot: string; readonly inTime: boolean } | undefined {
  switch (reason) {
    case "notes_timed_out":
      return { couldNot: "check", inTime: true };
    case "notes_unread":
      return { couldNot: "read", inTime: false };
    default:
      return undefined;
  }
}

/**
 * The question after a first code merge: only in the review of the merge this person just finished
 * (`press` done — never a reopened one), only for the application's first merged code change as HQ
 * says it, only where no production is held in any state, and only with a button to answer it.
 */
function whereShouldItRun(input: ChangeReviewInput): ReviewQuestion | undefined {
  if (input.press?.kind !== "done" || input.pull.firstCodeMerge !== true) return undefined;
  if (input.downstream.production || input.productionHeld === true) return undefined;
  const options = (
    [
      [
        "stage",
        input.addable?.stage === true,
        "Add stage",
        "A stage is a copy to try changes on before they go live.",
      ],
      [
        "production",
        input.addable?.production === true,
        "Put it live",
        "Put it live gives it its own public address.",
      ],
    ] as const
  ).flatMap(([tier, offered, label, hint]) => (offered ? [{ tier, label, hint }] : []));
  if (options.length === 0) return undefined;
  // What runs it, as it is: the Mate's preview runs its own copy for trying it out, never the
  // stage (a first run asked "Where should it run?" beside "Your shop front is online").
  // Its title already says where the code went: the question says only what runs it.
  return {
    text: input.downstream.stage
      ? `The stage picks it up; ${input.mateName}'s preview is only for trying it out.`
      : `Only ${input.mateName}'s preview runs it, for trying it out.`,
    options,
    dismiss: "Not now",
  };
}

function changeReviewModel(input: ChangeReviewInput): ReviewModel {
  const { pull } = input;
  const base = pull.baseBranch;
  const press = input.press ?? { kind: "idle" };
  const close = input.close ?? { kind: "idle" };

  // Owner-proven terminal facts win over an outdated local press.
  if (!pull.merged && pull.state === "closed") {
    const who =
      close.kind === "done" ? "You" : pull.closedByMate === true ? input.mateName : "Somebody";
    return closedReview(base, `${who} closed it; its branch is still there`);
  }
  if (pull.merged || press.kind === "done") {
    const age =
      pull.mergedAt === undefined
        ? "Just now"
        : (reviewAge(pull.mergedAt, input.now) ?? "Just now");
    const nothing = releaseNothingReason(input.release);
    const waiting = nothing === undefined ? input.waiting?.count : 0;
    const recipe = pull.kind === "recipe";
    const next = recipe
      ? recipeNext(input.recipe, base)
      : input.downstream.production && waiting === undefined
        ? // Said once the release is compared, never a count that changes under the person's eyes.
          undefined
        : input.downstream.production && waiting !== undefined && waiting > 0
          ? `${count(waiting, "change now waits", "changes now wait")} for production`
          : input.downstream.stage
            ? "the stage picks it up"
            : undefined;
    const live = input.waiting?.live;
    const consequence = recipe
      ? recipeSentence(input.recipe)
      : input.downstream.production
        ? (nothing ??
          (live === undefined
            ? "Production isn't touched until you release."
            : `Production still serves ${live} until you release.`))
        : input.downstream.stage
          ? `The stage picks it up from ${base}.`
          : // Its title says where it went; nothing more follows from it.
            "";
    return {
      verdict: {
        state: "merged",
        tone: "done",
        title: `Merged into ${base}${pull.landedOutside === true ? " outside Mate" : ""}`,
        why: [age, next].filter((part) => part !== undefined).join(" · "),
        fix: undefined,
      },
      consequence,
      // A merge is a finished act: it says what waits for production, and the release opens from its
      // own doors — never this button, where a second ⌘↵ would reach production (the owner,
      // 2026-10-05). The one question after a first merge is all it may still ask.
      primary: undefined,
      question: recipe ? undefined : whereShouldItRun(input),
    };
  }

  // Closed by this press: said at once, before HQ's stream brings it closed.
  if (close.kind === "done") return closedReview(base, "You closed it; its branch is still there");
  if (close.kind !== "idle") return closeReview(input, close);
  // Close without merging, quiet beside Merge where HQ's rule offers it — never while Merge runs.
  const secondary = input.offered?.close === true ? CLOSE_OFFER : undefined;
  // Opened before its branch was pushed: nothing to merge yet, and a person may still close it.
  if (pull.unpushed === true) {
    return {
      verdict: {
        state: "empty",
        tone: "quiet",
        title: "Nothing pushed yet",
        why: `${input.mateName} opened it before pushing its branch`,
        fix: undefined,
      },
      consequence: "Nothing merges from here until its branch is pushed.",
      primary: undefined,
      secondary,
    };
  }

  const verdictOf = changeMergeVerdict(input);
  const { verdict } = verdictOf;
  if (verdict.state === "empty") {
    return {
      verdict,
      consequence: `Nothing to deliver: ${base} already has this.`,
      primary: undefined,
      secondary,
    };
  }
  // Merge takes the head the review shows: none while its details are read, and never one HQ has not
  // said. A read that failed leaves it to a deliberate press.
  const enabled =
    verdictOf.enabled &&
    input.readout !== "reading" &&
    input.readout !== "unread" &&
    input.offered?.merge === true;
  const squash = sentences(
    mergeSentence(pull, verdict.state === "behind-clean", input.readout === "failed"),
    afterMain(input),
  );
  const waits: Partial<Record<ReviewState, string>> = {
    behind: "Merging waits until the conflict is resolved.",
    conflict: "Merging waits until the conflict is resolved.",
    checking: "Merging waits until HQ knows it merges cleanly.",
    "checks-running": "Merging waits for the repository's required checks to finish.",
    "checks-failed": "Merging waits until the Mate fixes the required checks and pushes again.",
    "checks-unknown": "Merging waits for evidence of the repository's required checks.",
  };
  // What holds it back, said beside it: the change's own trouble, or — for a change nothing is
  // wrong with — its details still loading, or never sent, which Merge waits for.
  const held = verdictOf.enabled
    ? input.readout === "reading"
      ? "Loading change details…"
      : input.readout === "unread"
        ? "Nothing merges from here until HQ sends this change's details."
        : squash
    : (waits[verdict.state] ?? squash);

  if (press.kind === "running") {
    return {
      verdict: {
        state: "merging",
        tone: "busy",
        title: `Merging into ${base}`,
        why: `Adding this change to ${base}`,
        fix: undefined,
      },
      consequence: squash,
      primary: { label: "Merge", enabled: false, safe: false },
    };
  }
  if (press.kind === "refused") {
    return {
      verdict: {
        state: "merge-refused",
        tone: "attention",
        title: "Not merged",
        why: press.reason,
        fix: verdict.fix,
      },
      consequence: enabled ? squash : held,
      // A second try is the person's deliberate press, never ⌘↵'s.
      primary: { label: "Merge", enabled, safe: false },
      secondary,
    };
  }
  // A verb this person cannot finish is not offered (guide 0.8): the foot says what it takes.
  if (input.offered?.merge === false) {
    return { verdict, consequence: MERGE_NOT_OFFERED, primary: undefined, secondary };
  }
  // Behind main is amber, and a change whose files could not be read was never shown: both
  // still pressable, never pressed for the person.
  const safeOnceRead = verdictOf.enabled && verdict.state !== "behind-clean";
  // Its files, or HQ's rule's facts, still to come: Merge keeps the width it will have.
  const waiting = input.readout === "reading" || input.offered === undefined;
  return {
    verdict,
    consequence: held,
    primary: {
      label: "Merge",
      enabled,
      safe: safeOnceRead && input.readout === "read" && !waiting,
      ...(safeOnceRead && waiting ? { shortcut: true } : {}),
    },
    secondary,
  };
}

const ORPHANED = "Its Mate is no longer in this project, so nobody works on it.";

/**
 * An open change whose Mate is gone: said, with Close in the foot and Hand to each other Mate of the
 * application for a person HQ lets close it — handing over takes the same right.
 */
function orphanOf(input: ChangeReviewInput): ReviewOrphan | undefined {
  const { pull } = input;
  const close = input.close ?? { kind: "idle" };
  if (pull.mateGone !== true || pull.merged || pull.state === "closed" || close.kind !== "idle")
    return undefined;
  const hand = input.hand ?? { kind: "idle" };
  const heirs = input.heirs ?? [];
  const nameOf = (projectId: string) =>
    heirs.find((heir) => heir.projectId === projectId)?.name ?? "another Mate";
  if (hand.kind === "done")
    return {
      text: `Handed to ${nameOf(hand.to)}, who goes on with it on its branch.`,
      options: [],
    };
  if (input.offered?.close === false) return { text: ORPHANED, options: [] };
  const options = heirs.map((heir) => ({
    projectId: heir.projectId,
    label:
      hand.kind === "running" && hand.to === heir.projectId
        ? `Handing to ${heir.name}…`
        : `Hand to ${heir.name}`,
    enabled: input.offered?.close === true && hand.kind !== "running",
  }));
  const text =
    hand.kind === "refused"
      ? `Not handed over. ${hand.reason}`
      : input.offered === undefined
        ? ORPHANED
        : heirs.length === 0
          ? `${ORPHANED} Close it, or start another Mate to hand it to.`
          : `${ORPHANED} Close it, or hand it to another Mate to go on with it.`;
  return { text, options };
}

/** One review policy for every client; absent pipeline evidence stays visibly unknown. */
export function changeReview(input: ChangeReviewInput): ChangeReviewModel {
  return {
    ...changeReviewModel(input),
    pipeline: changePipelineOf(input.pull),
    orphan: orphanOf(input),
  };
}

// ---------------------------------------------------------------------------
// A release
// ---------------------------------------------------------------------------

export type ReleaseOutcome =
  | { readonly kind: "offered" }
  | {
      readonly kind: "releasing";
      readonly progress?: string | undefined;
      /** How long it has been on its way, and that it takes longer than usual past that. */
      readonly clock?: string | undefined;
    }
  | { readonly kind: "released"; readonly at: string | undefined }
  /** HQ ended its follow without confirming the deploy's outcome. */
  | { readonly kind: "stalled"; readonly at: string | undefined }
  /**
   * A newer release HQ did not refuse sits above it: the release it followed is over, and `live`
   * is what production runs in full now.
   */
  | { readonly kind: "superseded"; readonly by: string; readonly live: string | undefined }
  | {
      readonly kind: "failed";
      readonly detail?: string | undefined;
      /** The services whose deploys failed, by the order the release lists them. */
      readonly services?: ReadonlyArray<string> | undefined;
      readonly at?: string | undefined;
    };

export interface ReleaseReviewInput {
  readonly git?: GitReleaseReviewFacts | undefined;
  /** The version it tags — the suggestion, or the tag on its way. */
  readonly tag: string;
  readonly gate: ReleaseGate;
  /** HQ's offer to this person, its refusal in words (`can`'s `release`); `undefined` unsaid. */
  readonly permission: ReleaseGate | undefined;
  /** How many changes go out; `undefined` while HQ has not said — never a count of none. */
  readonly changes: number | undefined;
  /** How many of them the stage that follows `main` runs; `undefined` with no such stage. */
  readonly onStage: { readonly total: number; readonly running: number } | undefined;
  /** The production services that redeploy. */
  readonly services: ReadonlyArray<string>;
  /**
   * What production ran as this one was offered — what it replaces, and where a roll back goes.
   * Held from the press (`holdReleaseFacts`): read after the release lands, production runs the
   * release itself.
   */
  readonly replaces: ReleaseReplaces;
  readonly outcome: ReleaseOutcome;
  /**
   * After a failure, whether production no longer runs what it replaced (`releaseStep`): a deploy
   * that moved some services before another failed leaves something to roll back from.
   */
  readonly productionMoved?: boolean | undefined;
  readonly now: number;
}

/**
 * What a release replaces: nothing, for the first one; the release production runs in full; or a
 * production no one release names — one whose deploy moved some services and failed in another.
 */
export type ReleaseReplaces =
  | { readonly kind: "first" }
  | { readonly kind: "release"; readonly tag: string }
  | { readonly kind: "unnamed" };

/** A release's review: its verdict and foot, the header's facts, and where to go if it goes wrong. */
export interface ReleaseReviewModel extends ReviewModel {
  readonly repositories?:
    | ReadonlyArray<GitReleaseRepository & { readonly expiry: string | undefined }>
    | undefined;

  /** Beside the title: `the first release`, `replaces v0.1.0`, and how many changes. */
  readonly meta: ReadonlyArray<string>;
  /** Where a roll back goes; `undefined` for the first release, which replaced nothing. */
  readonly ifWrong: string | undefined;
}

// Where a release goes on being said once its panel is closed: production's line on the card. The
// menu's row shows no more than a busy mark (the run read "the project's line in the menu").
const RELEASE_FOLLOWS = "You can close this. Production's line on the project's card follows it.";
/** What a release's foot says before the press: how long it takes, as measured — the run's
 *  first release went live in 98 s. */
export const RELEASE_TAKES = "It takes a minute or two.";
/** Past this, a release on its way says it takes longer than usual (`releaseOutcomeOf`). */
export const RELEASE_ESTIMATE_MS = 2 * 60_000;

function stageWhy(input: ReleaseReviewInput): string {
  const since =
    input.replaces.kind === "release" ? `since ${input.replaces.tag}` : "since the last release";
  const onStage = input.onStage;
  if (onStage === undefined || onStage.total === 0) {
    return input.changes === undefined
      ? `What merged ${since} is not known yet`
      : `${count(input.changes, "change", "changes")} merged ${since}`;
  }
  if (onStage.running >= onStage.total) {
    const all =
      onStage.total === 1
        ? "it"
        : onStage.total === 2
          ? "both changes"
          : `all ${String(onStage.total)} changes`;
    return `Stage runs ${all}`;
  }
  return `Stage runs ${String(onStage.running)} of ${count(onStage.total, "change", "changes")}`;
}

export function releaseReview(input: ReleaseReviewInput): ReleaseReviewModel {
  if (input.git !== undefined) return gitReleaseReview(input, input.git);
  const { tag, replaces } = input;
  // The release a roll back goes to — never the tag itself, which is a release read after it
  // landed; none for the first release, and production's menu for one no release names.
  // Offer no roll back based on an unknown outcome, a superseded release, or a failure that
  // moved nothing.
  const nothingWentOut =
    input.outcome.kind === "stalled" ||
    input.outcome.kind === "superseded" ||
    (input.outcome.kind === "failed" && input.productionMoved !== true);
  const back =
    replaces.kind === "first" || nothingWentOut
      ? undefined
      : replaces.kind === "release" && replaces.tag !== tag
        ? `roll back to ${replaces.tag} from production's menu`
        : "roll back from production's menu";
  const facts = {
    meta: [
      replaces.kind === "first"
        ? "the first release"
        : replaces.kind === "release"
          ? `replaces ${replaces.tag}`
          : "replaces what production runs",
      ...(input.changes === undefined ? [] : [count(input.changes, "change", "changes")]),
    ],
    ifWrong:
      back === undefined
        ? undefined
        : `${back.charAt(0).toUpperCase()}${back.slice(1)}. It gets its own review.`,
  };
  return { ...releaseVerdictOf(input, back), ...facts };
}

/** The same metadata warning on every Git surface, quiet while the token has over two weeks left. */
export function gitRemoteExpiry(remote: HqRepoRemote, now: number): string | undefined {
  const expiry = remote.expiresAt;
  return expiry != null && Date.parse(expiry) - now > 14 * 24 * 60 * 60 * 1_000
    ? undefined
    : tokenExpiryLabel(expiry, now);
}

/** The Git review formats HQ facts and the existing standing; it proves no receiver outcome. */
function gitReleaseReview(
  input: ReleaseReviewInput,
  git: GitReleaseReviewFacts,
): ReleaseReviewModel {
  const offered = input.outcome.kind === "offered";
  const roster = offered
    ? git.repositories
    : git.delivery?.repositories.map((repo): GitReleaseRepository => ({
        repository: repo.repo,
        sha: repo.sha,
        remote: git.repositories?.find((entry) => entry.repository === repo.repo)?.remote,
        included: repo.state !== "left-out",
        reason: repo.reason ?? undefined,
      }));
  const repositories = roster?.map((repo) => ({
    ...repo,
    expiry: repo.remote == null ? undefined : gitRemoteExpiry(repo.remote, input.now),
  }));
  const included = repositories?.filter((repo) => repo.included) ?? [];
  const meta = [
    input.replaces.kind === "first"
      ? "the first release"
      : input.replaces.kind === "release"
        ? `after ${input.replaces.tag}`
        : "after the last hand-over",
    count(included.length, "repository", "repositories"),
    ...(input.changes === undefined ? [] : [count(input.changes, "change", "changes")]),
  ];
  const facts = { meta, repositories, ifWrong: undefined };
  if (!offered) {
    const delivery = git.delivery;
    return {
      ...facts,
      verdict: {
        state:
          delivery?.standing === "pushing"
            ? "releasing"
            : delivery?.standing === "pushed"
              ? "released"
              : "release-stalled",
        tone:
          delivery?.standing === "pushing"
            ? "busy"
            : delivery?.standing === "pushed"
              ? "done"
              : "attention",
        title: delivery?.line ?? "Checking what HQ pushed…",
        why: delivery?.line ?? "Checking what HQ pushed…",
        fix: undefined,
      },
      consequence: "Mate's push is the hand-over. What happens next is up to that repository.",
      primary: undefined,
    };
  }
  const ready =
    input.gate.allowed && git.delivery?.release.allowed === true && git.preflight !== undefined;
  const primary: ReviewPrimary | undefined = ready
    ? { label: `Release ${input.tag}`, enabled: true, safe: false }
    : git.delivery?.release.actions.includes("replace-token") &&
        git.replaceTokenPermission?.allowed === true
      ? { label: "Replace token", enabled: true, safe: false }
      : undefined;
  const branch = git.attachment.target.branch;
  const destinations = included.map(
    (repo) => `${repo.repository} to ${repo.remote?.url} ${branch}`,
  );
  const next = included.length === 1 ? "that repository" : "those repositories";
  return {
    ...facts,
    verdict: {
      state: ready ? "release-ready" : "release-blocked",
      tone: ready ? "ok" : "attention",
      title: ready ? "Ready to release" : "Can't release now",
      why: ready
        ? input.changes === undefined
          ? "What merged since the last release is not known yet"
          : count(input.changes, "change", "changes") + " merged since the last release"
        : (!input.gate.allowed
            ? input.gate.reason
            : git.delivery?.release.allowed !== true
              ? (git.delivery?.release.reason ?? "Checking what can be released…")
              : (git.check ?? GIT_PREFLIGHT_PENDING)
          ).replace(/\.$/u, ""),
      fix: undefined,
    },
    consequence: ready
      ? `Mate pushes ${listed(destinations)}. What happens next is up to ${next}. Only Mate may write to ${branch}; a commit made there any other way stops Mate's pushes until you settle it.`
      : "Mate hasn't pushed this release. What happens after a push is up to that repository.",
    primary,
    secondary: { label: "Cancel", enabled: true },
  };
}

function releaseVerdictOf(input: ReleaseReviewInput, back: string | undefined): ReviewModel {
  const { tag, outcome } = input;
  const ran = input.replaces.kind === "release" ? input.replaces.tag : undefined;
  const keeps =
    ran !== undefined
      ? `Production keeps running ${ran}.`
      : input.replaces.kind === "first"
        ? "Nothing is released yet."
        : "Production keeps running what it runs.";
  switch (outcome.kind) {
    case "releasing":
      return {
        verdict: {
          state: "releasing",
          tone: "busy",
          title: `Releasing ${tag}`,
          why: outcome.progress ?? "Putting it live",
          fix: undefined,
        },
        consequence: RELEASE_FOLLOWS,
        primary: undefined,
      };
    case "released": {
      const age =
        outcome.at === undefined ? undefined : reviewAge(outcome.at, input.now)?.toLowerCase();
      return {
        verdict: {
          state: "released",
          tone: "done",
          title: `Released ${tag}`,
          // The age is the tag's: the landing's own moment is not read.
          why: age === undefined ? "Production runs it" : `Production runs it · released ${age}`,
          fix: undefined,
        },
        consequence:
          back === undefined
            ? `Production runs ${tag}.`
            : `Production runs ${tag}. If it misbehaves, ${back}.`,
        primary: undefined,
      };
    }
    case "failed": {
      const services = outcome.services ?? [];
      const what = `Production's release ${tag} failed${
        services.length === 0
          ? ""
          : services.length === 1
            ? ` in ${services[0]}'s deploy`
            : ` in the deploys of ${listed(services)}`
      }`;
      return {
        verdict: {
          state: "release-failed",
          tone: "failed",
          title: `${tag} didn't go out`,
          why: outcome.detail ?? "Its deploy failed",
          fix: {
            verb: "fix it",
            problem: {
              what,
              ...(outcome.at === undefined ? {} : { at: outcome.at }),
              ...(outcome.detail === undefined ? {} : { error: outcome.detail }),
              ask: "Find out why, fix it, and release again.",
            },
          },
        },
        consequence:
          ran === undefined
            ? "Production still runs what it ran before."
            : `Production still runs ${ran}.`,
        primary: undefined,
      };
    }
    case "stalled":
      return stalledModel({
        state: "release-stalled",
        tag,
        what: "release",
        at: outcome.at,
      });
    case "superseded":
      return supersededModel({ state: "release-superseded", tag, outcome });
    case "offered":
      break;
  }
  // A release reaches people outside the account: it takes a deliberate press — never the
  // review's first focus, never ⌘↵.
  const primary = {
    label: `Release ${tag}`,
    enabled: input.gate.allowed,
    safe: false,
  };
  // Still comparing what goes out: nothing is said of it, nor refused, until it is known (the
  // onboarding run opened on "Can't release now" and "0 changes" for 0.4 s), and the foot says
  // what a ready one says.
  if (!input.gate.allowed && input.gate.reason === RELEASE_CHECKING)
    return {
      verdict: {
        state: "release-blocked",
        tone: "busy",
        title: "Checking what goes out",
        why: "Waiting on HQ",
        fix: undefined,
      },
      consequence: RELEASE_TAKES,
      primary,
    };
  if (!input.gate.allowed) {
    const reason = input.gate.reason;
    const nothing = releaseNothingReason(input.gate) !== undefined;
    return {
      verdict: {
        state: "release-blocked",
        tone: nothing ? "done" : "attention",
        title: nothing
          ? "Nothing to release"
          : input.permission?.allowed === false
            ? "Only releasers can release"
            : "Can't release now",
        why: reason.replace(/\.$/u, ""),
        fix: undefined,
      },
      consequence: keeps,
      primary,
    };
  }
  return {
    verdict: {
      state: "release-ready",
      tone: "ok",
      title: "Ready to release",
      why: stageWhy(input),
      fix: undefined,
    },
    consequence: `Tags main as ${tag}. Production redeploys ${listed(input.services)} from it.`,
    primary,
  };
}

/**
 * HQ stopped following a tag without proving a landing or a failure. The platform may still be
 * deploying it, or already running it; ask the person's Mate to check the original deploy.
 */
function stalledModel(input: {
  readonly state: "release-stalled" | "rollback-stalled";
  /** The tag whose deploy outcome is unconfirmed. */
  readonly tag: string;
  readonly what: "release" | "roll back";
  readonly at: string | undefined;
}): ReviewModel {
  return {
    verdict: {
      state: input.state,
      tone: "attention",
      title: `Deploy status unknown for ${input.tag}`,
      why: "HQ couldn't confirm how the deploy ended",
      fix: {
        verb: "check it",
        problem: {
          what: `The deploy status of ${input.what} ${input.tag} is unknown`,
          ...(input.at === undefined ? {} : { at: input.at }),
          ask: "Check how the deploy ended in Zerops, and resolve anything that needs attention.",
        },
      },
    },
    consequence: "Check the deploy in Zerops.",
    primary: undefined,
  };
}

/**
 * A release a newer one followed: what is true — which release came after it, and what production
 * runs — and where the project's line goes from here. Nothing to press, nothing to ask: the newer
 * release is the one that moves production now.
 */
function supersededModel(input: {
  readonly state: "release-superseded" | "rollback-superseded";
  /** The tag the review followed. */
  readonly tag: string;
  readonly outcome: Extract<ReleaseOutcome, { readonly kind: "superseded" }>;
}): ReviewModel {
  const { by, live } = input.outcome;
  return {
    verdict: {
      state: input.state,
      tone: "quiet",
      title: `${by} was tagged after ${input.tag}`,
      why: live === undefined ? "No release runs in full on production" : `Production runs ${live}`,
      fix: undefined,
    },
    consequence: `The project's line in the menu follows ${by}.`,
    primary: undefined,
  };
}

// ---------------------------------------------------------------------------
// A roll back
// ---------------------------------------------------------------------------

export interface RollbackReviewInput {
  /** The two comparisons drawn in this review; confirmation waits for pending reads. */
  readonly comparisons: {
    readonly leaving: MovedCommits["state"] | "unrecorded";
    readonly comingBack: MovedCommits["state"] | "unrecorded";
  };
  /** The earlier release it goes back to. */
  readonly tag: string;
  /** The tag it makes, listing that release's commits — the one made, once it was. */
  readonly nextTag: string;
  /** The release production ran as the roll back was offered, held from the press. */
  readonly live: string | undefined;
  readonly services: ReadonlyArray<string>;
  /**
   * HQ's offer to this person, its refusal in words (`can`'s `release`): a rollback is a release.
   * `undefined` while HQ has not said, and HQ asks it again at the press.
   */
  readonly permission: ReleaseGate | undefined;
  /** The press: tagging, refused, or the tag made. */
  readonly press: ReviewPress;
  /**
   * Where the tag it made stands, as a release's does: HQ's record of it and production's
   * deploy decide, never the tag existing.
   */
  readonly outcome: ReleaseOutcome;
  readonly now: number;
}

export interface RollbackReviewModel extends ReviewModel {
  /**
   * Beside the title: what production runs as it goes back — `production runs v0.1.1` — and,
   * once it went back, what it replaced; `undefined` when it went back from a release not read.
   */
  readonly meta: string | undefined;
}

export function rollbackReview(input: RollbackReviewInput): RollbackReviewModel {
  const meta =
    input.live === undefined
      ? input.outcome.kind === "released"
        ? undefined
        : "production runs a later release"
      : input.outcome.kind === "released"
        ? `replaces ${input.live}`
        : `production runs ${input.live}`;
  return { ...rollbackVerdictOf(input), meta };
}

function rollbackVerdictOf(input: RollbackReviewInput): ReviewModel {
  const { tag, nextTag, outcome, press } = input;
  const keeps =
    input.live === undefined
      ? "Production keeps running what it runs."
      : `Production keeps running ${input.live}.`;
  // Production moves: a deliberate press, never the review's first focus, never ⌘↵.
  const permission = input.permission;
  const comparing =
    input.comparisons.leaving === "reading" || input.comparisons.comingBack === "reading";
  const primary = {
    label: `Roll back to ${tag}`,
    enabled: !comparing && permission?.allowed !== false,
    safe: false,
  };
  const onItsWay = (why: string): ReviewModel => ({
    verdict: {
      state: "rolling-back",
      tone: "busy",
      title: `Rolling back to ${tag}`,
      why,
      fix: undefined,
    },
    consequence: RELEASE_FOLLOWS,
    primary: undefined,
  });
  if (press.kind === "running") return onItsWay(`Preparing ${nextTag}`);
  if (press.kind === "refused") {
    return {
      verdict: {
        state: "rollback-refused",
        tone: "attention",
        title: "Didn't roll back",
        why: press.reason,
        fix: undefined,
      },
      consequence: keeps,
      primary,
    };
  }
  switch (outcome.kind) {
    // Its title says it rolls back: under it, how long — never "Putting v0.1.58 live", a tag the
    // person never asked for (the run's roll back).
    case "releasing":
      return onItsWay(outcome.clock ?? `Preparing ${nextTag}`);
    case "released": {
      const age =
        outcome.at === undefined ? undefined : reviewAge(outcome.at, input.now)?.toLowerCase();
      return {
        verdict: {
          state: "rolled-back",
          tone: "done",
          title: `Rolled back to ${tag}`,
          why: `Production runs its commits again, as ${nextTag}${age === undefined ? "" : ` · tagged ${age}`}`,
          fix: undefined,
        },
        consequence: `Production runs ${tag}'s commits again, as ${nextTag}.`,
        primary: undefined,
      };
    }
    case "superseded":
      return supersededModel({ state: "rollback-superseded", tag: nextTag, outcome });
    case "stalled":
      return stalledModel({
        state: "rollback-stalled",
        tag: nextTag,
        what: "roll back",
        at: outcome.at,
      });
    case "failed":
      return {
        verdict: {
          state: "rollback-failed",
          tone: "failed",
          title: `${nextTag} didn't go out`,
          why: outcome.detail ?? "Its deploy failed",
          fix: undefined,
        },
        consequence:
          input.live === undefined
            ? "Production still runs what it ran before."
            : `Production still runs ${input.live}.`,
        primary: undefined,
      };
    case "offered":
      break;
  }
  if (press.kind === "done") return onItsWay(`Preparing ${nextTag}`);
  if (permission?.allowed === false) {
    return {
      verdict: {
        state: "rollback-blocked",
        tone: "attention",
        title: "Only releasers can roll back",
        why: permission.reason.replace(/\.$/u, ""),
        fix: undefined,
      },
      consequence: keeps,
      primary,
    };
  }
  if (comparing) {
    return {
      verdict: {
        state: "checking",
        tone: "busy",
        title: "Comparing the rollback",
        why: "What leaves production and what comes back",
        fix: undefined,
      },
      consequence: keeps,
      primary,
    };
  }
  return {
    verdict: {
      state: "rollback-ready",
      tone: "quiet",
      title: `Goes back to ${tag}`,
      why:
        input.live === undefined
          ? "Production's newest release stays in the list"
          : `Production runs ${input.live} now`,
      fix: undefined,
    },
    consequence: `Tags main as ${nextTag} with ${tag}'s commits. Production redeploys ${listed(
      input.services,
    )} from them.`,
    primary,
  };
}

// ---------------------------------------------------------------------------
// A crew task
// ---------------------------------------------------------------------------

export interface CrewTaskReviewInput {
  /** The crewmate whose work it is. */
  readonly ownerName: string;
  /** The Mate whose code the work goes into: "Fen's code". */
  readonly mateName: string;
  /** The task's state as the crew's snapshot has it now — the only word on what happened. */
  readonly state: string;
  readonly check: {
    readonly state: "running" | "passed" | "failed";
    readonly output: string;
  } | null;
  readonly diffStat: { readonly insertions: number; readonly deletions: number } | null;
  /** The paths its copy conflicts on, when it does. */
  readonly conflicts: ReadonlyArray<string>;
  /** The Mate's edited paths its going in waits on. */
  readonly waitingOn: ReadonlyArray<string>;
  readonly landedCommit: string | null;
  /** Why it went to `rework` or `parked`, in the engine's words. */
  readonly reason?: string | null | undefined;
  readonly press?: ReviewPress | undefined;
  /**
   * The task's state when *Add to Fen's code* was pressed. The engine answering is not the work
   * going in — it answers too for work that waits on the Mate's edits, or stops — so until the
   * snapshot moves off this state it is on its way.
   */
  readonly pressedAt?: string | undefined;
}

/** The last line a check printed: what failed, in its own words. */
function lastLine(output: string): string | undefined {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1);
}

/** The states *Add what it has* takes: work its crewmate never reported, or work sent back. */
function landsNow(state: string): boolean {
  return state === "working" || state === "rework";
}

/** "Fen's", "Atlas'": whose code it goes into. */
const whose = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * A crew task's review: what its button does to the Mate's code — adds the
 * crewmate's work as one commit — in the person's words, never the engine's
 * (no "land", no "your tree", no "deliver").
 */
export function crewTaskReview(input: CrewTaskReviewInput): ReviewModel {
  const { ownerName: owner, mateName: mate, state } = input;
  const code = `${whose(mate)} code`;
  const shipped = `Nothing is shipped until ${mate} ships it.`;
  const press = input.press ?? { kind: "idle" };
  const lands = `Adds ${whose(owner)} work to ${code} as one commit. ${shipped}`;
  const landsNowSentence = `Commits what ${owner} has so far and adds it to ${code}. ${shipped}`;
  const now = landsNow(state);
  const label = now ? "Add what it has" : `Add to ${code}`;
  const consequence = now ? landsNowSentence : lands;
  const off = { label, enabled: false, safe: false };

  // Only the snapshot says the work went in: the press's answer comes for work that waits or stops too.
  if (state === "landed") {
    return {
      verdict: {
        state: "landed",
        tone: "done",
        title: `In ${code}`,
        why: `${mate} ships it with its own work`,
        fix: undefined,
      },
      consequence: shipped,
      primary: undefined,
    };
  }
  const onItsWay =
    press.kind === "running" ||
    (press.kind === "done" && input.pressedAt !== undefined && state === input.pressedAt);
  if (onItsWay || state === "landing" || state === "merging") {
    return {
      verdict: {
        state: "landing",
        tone: "busy",
        title: `Going into ${code}`,
        why:
          state === "merging"
            ? `${whose(owner)} copy takes in what's now in ${code} first`
            : `${whose(owner)} work goes into ${code}`,
        fix: undefined,
      },
      consequence,
      primary: off,
    };
  }
  if (press.kind === "refused") {
    return {
      verdict: {
        state: "land-refused",
        tone: "attention",
        title: "Not added",
        why: press.reason,
        fix: undefined,
      },
      consequence,
      primary: { label, enabled: true, safe: false },
    };
  }
  if (state === "parked") {
    return {
      verdict: {
        state: "land-parked",
        tone: "attention",
        title: "Stopped",
        why: input.reason ?? `${whose(owner)} task stopped where it was`,
        fix: undefined,
      },
      consequence: "Nothing goes in while it is stopped.",
      primary: undefined,
    };
  }
  if (state === "discarded") {
    return {
      verdict: {
        state: "land-discarded",
        tone: "done",
        title: "Dropped",
        why: `Its work never went into ${code}`,
        fix: undefined,
      },
      consequence: "Nothing goes in from dropped work.",
      primary: undefined,
    };
  }

  const blocked = (verdict: ReviewVerdict): ReviewModel => ({
    verdict,
    consequence: "It can go in once this is fixed.",
    primary: off,
  });
  if (input.conflicts.length > 0) {
    const where =
      input.conflicts.length <= 2
        ? listed(input.conflicts.map(baseName))
        : `${String(input.conflicts.length)} files`;
    return blocked({
      state: "land-conflict",
      tone: "attention",
      title: `Clashes with what's now in ${code}, in ${where}`,
      why: `${whose(owner)} copy can't take in what's now in ${code}`,
      fix: {
        verb: "sort it out",
        problem: {
          what: `${whose(owner)} copy clashes with what's now in ${code}, in ${listed(input.conflicts)}`,
          ask: "Sort out the clash in your copy and report back.",
        },
      },
    });
  }
  if (input.check?.state === "failed") {
    const line = lastLine(input.check.output);
    return blocked({
      state: "land-check-failed",
      tone: "failed",
      title: "Its checks fail",
      why: line ?? "Its check command failed",
      fix: {
        verb: "fix them",
        problem: {
          what: `${whose(owner)} checks fail`,
          ...(line === undefined ? {} : { error: line }),
          ask: "Find out why, fix it, and report back.",
        },
      },
    });
  }
  if (input.check?.state === "running" || state === "checking") {
    return blocked({
      state: "land-check-running",
      tone: "busy",
      title: "Checking its work",
      why: "It can go in once its checks pass",
      fix: undefined,
    });
  }
  if (state === "waiting-on-you" || input.waitingOn.length > 0) {
    // The button takes it from here once the edits are committed: it merges again first.
    return {
      verdict: {
        state: "land-waiting",
        tone: "attention",
        title:
          input.waitingOn.length === 0
            ? `Waits for ${whose(mate)} edits to be committed`
            : `Waits for ${whose(mate)} edits to ${listed(input.waitingOn.map(baseName))} to be committed`,
        why: `Once ${mate} commits them, it can go in`,
        fix: undefined,
      },
      consequence: lands,
      primary: { label: `Add to ${code}`, enabled: true, safe: false },
    };
  }
  if (now) {
    return {
      verdict: {
        state: "land-now",
        tone: "quiet",
        title: state === "rework" ? `${owner} is reworking it` : `${owner} is still on it`,
        why: state === "rework" ? (input.reason ?? "It was sent back") : "It hasn't said it's done",
        fix: undefined,
      },
      consequence,
      primary: { label, enabled: input.diffStat !== null, safe: false },
    };
  }
  const checked = input.check?.state === "passed" ? "its checks pass" : "no checks ran";
  if (state === "review") {
    return {
      verdict: {
        state: "land-review",
        tone: input.check?.state === "passed" ? "ok" : "quiet",
        title: "Reported done",
        why: `Adding it accepts it · ${checked}`,
        fix: undefined,
      },
      consequence: `Accepts ${whose(owner)} work and adds it to ${code} as one commit. ${shipped}`,
      primary: { label: `Add to ${code}`, enabled: true, safe: true },
    };
  }
  if (state === "ready") {
    // Its size is the line under the title's: said once.
    const why =
      input.check?.state === "passed"
        ? `Its checks pass · nothing waits on ${whose(mate)} edits`
        : `No checks ran · nothing waits on ${whose(mate)} edits`;
    return {
      verdict: {
        state: "land-ready",
        tone: "ok",
        title: `Done, not in ${code} yet`,
        why,
        fix: undefined,
      },
      consequence: lands,
      primary: { label: `Add to ${code}`, enabled: true, safe: true },
    };
  }
  // Not started, waiting on another task, or asking something: nothing to add yet.
  return {
    verdict: {
      state: "land-not-yet",
      tone: "quiet",
      title: "Nothing to add yet",
      why: state === "blocked" ? `${owner} asked something first` : `${owner} hasn't started it`,
      fix: undefined,
    },
    consequence: "Nothing goes in until it is done.",
    primary: undefined,
  };
}
