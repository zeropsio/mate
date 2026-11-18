/**
 * *Put it live*: the one step from a Mate's first result to an app people can open (the golden
 * path's G6 → G7 → G8). One sheet says what goes live and where — what is merged — one press makes
 * the project's production and releases to it; one row in the conversation
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
import {
  creationHandoff,
  type HqReleaseReview,
  type ReleaseVaultView,
} from "@t3tools/client-runtime/data";
import type { ProductionShape, ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  productionProjectOf,
  releaseFailure,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type EnvironmentCreationOutcome,
  type ReleaseFailure,
  type ReleaseGate,
  isPlatformSubdomain,
  recipeTierRunning,
  recipeTierServiceTypes,
  type ZeropsCorePackage,
  serviceTypeWords,
} from "@t3tools/client-runtime/zerops";

/** Where a run stands: one step at a time, never two at once. */
export type PutLivePhase = "creating" | "releasing" | "live" | "failed";

export interface PutLiveFailure {
  /** The cause, in the person's words (HQ's or the platform's where they said it). */
  readonly words: string;
  /**
   * The one thing that fixes it: try the step again, open the project, where a production half
   * made is finished — or, production made and not released (a reload stopped the run), release
   * to it.
   */
  readonly action: "again" | "project" | "release";
  /**
   * The project, offered beside *Try again*: production is made, and its services can be looked
   * at there while the run goes on from it.
   */
  readonly alsoProject?: true | undefined;
  /** The source's own words, folded under Details. */
  readonly detail?: string | undefined;
}

export interface PutLiveRun {
  /** The organization it was pressed in: driven only while that one is shown. */
  readonly orgId: string;
  readonly groupId: string;
  /** The project's name: "Putting Shop Front live". */
  readonly project: string;
  readonly phase: PutLivePhase;
  /** The step a failure stopped at: what *Try again* runs. */
  readonly failedAt?: Exclude<PutLivePhase, "live" | "failed"> | undefined;
  /** The Zerops project production runs in, from the moment the platform took it. */
  readonly productionId?: string | undefined;
  /**
   * Production's project exists and its creation still goes on — its services awaited, by a wait
   * of its own that is bounded: the run releases only once that creation ended.
   */
  readonly making?: true | undefined;
  /** The release it made — or, `adopted`, the one someone else had on its way, which it waits for. */
  readonly tag?: string | undefined;
  readonly adopted?: boolean | undefined;
  /** When production was made, or *Try again* pressed after: what its patience counts from. */
  readonly since?: number | undefined;
  readonly failure?: PutLiveFailure | undefined;
  /**
   * When what it runs was released, as HQ dates the release (`putLiveLandedAt`) — the age its live
   * card counts, as the release's review does; when it was seen live where HQ dates none.
   */
  readonly liveAt?: number | undefined;
  /** When the step under way began: what the wait row's clock counts from. */
  readonly stepAt?: number | undefined;
  /** The release a followed roll back goes back to: it is said as that, never as going live. */
  readonly rollsBackTo?: string | undefined;
  /**
   * The services the pressed sheet named, by hostname: what the press approves production's first
   * release to create (`putLiveReviewed`). A run without them creates nothing unseen.
   */
  readonly approves?: ReadonlyArray<string> | undefined;
  /**
   * Who the person said production is for: the core package its project is born on and the shape
   * HQ creates its services in (`putLiveCorePackage`). A run without one makes it as the setup
   * files say.
   */
  readonly shape?: ProductionShape | undefined;
}

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

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
  readonly where: {
    readonly name: string;
    readonly line: string;
    /**
     * What production gets, from the project's setup files: each service the press creates,
     * billed by Zerops — the press approves them, so the sheet names them (HQ refuses a release
     * that creates services nobody saw). `undefined` while the setup files are read.
     */
    readonly creates: ReadonlyArray<PutLiveService> | undefined;
    /**
     * Who production is for, asked before anything is made: each answer with what it makes. Empty
     * where there is nothing to make it from; `undefined` while the setup files are read.
     */
    readonly shapes: ReadonlyArray<PutLiveShapeChoice> | undefined;
    /** The answer picked; none is picked for the person. */
    readonly shape: ProductionShape | undefined;
  };
  /** Stage, offered for later — never asked now. */
  readonly later: string;
  readonly button: string;
  /** Why the button waits, where it does: the setup files being read, or none to make it from. */
  readonly hold: string | undefined;
  /** Pressed here: the run is under way and the button says so (`putLiveSheetUnderWay`). */
  readonly busy?: true | undefined;
}

