/**
 * *Put it live*: the one step from a Mate's first result to an app people can open (the golden
 * path's G6 → G7 → G8). One sheet says what goes live and where; one press merges the change when
 * it still waits, makes the project's production and releases to it; one row in the conversation
 * says how far it got, its words replacing each other in place; and it ends on the live app — its
 * address, Copy link, the release it runs.
 *
 * It replaces the path the onboarding run walked: a question after the merge (*Add stage* / *Add
 * production* / *Not now*) that left the conversation for the projects page, a two-page form
 * that asked again what it had been told, a checklist on the page, a *Review release* door offered
 * before production could take one, and a release sheet that ended on *Put it on your domain*.
 * Stage stays a later choice, from the project.
 *
 * Pure: what is offered, what the sheet says, and where a run goes next, from the facts the
 * surfaces read. The writes are the host's (`PutLiveHost`).
 */
import { creationHandoff } from "@t3tools/client-runtime/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  changeMergeVerdict,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type ChangeReviewInput,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";

/** The change a run carries live: merged first when it still waits. */
export interface PutLiveChange {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /** The head the sheet showed: one pushed since is never merged from here. */
  readonly head: string | undefined;
  readonly merged: boolean;
}

/** Where a run stands: one step at a time, never two at once. */
export type PutLivePhase = "merging" | "creating" | "releasing" | "live" | "failed";

export interface PutLiveFailure {
  /** The cause, in the person's words (HQ's or the platform's where they said it). */
  readonly words: string;
  /**
   * The one thing that fixes it: try the step again, read the change it could not merge, or open
   * the project, where a production half made is finished.
   */
  readonly action: "again" | "see-code" | "project";
  /** The source's own words, folded under Details. */
  readonly detail?: string | undefined;
}

export interface PutLiveRun {
  /** The organization it was pressed in: driven only while that one is shown. */
  readonly orgId: string;
  readonly groupId: string;
  /** The project's name: "Putting Shop Front live". */
  readonly project: string;
  readonly change: PutLiveChange | undefined;
  readonly phase: PutLivePhase;
  /** The step a failure stopped at: what *Try again* runs. */
  readonly failedAt?: Exclude<PutLivePhase, "live" | "failed"> | undefined;
  /** The Zerops project production runs in, once made. */
  readonly productionId?: string | undefined;
  /** The release it made — or, `adopted`, the one someone else had on its way, which it waits for. */
  readonly tag?: string | undefined;
  readonly adopted?: boolean | undefined;
  /** When production was made, or *Try again* pressed after: what its patience counts from. */
  readonly since?: number | undefined;
  readonly failure?: PutLiveFailure | undefined;
  /** When the run went live. */
  readonly liveAt?: number | undefined;
}

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

/**
 * Whether *Put it live* is offered: only while the project has no production in any state (held,
 * half-made, being made) and the person may add one — production first; with a production, a
 * change goes live by its release.
 */
export function putLiveOffered(input: {
  readonly productionHeld: boolean;
  readonly addable: { readonly production: boolean } | undefined;
}): boolean {
  return !input.productionHeld && input.addable?.production === true;
}

/** A change as the flow reads it, as far as its merge verdict goes. */
export type PutLiveMergePull = ChangeReviewInput["pull"];

/**
 * Whether *Put it live* may merge the change in its one press: only where the review's own Merge
 * would (`changeMergeVerdict`) — never past required checks that failed, still run or are unknown,
 * nor a change HQ still judges or that holds nothing. Held, it says the review's verdict, and the
 * review is where it moves on. A change merged already, or none, holds nothing.
 */
export function putLiveMergeGate(input: {
  readonly pull: PutLiveMergePull | undefined;
}): { readonly kind: "open" } | { readonly kind: "held"; readonly words: string } {
  const { pull } = input;
  if (pull === undefined || pull.merged) return { kind: "open" };
  // The verdict's title is all it says here: its Mate and its age are the review's to word.
  const { enabled, verdict } = changeMergeVerdict({ pull, mateName: "", now: 0 });
  return enabled ? { kind: "open" } : { kind: "held", words: verdict.title };
}

/** Why *Put it live* waits while another environment of the page is being set up. */
export const PUT_LIVE_AFTER_CREATION = "Another environment is being set up first.";

/**
 * What a project's door to an environment it lacks says: production's puts the app live, in one
 * step (`PutLiveHost`); a stage's adds it, from the project's form.
 */
