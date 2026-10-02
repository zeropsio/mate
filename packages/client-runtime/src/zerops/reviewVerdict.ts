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

import type { MergeabilityKind } from "./changeMergeability.ts";
import type { FlowPullRequestKind } from "./projectFlow.ts";
import type { RecipeReach } from "./recipeReach.ts";
import type { RecipeTier } from "./recipeTier.ts";
import {
  RELEASE_NOT_A_RELEASER,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type ReleaseGate,
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
  | "merging"
  | "merge-refused"
  | "merged"
  | "closed"
  | "release-ready"
  | "release-blocked"
  | "releasing"
  | "released"
  | "release-failed"
  | "rollback-ready"
  | "rollback-blocked"
  | "rolling-back"
  | "rolled-back"
  | "rollback-failed"
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

export interface ReviewModel {
  readonly verdict: ReviewVerdict;
  /** What pressing does, said beside the button — or, once it is over, where things stand. */
  readonly consequence: string;
  /** `undefined` where there is nothing left to press. */
  readonly primary: ReviewPrimary | undefined;
}

/** The press, as the caller holds it: running, refused with Gitea's words, or done. */
export type ReviewPress =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "done" };

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
    readonly kind: FlowPullRequestKind;
    readonly baseBranch: string;
    readonly mergeability: MergeabilityKind;
    readonly merged: boolean;
    readonly mergedAt: string | undefined;
    /** `closed` for one Gitea closed — merged, or never. */
    readonly state?: string | undefined;
    readonly mergeBase?: string | undefined;
    readonly baseSha?: string | undefined;
  };
  /** The Mate that wrote it; `undefined` for a person's own branch. */
  readonly mateName: string | undefined;
  /**
   * How far its files were read for the head it is at. Merge takes only a head whose change was
   * shown: it waits while they are read, and one that could not be read is merged only by a
   * deliberate press.
   */
  readonly readout: "reading" | "read" | "failed";
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
  /** How many changes landed on `main` since the branch was cut, where read. */
  readonly behindBy?: number | undefined;
  /** Where `main` goes next: a production a release puts it in front of, a stage that follows it. */
  readonly downstream: { readonly production: boolean; readonly stage: boolean };
  /** Once merged: how many changes wait for production now, and what production runs. */
  readonly waiting?: { readonly count: number; readonly live: string | undefined } | undefined;
  /**
   * A release is offered once a code change merged: the next review is the release's. A recipe
   * change is never released — a release tags the code in the service repositories.
   */
  readonly releaseOffered?: boolean | undefined;
  /**
   * For a recipe change, what merging it does to the project (`recipeReach`), once its files are
   * read; `undefined` until then.
   */
  readonly recipe?: RecipeReach | undefined;
  readonly press?: ReviewPress | undefined;
  readonly now: number;
}

/** `Squash-merges 3 commits into main as one.` */
function squashSentence(
  pull: ChangeReviewInput["pull"],
  commits: number | undefined,
  behindBy: number | undefined,
  unshown: boolean,
): string {
  const what =
    commits === undefined ? "it" : commits === 1 ? "1 commit" : `${String(commits)} commits`;
  const asOne = commits !== undefined && commits > 1 ? " as one" : "";
  const unseen = unshown ? " without its files shown" : "";
  const onTop =
    behindBy === undefined || behindBy === 0
      ? ""
      : `, on top of ${count(behindBy, "change", "changes")} it wasn't checked with`;
  return `Squash-merges ${what} into ${pull.baseBranch}${asOne}${unseen}${onTop}.`;
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
    reach.declarations ? "The project deploys to the environments it declares." : undefined,
    gainers === undefined && !reach.declarations ? unchanged : undefined,
    later.length === 0
      ? undefined
      : `${capitalized(either(later))} added later is made from the new recipe.`,
  );
}

