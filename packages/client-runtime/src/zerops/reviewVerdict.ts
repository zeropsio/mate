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

import type { MergeabilityKind } from "./forge/mergeState.ts";
import type { GitCheckRow, GitCheckTone } from "./gitTab.ts";
import type { FlowPullRequestKind } from "./projectFlow.ts";
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
  | "unchecked"
  | "behind-clean"
  | "behind"
  | "conflict"
  | "checks-failed"
  | "checks-running"
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
    readonly checks: GitCheckTone;
    readonly checkRows?: ReadonlyArray<GitCheckRow> | undefined;
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
   * shown: nothing merges while they are read, and one that could not be read is merged only by
   * a deliberate press.
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
  /** A release is offered once it merged: the next review is the release's. */
  readonly releaseOffered?: boolean | undefined;
  readonly press?: ReviewPress | undefined;
  readonly now: number;
}

/** The checks' part of a verdict's why: what they came to, in two or three words. */
function checksPart(checks: GitCheckTone): string {
  switch (checks) {
    case "passing":
      return "Checks passed";
    case "none":
      return "No checks ran";
    case "pending":
      return "Checks running";
    case "failing":
      return "Checks failing";
  }
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

/** What happens once `main` has it, as far as anything downstream goes. */
function afterMain(input: ChangeReviewInput): string | undefined {
  if (input.pull.kind === "recipe") return "The project's environments change to match.";
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
  const rows = pull.checkRows ?? [];
  const change = `pull request #${String(pull.number)}`;

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

  if (pull.checks === "failing") {
    const failed = rows.filter((row) => row.tone === "failed");
    const names = failed.map((row) => row.name);
    const said = failed.find((row) => row.description !== undefined)?.description;
    return {
      enabled: false,
      verdict: {
        state: "checks-failed",
        tone: "failed",
        title:
          names.length === 0
            ? "Checks failing"
            : names.length <= 2
              ? `Checks failing: ${listed(names)}`
              : `${String(names.length)} checks failing`,
        why: said ?? "It can't land until they pass",
        fix: {
          verb: "fix it",
          problem: {
            what:
              names.length === 0
                ? `The checks on ${change} are failing`
                : `The checks on ${change} are failing: ${listed(names)}`,
            ...(said === undefined ? {} : { error: said }),
            ask: "Find out why, fix them, and push.",
          },
        },
      },
    };
  }

  if (pull.checks === "pending") {
    const running = rows.filter((row) => row.tone === "busy").map((row) => row.name);
    return {
      enabled: false,
      verdict: {
        state: "checks-running",
        tone: "busy",
        title:
          running.length === 0
            ? "Checks running"
            : running.length <= 2
              ? `Checks running: ${listed(running)}`
              : `${String(running.length)} checks running`,
        why: "Merging waits for them",
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

  const unchecked = pull.checks === "none";
  return {
    enabled: true,
    verdict: {
      state: unchecked ? "unchecked" : "ready",
      tone: unchecked ? "quiet" : "ok",
      title: "Ready to merge",
      why: [checksPart(pull.checks), `no conflicts with ${base}`, commits]
        .filter((part) => part !== undefined)
        .join(" · "),
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
    const next =
      pull.kind === "recipe"
        ? "the environments change to match"
        : input.downstream.production && waiting > 0
          ? `${count(waiting, "change now waits", "changes now wait")} for production`
          : input.downstream.stage
            ? "the stage picks it up"
            : `it's on ${base}`;
    const live = input.waiting?.live;
    const consequence =
      pull.kind === "recipe"
        ? "The project's environments change to match."
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
      primary:
        input.releaseOffered === true
          ? { label: "Review release", enabled: true, safe: true }
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
    "checks-failed": "Merging waits until the checks pass.",
    "checks-running": "Merging waits for the checks to finish.",
    checking: "Merging waits until Gitea knows it merges cleanly.",
  };
  // What holds it back: the change's own trouble first, then its files still being read.
  const held = verdictOf.enabled
    ? "Merging waits until the change is read."
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
  return {
    verdict,
    consequence: enabled ? squash : held,
    // Behind main is amber, and a change whose files could not be read was never shown: both
    // still pressable, never pressed for the person.
    primary: {
      label: "Merge",
      enabled,
      safe: enabled && verdict.state !== "behind-clean" && input.readout === "read",
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
  /** `about 3 minutes`, where the last release's deploy says how long one takes. */
  readonly eta?: string | undefined;
  readonly baseBranch?: string | undefined;
  readonly now: number;
}

const RELEASE_FOLLOWS = "You can close this. Production's chip in the menu follows the release.";

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
  const base = input.baseBranch ?? "main";
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
    consequence: `Tags ${base} as ${tag}. Production redeploys ${listed(input.services)} from it${
      input.eta === undefined ? "" : `, ${input.eta}`
    }.`,
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
  readonly eta?: string | undefined;
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
    )} from them${input.eta === undefined ? "" : `, ${input.eta}`}.`,
    primary,
  };
}

// ---------------------------------------------------------------------------
// A crew task
// ---------------------------------------------------------------------------

export interface CrewTaskReviewInput {
  /** The crewmate whose work it is. */
  readonly ownerName: string;
  /** The task's state as the crew's snapshot has it now — the only word on what happened. */
  readonly state: string;
  readonly check: {
    readonly state: "running" | "passed" | "failed";
    readonly output: string;
  } | null;
  readonly diffStat: { readonly insertions: number; readonly deletions: number } | null;
  /** The paths its copy conflicts on, when it does. */
  readonly conflicts: ReadonlyArray<string>;
  /** Your tree's edited paths its landing waits on. */
  readonly waitingOn: ReadonlyArray<string>;
  readonly landedCommit: string | null;
  /** Why it went to `rework` or `parked`, in the engine's words. */
  readonly reason?: string | null | undefined;
  readonly press?: ReviewPress | undefined;
  /**
   * The task's state when Land was pressed. The engine answering is not the task landing — it
   * answers too for a landing that waits on the person's edits, or parks — so until the snapshot
   * moves off this state the landing is on its way.
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

/** The states Land now takes: work its crewmate never reported, or work sent back. */
function landsNow(state: string): boolean {
  return state === "working" || state === "rework";
}

export function crewTaskReview(input: CrewTaskReviewInput): ReviewModel {
  const { ownerName: owner, state } = input;
  const press = input.press ?? { kind: "idle" };
  const lands = `Lands ${owner}'s work in your tree as one commit. Nothing is pushed until you deliver.`;
  const landsNowSentence = `Commits what ${owner} has so far and lands it in your tree. Nothing is pushed until you deliver.`;
  const now = landsNow(state);
  const label = now ? "Land now" : "Land";
  const consequence = now ? landsNowSentence : lands;
  const off = { label, enabled: false, safe: false };

  // Only the snapshot says a task landed: Land's answer comes for one that waits or parks too.
  if (state === "landed") {
    const short = input.landedCommit?.slice(0, 7);
    return {
      verdict: {
        state: "landed",
        tone: "done",
        title: short === undefined ? "Landed" : `Landed as ${short}`,
        why: "In your tree · delivering ships it",
        fix: undefined,
      },
      consequence: "Nothing is pushed until you deliver.",
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
        title: "Landing",
        why:
          state === "merging"
            ? `${owner}'s copy takes in what landed first`
            : `${owner}'s work goes into your tree`,
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
        title: "Not landed",
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
        title: "Parked",
        why: input.reason ?? `${owner}'s task stopped where it was`,
        fix: undefined,
      },
      consequence: "Nothing lands while it is parked.",
      primary: undefined,
    };
  }
  if (state === "discarded") {
    return {
      verdict: {
        state: "land-discarded",
        tone: "done",
        title: "Discarded",
        why: "Its work never went into your tree",
        fix: undefined,
      },
      consequence: "Nothing lands from a discarded task.",
      primary: undefined,
    };
  }

  const blocked = (verdict: ReviewVerdict): ReviewModel => ({
    verdict,
    consequence: "Landing waits until it is fixed.",
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
      title: `Conflicts with what landed in ${where}`,
      why: `${owner}'s copy stopped merging in what landed`,
      fix: {
        verb: "resolve it",
        problem: {
          what: `${owner}'s copy conflicts with what landed in ${listed(input.conflicts)}`,
          ask: "Resolve the conflicts and report back.",
        },
      },
    });
  }
  if (input.check?.state === "failed") {
    const line = lastLine(input.check.output);
    return blocked({
      state: "land-check-failed",
      tone: "failed",
      title: "Check failing",
      why: line ?? "Its check command failed",
      fix: {
        verb: "fix it",
        problem: {
          what: `${owner}'s check failed`,
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
      title: "Check running",
      why: "Landing waits for it",
      fix: undefined,
    });
  }
  if (state === "waiting-on-you" || input.waitingOn.length > 0) {
    // Land takes it from here once the edits are committed: it merges again first.
    return {
      verdict: {
        state: "land-waiting",
        tone: "attention",
        title:
          input.waitingOn.length === 0
            ? "Waits on your edits"
            : `Waits on your edits to ${listed(input.waitingOn.map(baseName))}`,
        why: "Commit them locally, then land it",
        fix: undefined,
      },
      consequence: lands,
      primary: { label: "Land", enabled: true, safe: false },
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
  const checked = input.check?.state === "passed" ? "check passed" : "no check ran";
  if (state === "review") {
    return {
      verdict: {
        state: "land-review",
        tone: input.check?.state === "passed" ? "ok" : "quiet",
        title: "Reported done",
        why: `Landing accepts it · ${checked}`,
        fix: undefined,
      },
      consequence: `Accepts ${owner}'s work and lands it in your tree as one commit. Nothing is pushed until you deliver.`,
      primary: { label: "Land", enabled: true, safe: true },
    };
  }
  if (state === "ready") {
    // Its size is the line under the title's: said once.
    const why =
      input.check?.state === "passed"
        ? "Check passed · nothing waits on your edits"
        : "No check ran · nothing waits on your edits";
    return {
      verdict: { state: "land-ready", tone: "ok", title: "Ready to land", why, fix: undefined },
      consequence: lands,
      primary: { label: "Land", enabled: true, safe: true },
    };
  }
  // Not started, waiting on another task, or asking something: nothing to land yet.
  return {
    verdict: {
      state: "land-not-yet",
      tone: "quiet",
      title: "Nothing to land yet",
      why: state === "blocked" ? `${owner} asked something first` : `${owner} hasn't started it`,
      fix: undefined,
    },
    consequence: "Nothing lands until it is done.",
    primary: undefined,
  };
}