export function environmentDoorLabel(tier: "stage" | "production", name: string): string {
  return tier === "production" ? "Put it live" : `Add ${name.toLocaleLowerCase()}`;
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface PutLiveSheetModel {
  readonly title: string;
  /**
   * What goes live: the change's title and at most three plain lines of what it does; `undefined`
   * while what is merged is read, the sheet standing in for it and its button waiting.
   */
  readonly what: { readonly title: string; readonly lines: ReadonlyArray<string> } | undefined;
  readonly where: { readonly name: string; readonly line: string };
  /** Stage, offered for later — never asked now. */
  readonly later: string;
  readonly button: string;
  /** Why the button waits, where it does: the setup files being read, or none to make it from. */
  readonly hold: string | undefined;
}

const MAX_LINES = 3;

/**
 * At most three plain lines of what a change does, from its description: its bullets first, else
 * its sentences — no headings, pictures, code or Markdown marks.
 */
export function putLiveLines(description: string | undefined): ReadonlyArray<string> {
  if (description === undefined) return [];
  const lines: Array<string> = [];
  const bullets: Array<string> = [];
  let fenced = false;
  for (const raw of description.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || line === "" || line.startsWith("#") || line.startsWith(">")) continue;
    if (/^!\[[^\]]*\]\([^)]*\)$/u.test(line)) continue;
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    const text = plain(bullet === null ? line : (bullet[1] ?? ""));
    if (text === "") continue;
    (bullet === null ? lines : bullets).push(text);
  }
  return (bullets.length > 0 ? bullets : lines).slice(0, MAX_LINES);
}

function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__)(.*?)\1/gu, "$2")
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/gu, "$1$2")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

export const PUT_LIVE_LATER = "Want somewhere to test first? Add a stage later from the project.";
const RECIPE_READING = "Reading how the project runs…";
export const SETUP_MISSING =
  "The project has no setup files for production yet: ask the Mate to add them.";
export const SETUP_UNREADABLE = "The project's setup files can't be read right now.";

const NOTHING_MERGED = "Nothing is merged to put live yet.";
const MERGE_FIRST = "Merge a change first: what is merged goes live.";

const PUT_LIVE_WHERE = {
  name: "Production",
  line: "Its own public address, ready in a few minutes.",
};

/**
 * The sheet, from what goes live: the change it was asked from — or, asked from the project, what
 * is merged, newest first: one change in its own words, several by their titles. Painted once in
 * its final shape: while what is merged is read, it stands in for it and says nothing it takes back.
 */