/** What a recipe change's merge did, in the few words after its age. */
function recipeNext(reach: RecipeReach | undefined, base: string): string {
  if (reach === undefined) return `it's on ${base}`;
  const gainers = recipeGainers(reach);
  if (gainers === undefined) {
    return reach.declarations
      ? "the project deploys to what it declares"
      : "no environment changes";
  }
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

/** The change's own verdict, before anything was pressed. */
function changeVerdictOf(input: ChangeReviewInput): {
  readonly verdict: ReviewVerdict;
  readonly enabled: boolean;
} {
  const { pull } = input;
  const base = pull.baseBranch;
  const who = input.mateName ?? "this";

  if (pull.mergeability === "conflicting") {
    const files = input.conflict?.files ?? [];
    const resolve: ReviewFix = {
      verb: "resolve it",
      problem: {
        what:
          files.length === 0
            ? `Pull request #${String(pull.number)} no longer merges cleanly into ${base}`
            : `Pull request #${String(pull.number)} conflicts with ${base} in ${listed(files.map(baseName))}`,
        ask: `Rebase it on ${base}, resolve the conflicts, and push.`,
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
    const age = by?.at === undefined ? undefined : reviewAge(by.at, input.now)?.toLowerCase();
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
        why: "Gitea works it out again after every push",
        fix: undefined,
      },
    };
  }

  const commits =
    input.commits === undefined ? undefined : count(input.commits, "commit", "commits");
  const moved =
    pull.mergeBase !== undefined && pull.baseSha !== undefined && pull.mergeBase !== pull.baseSha;
  if (moved) {
    const landed =
      input.behindBy === undefined || input.behindBy === 0
        ? `${base} moved on`
        : `${count(input.behindBy, "change", "changes")} landed on ${base}`;
    return {
      enabled: true,
      verdict: {
        state: "behind-clean",
        tone: "attention",
        title: `Behind ${base}`,
        why: `${landed} since ${who} branched · it still merges cleanly`,
        fix: {
          verb: "update it",
          problem: {
            what: `Pull request #${String(pull.number)} is behind ${base}`,
            ask: `Bring it up to date with ${base}, check it still works, and push.`,
          },
        },
      },
    };
  }

  // Quiet, not green: no signal about a change is not a good signal.
  return {
    enabled: true,
    verdict: {
      state: "ready",
      tone: "quiet",
      title: "Ready to merge",
      why: [`No conflicts with ${base}`, commits].filter((part) => part !== undefined).join(" · "),
      fix: undefined,
    },
  };
}

export function changeReview(input: ChangeReviewInput): ReviewModel {
  const { pull } = input;
  const base = pull.baseBranch;
  const press = input.press ?? { kind: "idle" };

  if (pull.merged || press.kind === "done") {
    const age =
      pull.mergedAt === undefined
        ? "Just now"
        : (reviewAge(pull.mergedAt, input.now) ?? "Just now");
    const waiting = input.waiting?.count ?? 0;
    const recipe = pull.kind === "recipe";
    const next = recipe
      ? recipeNext(input.recipe, base)
      : input.downstream.production && waiting > 0
        ? `${count(waiting, "change now waits", "changes now wait")} for production`
        : input.downstream.stage
          ? "the stage picks it up"
          : `it's on ${base}`;
    const live = input.waiting?.live;
    const consequence = recipe
      ? recipeSentence(input.recipe)
      : input.downstream.production
        ? live === undefined
          ? "Production isn't touched until you release."
          : `Production still serves ${live} until you release.`
        : input.downstream.stage
          ? `The stage picks it up from ${base}.`
          : `It's on ${base} now.`;
    return {
      verdict: {
        state: "merged",
        tone: "done",
        title: `Merged into ${base}`,
        why: `${age} · ${next}`,
        fix: undefined,
      },
      consequence,
      // A recipe is never released: the next review is a code change's release, and only its.
      primary:
        !recipe && input.releaseOffered === true
          ? { label: REVIEW_RELEASE_LABEL, enabled: true, safe: true }
          : undefined,
    };
  }

  if (pull.state === "closed") {
    return {
      verdict: {
        state: "closed",
        tone: "done",
        title: "Closed without merging",
        why: "Somebody closed it in Gitea; its branch is still there",
        fix: undefined,
      },
      consequence: `It never reached ${base}; nothing merges from here.`,
      primary: undefined,
    };
  }

  const verdictOf = changeVerdictOf(input);
  const { verdict } = verdictOf;
  // A head whose files are still being read was not shown: it waits for them.
  const enabled = verdictOf.enabled && input.readout !== "reading";
  const squash = sentences(
    squashSentence(
      pull,
      input.commits,
      verdict.state === "behind-clean" ? input.behindBy : undefined,
      input.readout === "failed",
    ),
    afterMain(input),
  );
  const waits: Partial<Record<ReviewState, string>> = {
    behind: "Merging waits until the conflict is resolved.",
    conflict: "Merging waits until the conflict is resolved.",
    checking: "Merging waits until Gitea knows it merges cleanly.",
  };
  // What holds it back, said beside it: the change's own trouble, or — for a change nothing is
  // wrong with — its files still being read, which Merge waits for.
  const held = verdictOf.enabled
    ? input.readout === "reading"
      ? "Merging waits until its files are read."
      : squash
    : (waits[verdict.state] ?? squash);

  if (press.kind === "running") {
    return {
      verdict: {
        state: "merging",
        tone: "busy",
        title: `Merging into ${base}`,
        why:
          input.commits === undefined
            ? `Squashing #${String(pull.number)}`
            : `Squashing ${count(input.commits, "commit", "commits")} into one`,
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
    };
  }
  // Behind main is amber, and a change whose files could not be read was never shown: both
  // still pressable, never pressed for the person.
  const safeOnceRead = verdictOf.enabled && verdict.state !== "behind-clean";
  return {
    verdict,
    consequence: held,
    primary: {
      label: "Merge",
      enabled,
      safe: safeOnceRead && input.readout === "read",
      ...(safeOnceRead && input.readout === "reading" ? { shortcut: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// A release
// ---------------------------------------------------------------------------

export type ReleaseOutcome =
  | { readonly kind: "offered" }
  | { readonly kind: "releasing"; readonly progress?: string | undefined }
  | { readonly kind: "released"; readonly at: string | undefined }
  | {
      readonly kind: "failed";
      readonly detail?: string | undefined;
      /** The service whose deploy failed. */
      readonly service?: string | undefined;
      readonly at?: string | undefined;
    };

export interface ReleaseReviewInput {
  /** The version it tags — the suggestion, or the tag on its way. */
  readonly tag: string;
  readonly gate: ReleaseGate;
  /** How many changes go out. */
  readonly changes: number;
  /** How many of them the stage that follows `main` runs; `undefined` with no such stage. */
  readonly onStage: { readonly total: number; readonly running: number } | undefined;
  /** The production services that redeploy. */
  readonly services: ReadonlyArray<string>;
  /** The release production runs now. */
  readonly live: string | undefined;
  readonly outcome: ReleaseOutcome;
  readonly now: number;
}

const RELEASE_FOLLOWS = "You can close this. The project's line in the menu follows the release.";

function stageWhy(input: ReleaseReviewInput): string {
  const since = input.live === undefined ? "since the last release" : `since ${input.live}`;
  const onStage = input.onStage;
  if (onStage === undefined || onStage.total === 0) {
    return `${count(input.changes, "change", "changes")} merged ${since}`;
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

export function releaseReview(input: ReleaseReviewInput): ReviewModel {
  const { tag, outcome } = input;
  const keeps =
    input.live === undefined
      ? "Production keeps running what it runs."
      : `Production keeps running ${input.live}.`;
  switch (outcome.kind) {
    case "releasing":
      return {
        verdict: {
          state: "releasing",
          tone: "busy",
          title: `Releasing ${tag}`,
          why: outcome.progress ?? "Production redeploys from the tag",
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
          why: age === undefined ? "Production runs it" : `Production runs it · ${age}`,
          fix: undefined,
        },
        consequence: `Production runs ${tag}. If it misbehaves, roll back from production's menu.`,
        primary: undefined,
      };
    }
    case "failed": {
      const what = `Production's release ${tag} failed${outcome.service === undefined ? "" : ` in ${outcome.service}'s deploy`}`;
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
          input.live === undefined
            ? "Production still runs what it ran before."
            : `Production still runs ${input.live}.`,
        primary: undefined,
      };
    }
    case "offered":
      break;
  }
  // A release reaches people outside the account: it takes a deliberate press — never the
  // review's first focus, never ⌘↵.
  const primary = { label: `Release ${tag}`, enabled: input.gate.allowed, safe: false };
  if (!input.gate.allowed) {
    const reason = input.gate.reason;
    const nothing = reason === RELEASE_NOTHING_MERGED || reason === RELEASE_NOTHING_NEW_ON_MAIN;
    return {
      verdict: {
        state: "release-blocked",
        tone: nothing ? "done" : "attention",
        title: nothing
          ? "Nothing to release"
          : reason === RELEASE_NOT_A_RELEASER
            ? "Only releasers can release"
            : "Can't release now",
        why:
          reason === RELEASE_NOT_A_RELEASER
            ? "An owner or an admin of the organization can"
            : reason.replace(/\.$/u, ""),
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

// ---------------------------------------------------------------------------
// A roll back
// ---------------------------------------------------------------------------

export interface RollbackReviewInput {
  /** The earlier release it goes back to. */
  readonly tag: string;
  /** The tag it makes, listing that release's commits — the one made, once it was. */
  readonly nextTag: string;
  readonly live: string | undefined;
  readonly services: ReadonlyArray<string>;
  readonly mayRelease: boolean;
  /** The press: tagging, refused, or the tag made. */
  readonly press: ReviewPress;
  /**
   * Where the tag it made stands, as a release's does: the broker's verdict and production's
   * deploy decide, never the tag existing.
   */
  readonly outcome: ReleaseOutcome;
  readonly now: number;
}

export function rollbackReview(input: RollbackReviewInput): ReviewModel {
  const { tag, nextTag, outcome, press } = input;
  const keeps =
    input.live === undefined
      ? "Production keeps running what it runs."
      : `Production keeps running ${input.live}.`;
  // Production moves: a deliberate press, never the review's first focus, never ⌘↵.
  const primary = { label: `Roll back to ${tag}`, enabled: input.mayRelease, safe: false };
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
  if (press.kind === "running") return onItsWay(`Tagging main as ${nextTag}`);
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
    case "releasing":
      return onItsWay(outcome.progress ?? `Production redeploys from ${nextTag}`);
    case "released": {
      const age =
        outcome.at === undefined ? undefined : reviewAge(outcome.at, input.now)?.toLowerCase();
      return {
        verdict: {
          state: "rolled-back",
          tone: "done",
          title: `Rolled back to ${tag}`,
          why: `Production runs its commits again, as ${nextTag}${age === undefined ? "" : ` · ${age}`}`,
          fix: undefined,
        },
        consequence: `Production runs ${tag}'s commits again, as ${nextTag}.`,
        primary: undefined,
      };
    }
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
  if (press.kind === "done") return onItsWay(`Production redeploys from ${nextTag}`);
  if (!input.mayRelease) {
    return {
      verdict: {
        state: "rollback-blocked",
        tone: "attention",
        title: "Only releasers can roll back",
        why: "An owner or an admin of the organization can",
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