/** One answer to who production is for, and what it makes, in the person's words. */
export interface PutLiveShapeChoice {
  readonly shape: ProductionShape;
  readonly title: string;
  readonly line: string;
  /** How many copies run and on which core package: the difference in what it costs, truly said. */
  readonly meta: string;
}

/** A service the press creates in production: its hostname, and what it runs in people's words. */
export interface PutLiveService {
  readonly hostname: string;
  /** "PostgreSQL 18", "Bun 1.4", "Object storage". */
  readonly kind: string;
}

const MAX_LINES = 3;

/**
 * At most three plain lines of what a change does, from its description: its bullets first — each
 * by the name it leads with ("Tea finder — pick a blend by mood…" → "Tea finder"), the
 * review saying the rest — else its sentences; no headings, pictures, code or Markdown marks.
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
    if (bullet === null) lines.push(text);
    else bullets.push(/^(.{2,48}?)(?:\s[—–-]\s|:\s)/u.exec(text)?.[1] ?? text);
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
export const CHOOSE_SHAPE = "Choose who it's for";
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
  /** The services the recipe creates in production; `undefined` while it is read. */
  readonly creates?: ReadonlyArray<PutLiveService> | undefined;
  /** Who production may be for, from the recipe (`putLiveShapes`); `undefined` while it is read. */
  readonly shapes?: ReadonlyArray<PutLiveShapeChoice> | undefined;
  readonly shape?: ProductionShape | undefined;
}): PutLiveSheetModel {
  const { changes } = input;
  const shapes = input.recipe === "loading" ? undefined : (input.shapes ?? []);
  const where = {
    ...PUT_LIVE_WHERE,
    creates: input.recipe === "loading" ? undefined : (input.creates ?? []),
    shapes,
    shape: input.shape,
  };
  if (changes === undefined)
    return {
      title: `Put ${input.project} live`,
      what: undefined,
      where,
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
    where,
    later: PUT_LIVE_LATER,
    button: "Put it live",
    hold:
      first === undefined
        ? MERGE_FIRST
        : input.recipe === "present"
          ? shapes !== undefined && shapes.length > 0 && input.shape === undefined
            ? CHOOSE_SHAPE
            : undefined
          : input.recipe === "loading"
            ? RECIPE_READING
            : input.recipe === "absent"
              ? SETUP_MISSING
              : SETUP_UNREADABLE,
  };
}

/**
 * The sheet while its project's run is under way: pressed here, its button says it is going live
 * for the moment the sheet stays; a run somebody started before the sheet opened is already on its
 * way, and its button waits.
 */
export function putLiveSheetUnderWay(
  model: PutLiveSheetModel,
  input: { readonly pressedHere: boolean },
): PutLiveSheetModel {
  return input.pressedHere
    ? { ...model, button: "Putting it live…", busy: true, hold: undefined }
    : { ...model, hold: "It's already on its way." };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A run, pressed: production made at once, what is merged released to it. */
export function startPutLive(input: {
  readonly orgId: string;
  readonly groupId: string;
  readonly project: string;
  /** When it was pressed. */
  readonly at?: number | undefined;
  /** The services the sheet named when it was pressed. */
  readonly approves?: ReadonlyArray<string> | undefined;
  /** Who the person said production is for. */
  readonly shape?: ProductionShape | undefined;
}): PutLiveRun {
  return {
    orgId: input.orgId,
    groupId: input.groupId,
    project: input.project,
    phase: "creating",
    ...(input.at === undefined ? {} : { stepAt: input.at }),
    ...(input.approves === undefined ? {} : { approves: input.approves }),
    ...(input.shape === undefined ? {} : { shape: input.shape }),
  };
}

/** What a run's step came to; each moves it on, or stops it with the cause. */
export type PutLiveEvent =
  /** The platform took production's project: the run knows it from here, while its creation goes on. */
  | { readonly kind: "accepted"; readonly productionId: string }
  /** Production's creation ended, its services settled: its patience for the release counts from `at`. */
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
      readonly alsoProject?: true | undefined;
      readonly detail?: string | undefined;
    }
  | { readonly kind: "again"; readonly at?: number | undefined };

