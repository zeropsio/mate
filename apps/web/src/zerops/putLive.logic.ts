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
import type { ReleaseGate } from "@t3tools/client-runtime/zerops";

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
}

export interface PutLiveRun {
  readonly groupId: string;
  /** The project's name: "Putting Shop Front live". */
  readonly project: string;
  readonly change: PutLiveChange | undefined;
  readonly phase: PutLivePhase;
  /** The step a failure stopped at: what *Try again* runs. */
  readonly failedAt?: Exclude<PutLivePhase, "live" | "failed"> | undefined;
  /** The Zerops project production runs in, once made. */
  readonly productionId?: string | undefined;
  /** The release it made. */
  readonly tag?: string | undefined;
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

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export interface PutLiveSheetModel {
  readonly title: string;
  /** What goes live: the change's title and at most three plain lines of what it does. */
  readonly what: { readonly title: string; readonly lines: ReadonlyArray<string> };
  readonly where: { readonly name: string; readonly line: string };
  /** Stage, offered for later — never asked now. */
  readonly later: string;
  readonly button: string;
  /** Why the button waits, where it does: the recipe being read, or none to make it from. */
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
const RECIPE_MISSING = "The project has no production recipe yet: ask the Mate to add one.";
const RECIPE_UNREADABLE = "The project's recipe can't be read right now.";

export function putLiveSheet(input: {
  readonly project: string;
  readonly change: { readonly title: string; readonly description?: string | undefined };
  /** The production recipe, as read (`useZeropsGroupRecipe`). */
  readonly recipe: "loading" | "present" | "absent" | "unreadable";
}): PutLiveSheetModel {
  return {
    title: `Put ${input.project} live`,
    what: { title: input.change.title, lines: putLiveLines(input.change.description) },
    where: {
      name: "Production",
      line: "Its own public address, ready in a few minutes.",
    },
    later: PUT_LIVE_LATER,
    button: "Put it live",
    hold:
      input.recipe === "present"
        ? undefined
        : input.recipe === "loading"
          ? RECIPE_READING
          : input.recipe === "absent"
            ? RECIPE_MISSING
            : RECIPE_UNREADABLE,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A run, pressed: the change merged first when it still waits, else production made at once. */
export function startPutLive(input: {
  readonly groupId: string;
  readonly project: string;
  readonly change: PutLiveChange | undefined;
}): PutLiveRun {
  return {
    groupId: input.groupId,
    project: input.project,
    change: input.change,
    phase: input.change !== undefined && !input.change.merged ? "merging" : "creating",
  };
}

/** What a run's step came to; each moves it on, or stops it with the cause. */
export type PutLiveEvent =
  | { readonly kind: "merged" }
  | { readonly kind: "created"; readonly productionId: string }
  | { readonly kind: "released"; readonly tag: string }
  | { readonly kind: "live"; readonly at: number }
  | {
      readonly kind: "failed";
      readonly words: string;
      /** A production half made is finished from its project, never made twice from here. */
      readonly halfMade?: boolean | undefined;
    }
  | { readonly kind: "again" };

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
      return run.phase === "creating" ? { ...run, productionId: event.productionId } : run;
    case "released":
      return run.phase === "creating" ? { ...run, phase: "releasing", tag: event.tag } : run;
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
                run.phase === "merging"
                  ? "see-code"
                  : event.halfMade === true
                    ? "project"
                    : "again",
            },
          };
    case "again":
      if (run.phase !== "failed" || run.failedAt === undefined) return run;
      // A release that did not go out is made again once production takes one.
      return run.failedAt === "releasing"
        ? { ...run, phase: "creating", tag: undefined, failedAt: undefined, failure: undefined }
        : { ...run, phase: run.failedAt, failedAt: undefined, failure: undefined };
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
  | { readonly kind: "live" }
  | { readonly kind: "failed"; readonly words: string };

export function putLiveNext(run: PutLiveRun, facts: PutLiveFacts): PutLiveNext {
  if (run.phase === "creating") {
    // The production this run made, once HQ holds it — never another that came up meanwhile — and
    // only what waiting will not change stops it (`creationHandoff`).
    const verdict = creationHandoff({
      hasProduction: run.productionId !== undefined && facts.production === run.productionId,
      gate: facts.gate,
    });
    if (verdict === "open") return { kind: "release" };
    return verdict === "drop" && !facts.gate.allowed
      ? { kind: "failed", words: facts.gate.reason }
      : { kind: "wait" };
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
      return { title, step: run.tag === undefined ? "Releasing" : `Releasing ${run.tag}` };
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