export function putLiveSheet(input: {
  readonly project: string;
  /** `undefined` while what is merged is read. */
  readonly changes:
    | ReadonlyArray<{
        readonly title: string;
        readonly description?: string | undefined;
      }>
    | undefined;
  /** The production recipe, as read (`useZeropsGroupRecipe`). */
  readonly recipe: "loading" | "present" | "absent" | "unreadable";
}): PutLiveSheetModel {
  const { changes } = input;
  if (changes === undefined)
    return {
      title: `Put ${input.project} live`,
      what: undefined,
      where: PUT_LIVE_WHERE,
      later: PUT_LIVE_LATER,
      button: "Put it live",
      hold: undefined,
    };
  const [first] = changes;
  const what =
    first === undefined
      ? { title: NOTHING_MERGED, lines: [] }
      : changes.length === 1
        ? { title: first.title, lines: putLiveLines(first.description) }
        : {
            title: `${changes.length} changes`,
            lines: changes.slice(0, MAX_LINES).map((change) => change.title),
          };
  return {
    title: `Put ${input.project} live`,
    what,
    where: PUT_LIVE_WHERE,
    later: PUT_LIVE_LATER,
    button: "Put it live",
    hold:
      first === undefined
        ? MERGE_FIRST
        : input.recipe === "present"
          ? undefined
          : input.recipe === "loading"
            ? RECIPE_READING
            : input.recipe === "absent"
              ? SETUP_MISSING
              : SETUP_UNREADABLE,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A run, pressed: the change merged first when it still waits, else production made at once. */
export function startPutLive(input: {
  readonly orgId: string;
  readonly groupId: string;
  readonly project: string;
  readonly change: PutLiveChange | undefined;
}): PutLiveRun {
  return {
    orgId: input.orgId,
    groupId: input.groupId,
    project: input.project,
    change: input.change,
    phase: input.change !== undefined && !input.change.merged ? "merging" : "creating",
  };
}

/** What a run's step came to; each moves it on, or stops it with the cause. */
export type PutLiveEvent =
  | { readonly kind: "merged" }
  | { readonly kind: "created"; readonly productionId: string; readonly at?: number | undefined }
  | {
      readonly kind: "released";
      readonly tag: string;
      /** Someone else's release, already on its way: the run waits for it rather than make one. */
      readonly adopted?: boolean | undefined;
    }
  | { readonly kind: "live"; readonly at: number }
  | {
      readonly kind: "failed";
      readonly words: string;
      /** A production half made is finished from its project, never made twice from here. */
      readonly halfMade?: boolean | undefined;
      /** The way on, where the step knows it better than its phase does. */
      readonly action?: PutLiveFailure["action"] | undefined;
      readonly detail?: string | undefined;
    }
  | { readonly kind: "again"; readonly at?: number | undefined };

export function putLiveStep(run: PutLiveRun, event: PutLiveEvent): PutLiveRun {
  switch (event.kind) {
    case "merged":
      return run.phase === "merging"
        ? {
            ...run,
            phase: "creating",
            change: run.change === undefined ? undefined : { ...run.change, merged: true },
          }
        : run;
    case "created":
      return run.phase === "creating"
        ? { ...run, productionId: event.productionId, since: event.at }
        : run;
    case "released":
      return run.phase === "creating"
        ? {
            ...run,
            phase: "releasing",
            tag: event.tag,
            ...(event.adopted === true ? { adopted: true } : {}),
          }
        : run;
    case "live":
      return run.phase === "releasing" ? { ...run, phase: "live", liveAt: event.at } : run;
    case "failed":
      return run.phase === "live" || run.phase === "failed"
        ? run
        : {
            ...run,
            phase: "failed",
            failedAt: run.phase,
            failure: {
              words: event.words,
              // A change HQ would not merge is read, not merged again blindly.
              action:
                event.action ??
                (run.phase === "merging"
                  ? "see-code"
                  : event.halfMade === true
                    ? "project"
                    : "again"),
              ...(event.detail === undefined ? {} : { detail: event.detail }),
            },
          };
    case "again":
      if (run.phase !== "failed" || run.failedAt === undefined) return run;
      return {
        ...run,
        failedAt: undefined,
        failure: undefined,
        ...(event.at === undefined ? {} : { since: event.at }),
        // A release that did not go out is made again once production takes one.
        ...(run.failedAt === "releasing"
          ? { phase: "creating", tag: undefined, adopted: undefined }
          : { phase: run.failedAt }),
      };
  }
}

export const PUT_LIVE_NO_ANSWER = "No answer came back.";

/**
 * A step's write, as the run takes it: what its answer came to — or, where the write threw and no
 * answer came, a failure with the source's words folded and the way on its caller knows: *Try
 * again* for a merge or a release, which nothing took; the project for a production, which may be
 * half made and is never made twice from here. A run never stays on a step whose write is gone.
 */
export async function putLiveSettle<T>(
  write: () => Promise<T>,
  settle: (answer: T) => PutLiveEvent,
  thrown: PutLiveFailure["action"],
): Promise<PutLiveEvent> {
  try {
    return settle(await write());
  } catch (cause) {
    return {
      kind: "failed",
      words: PUT_LIVE_NO_ANSWER,
      action: thrown,
      detail: zeropsErrorMessage(cause),
    };
  }
}

/** What the project's flow says now, as far as a run needs it. */
export interface PutLiveFacts {
  /** The production HQ holds now, by its Zerops project; `undefined` while it holds none. */
  readonly production: string | undefined;
  readonly gate: ReleaseGate;
  readonly releases: ReadonlyArray<{
    readonly tag: string;
    readonly standing: "live" | "deploy-failed" | undefined;
    readonly verdict?: string | undefined;
    readonly detail?: string | undefined;
  }>;
}

/** What a run waits for next, read off the flow: nothing yet, a release to make, or its end. */
export type PutLiveNext =
  | { readonly kind: "wait" }
  | { readonly kind: "release" }
  /** Someone else's release of it is on its way, or went live meanwhile: the run ends on that. */
  | { readonly kind: "adopt"; readonly tag: string }
  | { readonly kind: "live" }
  | {
      readonly kind: "failed";
      readonly words: string;
      readonly action?: PutLiveFailure["action"] | undefined;
    };

/**
 * How long a run waits for HQ to offer production's first release once production is made: what
 * waiting will change — HQ listing production, reading what it can release — comes in seconds;
 * past this, it stops and says so, with *Try again*.
 */
export const PUT_LIVE_PATIENCE = 3 * 60_000;

const UNUSABLE_TOKEN = /^A repository has no usable token\b/u;
const IN_FLIGHT = /^Releasing (.+)…$/u;
const OFFER_UNKNOWN = "Release offer is unknown.";

/** When a run waiting for its release stops waiting; `undefined` where nothing counts down. */
export function putLiveDeadline(run: PutLiveRun): number | undefined {
  return run.phase === "creating" && run.productionId !== undefined && run.since !== undefined
    ? run.since + PUT_LIVE_PATIENCE
    : undefined;
}

export function putLiveNext(run: PutLiveRun, facts: PutLiveFacts, now?: number): PutLiveNext {
  if (run.phase === "creating") {
    // The production this run made, once HQ holds it — never another that came up meanwhile — and
    // only what waiting will not change stops it (`creationHandoff`).
    const hasProduction = run.productionId !== undefined && facts.production === run.productionId;
    const verdict = creationHandoff({ hasProduction, gate: facts.gate });
    if (verdict === "open") return { kind: "release" };
    if (facts.gate.allowed) return { kind: "wait" };
    const { reason } = facts.gate;
    if (hasProduction) {
      const inFlight = IN_FLIGHT.exec(reason)?.[1];
      if (inFlight !== undefined) return { kind: "adopt", tag: inFlight };
      const live = facts.releases.find((entry) => entry.standing === "live");
      if (reason === RELEASE_NOTHING_NEW_ON_MAIN && live !== undefined)
        return { kind: "adopt", tag: live.tag };
      if (UNUSABLE_TOKEN.test(reason)) return { kind: "failed", words: reason, action: "project" };
    }
    if (verdict === "drop") return { kind: "failed", words: reason };
    const deadline = putLiveDeadline(run);
    if (deadline === undefined || now === undefined || now <= deadline) return { kind: "wait" };
    return {
      kind: "failed",
      words: !hasProduction
        ? "HQ hasn't listed the new production yet."
        : reason === OFFER_UNKNOWN
          ? "HQ didn't say whether production can take a release."
          : reason,
      action: "again",
    };
  }
  if (run.phase === "releasing" && run.tag !== undefined) {
    const row = facts.releases.find((entry) => entry.tag === run.tag);
    if (row?.standing === "live") return { kind: "live" };
    if (row?.standing === "deploy-failed")
      return { kind: "failed", words: `${run.tag} didn't go out: its deploy failed.` };
    if (row?.verdict === "refused")
      return { kind: "failed", words: row.detail ?? `HQ refused ${run.tag}.` };
  }
  return { kind: "wait" };
}

/**
 * Whether a run holds the project's release doors: production it is making is released by the run
 * once it can take a release, so no door asks the person to release it meanwhile.
 */
export function putLiveHoldsRelease(run: Pick<PutLiveRun, "phase"> | undefined): boolean {
  return run?.phase === "merging" || run?.phase === "creating";
}

// ---------------------------------------------------------------------------
// The row in the conversation
// ---------------------------------------------------------------------------

/** The one wait row's words: its title, and the step under way, replaced in place. */
export function putLiveProgress(run: PutLiveRun): {
  readonly title: string;
  readonly step: string;
} {
  const title = `Putting ${run.project} live`;
  switch (run.phase) {
    case "merging":
      return { title, step: "Merging the change" };
    case "creating":
      return { title, step: "Making production" };
    case "releasing":
      return {
        title,
        step:
          run.tag === undefined
            ? "Releasing"
            : run.adopted === true
              ? `Waiting for ${run.tag}, already on its way`
              : `Releasing ${run.tag}`,
      };
    case "live":
      return { title: `${run.project} is live`, step: releasedLine(run.tag) };
    case "failed":
      return {
        title: `${run.project} isn't live yet`,
        step: run.failure?.words ?? "Something went wrong.",
      };
  }
}

function releasedLine(tag: string | undefined): string {
  return tag === undefined ? "Released" : `Released ${tag}`;
}

/** The live card's second line: "Released v0.1.0 · just now". */
export function putLiveReleased(run: PutLiveRun, nowMs: number): string {
  const line = releasedLine(run.tag);
  if (run.liveAt === undefined) return line;
  const minutes = Math.floor((nowMs - run.liveAt) / 60_000);
  const age =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min ago`
        : `${Math.floor(minutes / 60)} h ago`;
  return `${line} · ${age}`;
}

/** The address the live card leads with: production's first, without its scheme. */
export function putLiveAddress(
  addresses: ReadonlyArray<{ readonly url: string }>,
): { readonly url: string; readonly host: string } | undefined {
  const first = addresses[0];
  if (first === undefined) return undefined;
  return { url: first.url, host: first.url.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "") };
}