/**
 * Where an event moves a run; `now`, where given, starts the clock of a step it moves the run to.
 */
export function putLiveStep(run: PutLiveRun, event: PutLiveEvent, now?: number): PutLiveRun {
  const next = moved(run, event);
  return now === undefined || next === run || next.phase === run.phase
    ? next
    : { ...next, stepAt: now };
}

function moved(run: PutLiveRun, event: PutLiveEvent): PutLiveRun {
  switch (event.kind) {
    case "accepted":
      return run.phase === "creating" && run.productionId === undefined
        ? { ...run, productionId: event.productionId, making: true }
        : run;
    case "created":
      return run.phase === "creating"
        ? { ...run, productionId: event.productionId, since: event.at, making: undefined }
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
            making: undefined,
            failure: {
              words: event.words,
              action: event.action ?? (event.halfMade === true ? "project" : "again"),
              ...(event.alsoProject === true ? { alsoProject: true } : {}),
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

/** How production's creation ended, as `useEnvironmentCreation` says it. */
type PutLiveCreationRun =
  | { readonly kind: "refused"; readonly reason: string | null }
  | { readonly kind: "ran"; readonly outcome: EnvironmentCreationOutcome };

/**
 * What production's creation came to, for the run: made, its patience counting from `at`; stopped
 * while its services were awaited — production made and registered — a stop *Try again* goes on
 * from to its release, the project offered beside it; stopped where a production may be half
 * made, its project the way on, never a second one made from here.
 */
export function putLiveCreation(made: PutLiveCreationRun, at: number): PutLiveEvent {
  if (made.kind === "refused")
    return { kind: "failed", words: made.reason ?? "Production couldn't be made." };
  const { outcome } = made;
  if (outcome.ok) return { kind: "created", productionId: outcome.projectId, at };
  if (outcome.failedStep.kind === "await-ready" && outcome.projectId !== undefined)
    return { kind: "failed", words: outcome.error, action: "again", alsoProject: true };
  return {
    kind: "failed",
    words: outcome.error,
    halfMade: outcome.projectId !== undefined || outcome.uncertain === true,
  };
}

/** What the project's flow says now, as far as a run needs it. */
export interface PutLiveFacts {
  /** The production HQ holds now, by its Zerops project; `undefined` while it holds none. */
  readonly production: string | undefined;
  readonly gate: ReleaseGate;
  /** Newest first. */
  readonly releases: ReadonlyArray<{
    readonly tag: string;
    readonly standing: "live" | "deploy-failed" | undefined;
    /** When HQ made it: what a release followed from its way out counts from. */
    readonly taggedAt?: string | undefined;
    /** The release it rolls production back to, where it is a roll back. */
    readonly rollbackOf?: string | undefined;
  }>;
  /** How the release `tag` did not go through, with HQ's words (`releaseFailure`). */
  readonly failure: (tag: string) => ReleaseFailure | undefined;
}

/** What a run reads of the project's flow. */
export function putLiveFactsOf(flow: ZeropsProjectFlow): PutLiveFacts {
  return {
    production: productionProjectOf(flow.environments),
    gate: flow.release.gate,
    releases: flow.releases,
    failure: (tag) => {
      const release = flow.releases.find((entry) => entry.tag === tag);
      return release === undefined
        ? undefined
        : releaseFailure(release, {
            environmentInputs: flow.environmentInputs,
            stalled: flow.release.stalled,
          });
    },
  };
}

/** What a run waits for next, read off the flow: nothing yet, a release to make, or its end. */
type PutLiveNext =
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

/**
 * When a run waiting for its release stops waiting; `undefined` where nothing counts down here —
 * while production is still made, its creation's own bounded wait for its services counts down.
 */
export function putLiveDeadline(run: PutLiveRun): number | undefined {
  return run.phase === "creating" &&
    run.productionId !== undefined &&
    run.making !== true &&
    run.since !== undefined
    ? run.since + PUT_LIVE_PATIENCE
    : undefined;
}

/**
 * When a run's release was made, as HQ dates it: what its live card's age counts from, whenever and
 * however often the page sees it live — the run's conversation read "just now" for minutes, its age
 * counted from when the page last came to it. `seenAt` where HQ dates none.
 */
export function putLiveLandedAt(run: PutLiveRun, facts: PutLiveFacts, seenAt: number): number {
  return releasedAt(facts.releases.find((entry) => entry.tag === run.tag)?.taggedAt) ?? seenAt;
}

function releasedAt(taggedAt: string | undefined): number | undefined {
  const at = taggedAt === undefined ? Number.NaN : Date.parse(taggedAt);
  return Number.isNaN(at) ? undefined : at;
}

export function putLiveNext(run: PutLiveRun, facts: PutLiveFacts, now?: number): PutLiveNext {
  if (run.phase === "creating") {
    // Production's services are still awaited: nothing is released to them before they are up.
    if (run.making === true) return { kind: "wait" };
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
    const failure = facts.failure(run.tag);
    if (failure !== undefined) return { kind: "failed", words: putLiveFailureWords(failure) };
  }
  return { kind: "wait" };
}

/** A release that did not go through, in the row's words: HQ's, where it said any. */
function putLiveFailureWords(failure: ReleaseFailure): string {
  const { tag, error } = failure;
  const why = error?.replace(/\.$/u, "");
  switch (failure.kind) {
    case "deploy-failed":
      return `${tag} didn't go out: ${why ?? "its deploy failed"}.`;
    case "refused":
      return error ?? `HQ refused ${tag}.`;
    case "stalled":
      return why === undefined
        ? `Deploy status unknown for ${tag}: check it in Zerops.`
        : `${tag} didn't go live: ${why}.`;
  }
}

/**
 * Whether a run holds the project's release doors: production it is making is released by the run
 * once it can take a release, so no door asks the person to release it meanwhile.
 */
export function putLiveHoldsRelease(run: Pick<PutLiveRun, "phase"> | undefined): boolean {
  return run?.phase === "creating";
}

// ---------------------------------------------------------------------------
// The row in the conversation
// ---------------------------------------------------------------------------

/**
 * The one wait row's words: its title, and the step under way, replaced in place — with, while it
 * runs, when that step began, which its clock counts from.
 */
export function putLiveProgress(run: PutLiveRun): {
  readonly title: string;
  readonly step: string;
  readonly since?: number;
} {
  const title =
    run.rollsBackTo === undefined
      ? `Putting ${run.project} live`
      : `Rolling back to ${run.rollsBackTo}`;
  const since = run.stepAt === undefined ? {} : { since: run.stepAt };
  switch (run.phase) {
    case "creating":
      return { title, step: "Making production", ...since };
    case "releasing":
      return {
        title,
        ...since,
        step:
          run.tag === undefined
            ? "Releasing"
            : run.adopted === true
              ? `Waiting for ${run.tag}, already on its way`
              : `Releasing ${run.tag}`,
      };
    case "live":
      return { title: `${run.project} is live`, step: releasedLine(run) };
    case "failed":
      return {
        title: `${run.project} isn't live yet`,
        step: run.failure?.words ?? "Something went wrong.",
      };
  }
}

function releasedLine(run: Pick<PutLiveRun, "tag" | "rollsBackTo">): string {
  if (run.rollsBackTo !== undefined) return `Rolled back to ${run.rollsBackTo}`;
  return run.tag === undefined ? "Released" : `Released ${run.tag}`;
}

/**
 * Whether the run needs a line of its own on production: not while it releases and the project's
 * flow already says that release on its way (`inFlight`) — production's line carries it then,
 * with the run's clock, once (the reviewer read "Releasing v0.1.2" twice, one under the other).
 */
export function putLiveOwnLine(
  run: Pick<PutLiveRun, "phase">,
  inFlight: string | undefined,
): boolean {
  return !(run.phase === "releasing" && inFlight !== undefined);
}

/**
 * A run on its project's row in the menu, wherever the person is: under way, its step's words on
 * hover; stopped, why. Nothing once live (production says it) or with no run.
 */
export function putLiveMark(
  run: PutLiveRun | undefined,
):
  | { readonly kind: "releasing"; readonly tip: string }
  | { readonly kind: "failed"; readonly tip: string }
  | undefined {
  if (run === undefined || run.phase === "live") return undefined;
  const progress = putLiveProgress(run);
  return run.phase === "failed"
    ? { kind: "failed", tip: `${progress.title}: ${progress.step}` }
    : { kind: "releasing", tip: progress.step };
}

/** The live card's second line: "Released v0.1.0 · just now", "Rolled back to v0.1.0 · 3 min ago". */
export function putLiveReleased(run: PutLiveRun, nowMs: number): string {
  const line = releasedLine(run);
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

/**
 * The address the live card leads with, without its scheme: production's own domain where it has
 * one — what its people open — else its first address, the platform's.
 */
export function putLiveAddress(
  addresses: ReadonlyArray<{ readonly url: string }>,
): { readonly url: string; readonly host: string } | undefined {
  const first = addresses.find((address) => !isPlatformSubdomain(address.url)) ?? addresses[0];
  if (first === undefined) return undefined;
  return { url: first.url, host: first.url.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "") };
}

// ---------------------------------------------------------------------------
// After a reload
// ---------------------------------------------------------------------------

/** The project's flow as a run resumed from it reads it: what runs, and what is on its way. */
export interface PutLiveFlowFacts extends PutLiveFacts {
  /** The release on its way to production, by its tag. */
  readonly inFlight: string | undefined;
  /** The version the next release takes. */
  readonly suggestion: string;
}

/**
 * What the conversation draws of a project's release where no run of this tab is under way:
 *
 * - `follow` — a run to keep, which the host drives: a release on its way, followed to its live
 *   address wherever it was pressed; or one that went live while the page was away.
 * - `stopped` — production the person's own *Put it live* made (`kept`, the one fact the browser
 *   keeps of it) and nothing released to it: said from the flow on every read, with *Release*
 *   one press away. Nothing is released without that press.
 * - `forget` — that production is gone or another stands: the attempt is no longer the person's.
 * - `reading` — the attempt is known and the flow not yet: the strip holds its room.
 */
type PutLiveResumed =
  | { readonly kind: "none" }
  | { readonly kind: "reading" }
  | { readonly kind: "forget" }
  | { readonly kind: "stopped"; readonly run: PutLiveRun }
  | { readonly kind: "follow"; readonly run: PutLiveRun };

const NONE = { kind: "none" } as const;

export function putLiveResumed(input: {
  readonly orgId: string;
  readonly groupId: string;
  readonly project: string;
  /** This tab's run of the project, where there is one. */
  readonly current: PutLiveRun | undefined;
  /** The production the person's *Put it live* made, as the browser kept it. */
  readonly kept: string | undefined;
  /** Who the person said that production is for, as the browser kept it until it went live. */
  readonly shape?: ProductionShape | undefined;
  /** `undefined` until the project's environments and releases are read. */
  readonly facts: PutLiveFlowFacts | undefined;
}): PutLiveResumed {
  const { current, kept, facts } = input;
  // A run under way is the host's to drive; a stopped or finished one gives way to what came since.
  if (current !== undefined && current.phase !== "failed" && current.phase !== "live") return NONE;
  if (facts === undefined)
    return current === undefined && kept !== undefined ? { kind: "reading" } : NONE;
  const run = {
    orgId: input.orgId,
    groupId: input.groupId,
    project: input.project,
    productionId: facts.production,
    ...(input.shape === undefined ? {} : { shape: input.shape }),
  } as const;
  const { inFlight } = facts;
  if (inFlight !== undefined && inFlight !== current?.tag) {
    const release = facts.releases.find((entry) => entry.tag === inFlight);
    const at = release?.taggedAt === undefined ? Number.NaN : Date.parse(release.taggedAt);
    return {
      kind: "follow",
      run: {
        ...run,
        phase: "releasing",
        tag: inFlight,
        ...(Number.isNaN(at) ? {} : { stepAt: at }),
        ...(release?.rollbackOf === undefined ? {} : { rollsBackTo: release.rollbackOf }),
      },
    };
  }
  const [newest] = facts.releases;
  const mine = kept !== undefined && facts.production === kept;
  if (newest?.standing === "live" && (current === undefined ? mine : newest.tag !== current.tag))
    return {
      kind: "follow",
      run: {
        ...run,
        phase: "live",
        tag: newest.tag,
        ...(releasedAt(newest.taggedAt) === undefined
          ? {}
          : { liveAt: releasedAt(newest.taggedAt) }),
        ...(newest.rollbackOf === undefined ? {} : { rollsBackTo: newest.rollbackOf }),
      },
    };
  if (current !== undefined || kept === undefined) return NONE;
  if (!mine) return { kind: "forget" };
  const failed = newest === undefined ? undefined : facts.failure(newest.tag);
  return {
    kind: "stopped",
    run: {
      ...run,
      phase: "failed",
      failedAt: "creating",
      failure: {
        words:
          failed === undefined
            ? `Production is made; ${facts.suggestion} isn't released yet.`
            : putLiveFailureWords(failed),
        action: "release",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// What the press approves
// ---------------------------------------------------------------------------

/**
 * The services production's recipe creates, as the sheet names them before the press: each type in
 * the words the release's plan says it by ("PostgreSQL 18", "Valkey 9.0", "File storage"), a
 * runtime by its language and version ("Bun 1.4"), never its base image.
 */
export function putLiveServices(yaml: string): ReadonlyArray<PutLiveService> {
  return (recipeTierServiceTypes(yaml) ?? []).map(({ hostname, type }) => ({
    hostname,
    kind: type === undefined ? hostname : putLiveServiceKind(type),
  }));
}

const COPIES_FOR_CUSTOMERS = 2;

/**
 * The containers a highly available managed service runs on: three, a count its variant fixes (zcp's
 * platform knowledge, `themes/model.md`: `:single` = 1, `:ha` = 3; the published schema pins
 * Elasticsearch's at 3). Storage's highly available variants are left uncounted: what the sources
 * say of them disagrees, so the sheet claims no number for them.
 */
function highlyAvailableCopies(type: string): number | undefined {
  return /^(?:seaweedfs|shared-storage)\b/u.test(type) ? undefined : 3;
}

/**
 * The two answers to who production is for, from its setup files: each says what it makes and
 * how many copies run, and on which core package — the honest difference in cost, since no price
 * list the client can read exists (a resource's price depends on what autoscaling gives it).
 * Trying it out runs one copy of each part; for real customers the services the files make highly
 * available stay so, and each runtime runs on at least two copies.
 */
export function putLiveShapes(yaml: string): ReadonlyArray<PutLiveShapeChoice> {
  const running = recipeTierRunning(yaml) ?? [];
  if (running.length === 0) return [];
  const kinds = new Map(putLiveServices(yaml).map(({ hostname, kind }) => [hostname, kind]));
  const resilient = running.filter((service) => !service.runtime && service.highlyAvailable);
  const counted = running.map((service) =>
    service.runtime
      ? Math.max(service.copies, COPIES_FOR_CUSTOMERS)
      : service.highlyAvailable
        ? highlyAvailableCopies(service.type)
        : 1,
  );
  const forCustomers = counted.reduce<number>((sum, copies) => sum + (copies ?? 0), 0);
  const uncounted = counted.some((copies) => copies === undefined);
  const runtimes = running.filter((service) => service.runtime).length;
  const app =
    runtimes === 0
      ? undefined
      : `${runtimes === 1 ? "the app runs" : "each part of the app runs"} on at least two copies that scale with traffic`;
  const kept =
    resilient.length === 0
      ? undefined
      : `${LIST.format(resilient.map(({ hostname }) => kinds.get(hostname) ?? hostname))} ${resilient.length === 1 ? "keeps" : "keep"} running if a server fails`;
  const said = [kept, app].filter((part) => part !== undefined).join("; ");
  return [
    {
      shape: "small",
      title: "Trying it out",
      line: "One copy of each part, at the smallest size.",
      meta: `${copies(running.length)} · free Lightweight package`,
    },
    {
      shape: "available",
      title: "For real customers",
      line: said === "" ? "As the project's setup files describe it." : `${capitalise(said)}.`,
      meta: `${uncounted ? "At least " : ""}${copies(forCustomers)} · paid Serious package`,
    },
  ];
}

/** The core package production's project is born on, by who it is for. */
export const putLiveCorePackage = (shape: ProductionShape): ZeropsCorePackage =>
  shape === "available" ? "SERIOUS" : "LIGHT";

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });
const copies = (count: number) => `${count} running ${count === 1 ? "copy" : "copies"}`;
const capitalise = (words: string) => words.charAt(0).toLocaleUpperCase("en-GB") + words.slice(1);

function putLiveServiceKind(type: string): string {
  const words = serviceTypeWords(type.replace(/^(?:alpine|ubuntu)\//u, ""));
  const at = words.indexOf(" · ");
  return (at === -1 ? words : words.slice(at + 3)).replace(/ app\b/u, "");
}

/** What a run does with HQ's review of production's first release. */
export type PutLiveReviewed =
  | { readonly kind: "wait" }
  /** Everything it creates is what the press approved: released with the plan, its approval. */
  | { readonly kind: "release"; readonly plan: ReleaseServicePlan }
  /**
   * It creates something the sheet never named, HQ refused the review, or its read ran out: the
   * person approves it in the release's own review — the run ends there, never as a failure.
   */
  | { readonly kind: "review" };

/**
 * One press approves what its sheet named (the owner, 2026-11-17): HQ refuses a release that
 * creates services without a reviewed plan, so the run releases with HQ's plan only while every
 * service the plan creates is one the pressed sheet named; anything else is the person's to
 * approve, in the release's review.
 */
export function putLiveReviewed(input: {
  readonly review: HqReleaseReview;
  /** HQ said this person may not release: nothing to wait for. */
  readonly refused: boolean;
  /** The bounded wait for HQ's review ran out (`useReleasePlanWait`). */
  readonly expired: boolean;
  readonly approves: ReadonlyArray<string> | undefined;
}): PutLiveReviewed {
  const { review } = input;
  if (input.refused || review.kind === "failed") return { kind: "review" };
  if (review.kind === "pending") return input.expired ? { kind: "review" } : { kind: "wait" };
  const approved = new Set(input.approves ?? []);
  const unseen = review.plan.operations.some(
    (operation) => operation.kind === "create" && !approved.has(operation.service),
  );
  return unseen ? { kind: "review" } : { kind: "release", plan: review.plan };
}

/**
 * Production's first release never goes out reading a value its vault lacks: it would start, crash
 * on the missing value and answer errors. The run waits while what the release reads and
 * production's vault are read, within the review's own wait; where a value is lacking it ends on
 * the release's review, where the person adds it before releasing. A read that cannot tell holds
 * nothing back.
 */
export function putLiveVaultReviewed(
  vault: ReleaseVaultView,
  /** The bounded wait for those reads ran out (`useReleasePlanWait`). */
  expired: boolean,
): PutLiveReviewed["kind"] {
  if (vault.state === "reading") return expired ? "release" : "wait";
  return vault.state === "known" && vault.gaps.length > 0 ? "review" : "release";
}
