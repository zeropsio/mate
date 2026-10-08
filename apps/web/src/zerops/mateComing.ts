/**
 * A Mate in its first minutes — from the moment the platform accepts its creation until its
 * container is connected — as every surface says it: its row in the left menu, its own view while
 * it comes up (`ZeropsMateComingPage`), and the projects page, in the projects page's own words
 * (`comingMateLine`, `creationFailedLine`). One reading, so no two places disagree about whether a
 * Mate is ready (the owner, 2026-09-29, of a Mate the menu drew as an ordinary row while the
 * projects page said "Almost there.": "on the left it looks like its ready to be opened, but it's
 * not").
 *
 * A Mate is coming up while:
 * - this browser pressed it (`matePress.ts`) with a container to bring up: "Coming up. A few
 *   minutes.";
 * - this tab made it (`newMate.ts`'s creation) and it has not connected yet: its press ends in
 *   seconds, at its close-off, long before its container answers;
 * - or, where this browser made no press — another device, a reload — the listing reads its
 *   project or its container on the way up (`provisioning`, never a restart), its press in
 *   another browser is held at HQ (`pressElsewhere`), or its address landed while this window
 *   watched it come up and its Mate does not answer yet (`arriving`, `arrivalAwaitsAnswer`).
 *
 * It did not come when the platform refused its creation (`creationFailed`, the page's verdict),
 * or when this tab's press stopped after the platform took the project: both say so — a press
 * that stopped at a step safe to ask again with *Try again*, any other with the page's *Remove*.
 * A press elsewhere that stopped before its container leaves it half made, for *Finish setup*.
 * Connected, it is up, and nothing here speaks for it any more.
 *
 * Its own view (`mateComingPage`) is where every door opens a Mate whose conversation cannot be
 * opened yet, new or not: past its first minutes it says what its link waits for, in its machine's
 * words, until its conversation takes the route.
 *
 * Pure: the reading and the words; the menu, the view and the page draw them.
 */
import {
  FIRST_BUILD_GRACE_MS,
  type ZeropsCandidateGroup,
} from "@t3tools/client-runtime/zerops/candidates";
import type { PressElsewhere } from "@t3tools/client-runtime/zerops/hq";
import {
  isTerminalReachability,
  routeGatePhrase,
  type MateLink,
  type Reachability,
  type RouteGatePhrase,
} from "@t3tools/client-runtime/zerops/environments";

import { comingMateLine } from "../components/zerops/projects/projectsView.logic";
import {
  ALMOST_THERE_LINE,
  COMING_UP_LINE,
  creationFailedLine,
  NOT_SET_UP_LINE,
  TAKING_LONGER_LINE,
  RESTARTING_SERVICE_STATUSES,
} from "../components/zerops/ZeropsProjectRow.logic";

/** What the person can do about it, from the projects page's verbs. */
export type MateComingVerb =
  /** It never became a Mate: its project is taken off the account. */
  | "remove"
  /** A press stopped at a step safe to ask again: it resumes there, on the same project. */
  | "try-again"
  /**
   * A press that stopped before its container, in any browser: an owner or an admin finishes it
   * (*Finish setup*), the same steps the press makes.
   */
  | "finish-setup"
  /** The platform may have taken it anyway: the projects page lists it if it did. */
  | "go-to-projects";

export type MateComing =
  | {
      readonly kind: "coming";
      /** How far it has got, as the projects page says it. */
      readonly line: string;
      /** When the platform took it, wall ms, where this browser pressed it: its row's clock. */
      readonly since?: number | undefined;
    }
  | {
      readonly kind: "failed";
      /** Why it did not come, as its row says it. */
      readonly line: string;
      readonly verb: MateComingVerb;
      readonly details?: string | undefined;
    };

export interface MateComingInput {
  /** Its press, where this browser made one. */
  readonly press:
    | {
        /** When the platform took the project, wall ms. */
        readonly startedAt?: number | undefined;
        /** Whether a Mate container is being brought up at all. */
        readonly container: boolean;
        /** It stopped at a step safe to ask again: *Try again* resumes it. */
        readonly retryable?: boolean | undefined;
      }
    | undefined;
  /** Its project as the listing reads it, once it holds it. */
  readonly candidate:
    | {
        readonly group: ZeropsCandidateGroup;
        readonly creationFailed?: { readonly message: string | undefined } | undefined;
        readonly service?:
          | { readonly status: string; readonly created?: string | undefined }
          | undefined;
        /** Its project lists no container. */
        readonly missingContainer?: true | undefined;
        /** Its address landed where its reader watched it wait for it (`ZeropsCandidate.arriving`). */
        readonly arriving?: { readonly until: number } | undefined;
      }
    | undefined;
  /** Now, wall ms: how long its first build has taken, and whether its arrival still shows. */
  readonly nowMs?: number | undefined;
  /**
   * Whether a press in another browser is still at it, as HQ holds it (`pressElsewhere`): what a
   * project without its container is, where this browser made no press.
   */
  readonly pressElsewhere?: PressElsewhere | undefined;
  /** Why this tab's press stopped after the platform had taken the project. */
  readonly setUpFailed?: string | undefined;
  /** This tab made it, and it has not connected since (`newMate.ts`'s creation). */
  readonly created?: boolean | undefined;
  /**
   * Its link's wait is one an arrival holds through (`arrivalHoldsThrough`); `undefined` where
   * the caller does not read its link.
   */
  readonly linkHolds?: boolean | undefined;
  /** A whole listing read well after this tab made it lacks it (`listingLacksCreation`). */
  readonly listingLacksIt?: boolean | undefined;
  /** Its container's first build, where its project's processes are read (`firstBuildState`). */
  readonly firstBuild?: FirstBuildState | undefined;
  /** Its link still waits for its first answer (`arrivalAwaitsAnswer`). */
  readonly answerAwaited?: boolean | undefined;
  /**
   * Why the close-off gate holds it (`closeOffGate`), never silent: `open`, its container carries
   * the press's marker and HQ says its project is not closed off, so nobody is let in; `checking`,
   * its marker is not read yet; `awaiting-hq`, HQ says nothing and this browser knows its close-off
   * has not happened. Left out while a Finish setup runs on it in this tab.
   */
  readonly closeOffHold?: "open" | "checking" | "awaiting-hq" | undefined;
}

/**
 * The moments at which what `mateComing` says of a listed Mate changes by time alone, wall ms: its
 * arrival's window closing, its first build's grace running out. A surface that draws the line
 * redraws at the earliest of them still ahead (`useComingClock`), not on whatever else happens.
 */
export function mateComingDeadlines(
  candidate: MateComingInput["candidate"],
): ReadonlyArray<number> {
  const deadlines: number[] = [];
  if (candidate?.arriving !== undefined) deadlines.push(candidate.arriving.until);
  if (candidate?.service?.status === "READY_TO_DEPLOY") {
    const created = Date.parse(candidate.service.created ?? "");
    if (!Number.isNaN(created)) deadlines.push(created + FIRST_BUILD_GRACE_MS);
  }
  return deadlines;
}

/** Whether `at` is within `graceMs` of now; an unknown time or now counts as young. */
function youngAt(at: string | undefined, nowMs: number | undefined, graceMs: number): boolean {
  const ms = Date.parse(at ?? "");
  return nowMs === undefined || Number.isNaN(ms) || nowMs - ms < graceMs;
}

/** A Mate whose press stopped before its container: half-made, and *Finish setup* completes it. */
export const HALF_MADE_LINE = "Its setup stopped before its container. Finish setup completes it.";

/** The same Mate, for a viewer who may not finish it: who can. */
export const HALF_MADE_OWNER_LINE =
  "Its setup stopped before its container; an owner or admin can finish it.";

/**
 * A Mate held because HQ says its project is not closed off (`closeOffHold` `open`), until HQ says
 * it is: a press may be closing it off, and *Finish setup* in its menu does.
 */
export const CLOSING_OFF_LINE = "Closing off its project…";

/** A Mate held while its container's marker is read (`closeOffHold` `checking`). */
export const CHECKING_SETUP_LINE = "Checking that its setup finished…";

/** A Mate held until HQ confirms its close-off (`closeOffHold` `awaiting-hq`). */
export const AWAITING_HQ_LINE = "Waiting for HQ to confirm its setup finished.";

/**
 * A half-made Mate as its viewer may act on it: the line names Finish setup only where the
 * viewer has it, and says who can where they do not.
 */
export function halfMadeFor(coming: MateComing, canFinish: boolean): MateComing {
  if (coming.kind !== "failed" || coming.verb !== "finish-setup" || canFinish) return coming;
  return { ...coming, line: HALF_MADE_OWNER_LINE };
}

/** A reason, as a sentence: capitalised, and ended; empty where it says nothing. */
export function asSentence(reason: string): string {
  const said = reason.trim();
  if (said.length === 0) return "";
  const capital = said.charAt(0).toUpperCase() + said.slice(1);
  return /[.!?]$/u.test(capital) ? capital : `${capital}.`;
}

/** A container that failed, stopped, or is restarting: its own state, never "Coming up". */
function containerDown(status: string | undefined): boolean {
  if (status === undefined) return false;
  return (
    status.endsWith("FAILED") || status === "STOPPED" || RESTARTING_SERVICE_STATUSES.has(status)
  );
}

/**
 * Where a Mate is in its first minutes, or `undefined` once it is up — or where nothing says it is
 * being made at all: a Mate that is only asleep, stopped or restarting is not coming.
 */
export function mateComing(input: MateComingInput): MateComing | undefined {
  const { press, candidate } = input;
  if (candidate?.group === "connected") return undefined;
  if (candidate?.creationFailed !== undefined) {
    return {
      kind: "failed",
      line: NOT_SET_UP_LINE,
      details: candidate.creationFailed.message,
      verb: "remove",
    };
  }
  if (input.setUpFailed !== undefined) {
    const why = asSentence(input.setUpFailed);
    return {
      kind: "failed",
      line: NOT_SET_UP_LINE,
      details: why,
      verb: press?.retryable === true ? "try-again" : "remove",
    };
  }
  // Its container waits for its first build: one that failed never brings it (the platform leaves
  // the service READY_TO_DEPLOY), and says so with Remove wherever its build's process is read.
  const firstBuild = candidate?.service?.status === "READY_TO_DEPLOY";
  if (firstBuild && input.firstBuild?.kind === "failed") {
    const why = asSentence(input.firstBuild.why);
    return {
      kind: "failed",
      line: NOT_SET_UP_LINE,
      details: why,
      verb: "remove",
    };
  }
  // Held because its project is not closed off: said, closing off until HQ says it is — never
  // failed on a clock (2026-10-05); Finish setup is in its menu. A press of this tab's bringing its
  // container says that instead.
  if (input.closeOffHold === "checking") return { kind: "coming", line: CHECKING_SETUP_LINE };
  if (input.closeOffHold === "awaiting-hq" && press?.container !== true) {
    return { kind: "coming", line: AWAITING_HQ_LINE };
  }
  if (input.closeOffHold === "open" && press?.container !== true) {
    return { kind: "coming", line: CLOSING_OFF_LINE };
  }
  // A container that failed, stopped or is restarting shows that, whatever this tab pressed.
  if (containerDown(candidate?.service?.status)) return undefined;
  if (press !== undefined && press.container) {
    return {
      kind: "coming",
      line: comingMateLine({}),
      ...(press.startedAt === undefined ? {} : { since: press.startedAt }),
    };
  }
  if (press === undefined && candidate?.missingContainer === true) {
    // A press in another browser that HQ still holds is importing it; one whose hold ran out — its
    // tab closed — or whose import failed stopped before its container, and nothing will bring it.
    // While HQ has said nothing of presses, neither is said.
    if (input.pressElsewhere === "pressing") return { kind: "coming", line: COMING_UP_LINE };
    if (input.pressElsewhere === "stopped") {
      return { kind: "failed", line: HALF_MADE_LINE, verb: "finish-setup" };
    }
    return undefined;
  }
  // Past its grace a first build is taking longer, however long — a slow or queued one looks the
  // same from its status as one whose process is not read yet — with no verb that cannot work on a
  // service never deployed. Only its build's process says it failed (above), never its age.
  if (firstBuild) {
    const overdue = !youngAt(candidate?.service?.created, input.nowMs, FIRST_BUILD_GRACE_MS);
    return { kind: "coming", line: overdue ? TAKING_LONGER_LINE : COMING_UP_LINE };
  }
  // Made here and not connected yet: its press is over and its container on its way — while
  // nothing is listed for it yet, or its link waits on nothing but time. A link that wants
  // somebody, or a project gone, says so in its own words.
  if (
    input.created === true &&
    (candidate === undefined
      ? input.linkHolds !== false && input.listingLacksIt !== true
      : candidate.group === "provisioning" || input.linkHolds === true)
  ) {
    return { kind: "coming", line: comingMateLine({}) };
  }
  // Its address landed where this window watched it come up, and its Mate does not answer yet:
  // still on its way, in every other window, until its listing's clock ends — past it a Mate that
  // never answered reads as any other. The window that made it reads its creation above: past an
  // arrival's held failures its link's words speak there, with *Try now*.
  if (
    input.created !== true &&
    candidate?.group === "ready" &&
    candidate.arriving !== undefined &&
    (input.nowMs === undefined || input.nowMs < candidate.arriving.until) &&
    input.answerAwaited === true
  ) {
    return { kind: "coming", line: COMING_UP_LINE };
  }
  if (
    press === undefined &&
    candidate?.group === "provisioning" &&
    !RESTARTING_SERVICE_STATUSES.has(candidate.service?.status ?? "")
  ) {
    return { kind: "coming", line: COMING_UP_LINE };
  }
  return undefined;
}

const FAILED_PROCESS_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);
const LIVE_PROCESS_STATUSES: ReadonlySet<string> = new Set(["PENDING", "RUNNING"]);
/**
 * The statuses a build's version ends badly in (`AppVersionStatusEnum`): a deploy that fails after
 * its build — an init command, its runtime's prepare — leaves the process FINISHED and says it
 * here (zerops-docs, deployment lifecycle: "Diagnose via `appVersion.status`").
 */
const FAILED_VERSION_STATUSES: ReadonlySet<string> = new Set([
  "BUILD_VALIDATION_FAILED",
  "BUILD_FAILED",
  "PREPARING_RUNTIME_FAILED",
  "DEPLOY_FAILED",
  "CANCELLED",
]);

/** A Mate's first build as its project's processes say it: still running, or failed and why. */
export type FirstBuildState =
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly why: string };

/**
 * Its container's first build, as its project's processes say it: its newest build for that
 * service queued or running, or ended failed or cancelled — its process's, or its version's own
 * failure once the process ended. `undefined` while nothing says either.
 */
export function firstBuildState(
  processes:
    | ReadonlyArray<{
        readonly actionName: string;
        readonly serviceStackIds: ReadonlyArray<string>;
        readonly status: string;
        readonly created: string;
        readonly failReason?: string | undefined;
        readonly appVersion?: { readonly status?: string | undefined } | undefined;
      }>
    | undefined,
  serviceId: string | undefined,
): FirstBuildState | undefined {
  if (processes === undefined || serviceId === undefined) return undefined;
  const newest = processes
    .filter(
      (process) =>
        process.actionName === "stack.build" && process.serviceStackIds.includes(serviceId),
    )
    .toSorted((left, right) => Date.parse(right.created) - Date.parse(left.created))[0];
  if (newest === undefined) return undefined;
  if (LIVE_PROCESS_STATUSES.has(newest.status)) return { kind: "running" };
  if (FAILED_PROCESS_STATUSES.has(newest.status)) {
    return {
      kind: "failed",
      why: newest.failReason ?? "Its container's first build did not finish",
    };
  }
  const version = newest.appVersion?.status;
  if (version === undefined || !FAILED_VERSION_STATUSES.has(version)) return undefined;
  return {
    kind: "failed",
    why: newest.failReason ?? `Its container's first deploy failed: ${version}`,
  };
}

/**
 * How long after this tab made a Mate its organization's listing may still lack the project: the
 * platform's push of a new project lands within seconds.
 */
export const LISTING_CATCH_UP_MS = 60_000;

/**
 * Whether a whole listing, read well after this tab made the Mate, lacks its project: it went
 * before it ever connected. A partial listing, one read before the platform's could hold it, or a
 * creation with no time says nothing.
 */
export function listingLacksCreation(input: {
  readonly listed: boolean;
  readonly complete: boolean;
  /** When the listing was read, wall ms. */
  readonly listedAtMs: number | undefined;
  /** When the platform took this tab's creation, wall ms. */
  readonly madeAtMs: number | undefined;
}): boolean {
  if (input.listed || !input.complete) return false;
  if (input.listedAtMs === undefined || input.madeAtMs === undefined) return false;
  return input.listedAtMs - input.madeAtMs > LISTING_CATCH_UP_MS;
}

/** A name the headline never breaks inside. */
const keptWhole = (name: string) => name.replaceAll(" ", " ");

/**
 * What a Mate's own view says in its headline: coming up, or not come (`MateComing`); on its way
 * to its conversation (`reaching`); or not to be opened (`unreachable`).
 */
export type MateViewKind = MateComing["kind"] | "reaching" | "unreachable";

/**
 * Its own view's headline, in the empty conversation's voice — "Quinn is coming up on Acme
 * Docs." while it comes, "Quinn could not be added to Acme Docs." if it did not: the words of the
 * button that made it — with no name torn in two. Any other Mate is its name alone: the line under
 * it says what it waits for, or why it cannot be opened, in its machine's words.
 */
export function mateComingHeadlineClauses(
  mate: { readonly name: string; readonly project: string | undefined },
  kind: MateViewKind,
): ReadonlyArray<string> {
  const name = keptWhole(mate.name);
  const on = mate.project === undefined ? "" : ` on ${keptWhole(mate.project)}`;
  const to = mate.project === undefined ? "" : ` to ${keptWhole(mate.project)}`;
  switch (kind) {
    case "coming":
      return [`${name} is coming up${on}.`];
    case "failed":
      return [`${name} could not be added${to}.`];
    case "reaching":
    case "unreachable":
      return [name];
  }
}

/** What a Mate's own view shows (`ZeropsMateComingPage`). */
export type MateComingPage =
  | { readonly kind: "coming"; readonly coming: MateComing }
  /** Its conversation can be opened: the view hands over to it. */
  | { readonly kind: "up" }
  /**
   * On its way to its conversation: what it waits for, as its machine says it (null while no
   * machine names it yet); the view connects it where the person's session allows.
   */
  | { readonly kind: "reaching"; readonly reachability: Reachability | null }
  /**
   * Not to be opened — gone, replaced, refused, or not on the account (null): the view says why
   * where it stands, and never hands the person to another screen on its own.
   */
  | { readonly kind: "unreachable"; readonly reachability: Reachability | null };

/**
 * What a Mate's own view shows — where every door opens a Mate whose conversation cannot be
 * opened yet: how far a new one has got while it comes up (`mateComing`), its conversation once
 * that can be opened — its environment registered and worth a link (`mateLink`), or its row
 * connected — and until then what its machine waits for. Only a terminal verdict, or a whole
 * listing that lacks it, is `unreachable`. `undefined` while the listing, still being read, may
 * yet name it and no machine speaks for it.
 */
export function mateComingPage(input: {
  readonly coming: MateComing | undefined;
  readonly candidate: { readonly group: ZeropsCandidateGroup } | undefined;
  /** The listing is whole: a project it lacks is not on the account. */
  readonly complete: boolean;
  /** Its conversation's environment is registered and worth a link (`mateLink`). */
  readonly linked: boolean;
  /** What its machine says of it (`mateLink`); null while no machine names it. */
  readonly reachability: Reachability | null;
}): MateComingPage | undefined {
  const { candidate, reachability } = input;
  // A Mate whose conversation can be opened is up, whatever this browser still holds of its
  // coming — a birth left behind never keeps it from its conversation.
  if (input.linked || candidate?.group === "connected") return { kind: "up" };
  if (input.coming !== undefined) return { kind: "coming", coming: input.coming };
  if (reachability !== null && isTerminalReachability(reachability)) {
    return { kind: "unreachable", reachability };
  }
  if (candidate === undefined) {
    if (input.complete) return { kind: "unreachable", reachability: null };
    return reachability === null ? undefined : { kind: "reaching", reachability };
  }
  return { kind: "reaching", reachability };
}

/**
 * How many failures of its link since it last connected an arrival holds its board through: its
 * first three back-off steps (2, 4 and 8 s) — a fresh server warming up, its access propagating;
 * past them, its link's words say it is not answering, with *Try now*, and keep saying so through
 * the attempts between the retries until it connects.
 */
export const ARRIVAL_FAILURES_HELD = 3;

/** Up, its conversation and its sign-in being read: the last of its coming words. */
const ARRIVAL_OPENING: MateComing = { kind: "coming", line: ALMOST_THERE_LINE };

/** A container level on its way up, whose own words would only interrupt the arrival. */
const ON_ITS_WAY_LEVELS: ReadonlySet<string> = new Set([
  "creating",
  "provisioning",
  "booting",
  "restarting",
  "updating",
]);

/**
 * Whether a link's wait is one the arrival holds through: anything on its way that needs nobody —
 * never one past its cap, one that wants a restart, or a container down or not to be reached.
 */
export function arrivalHoldsThrough(
  reachability: Reachability | null,
  context: {
    /** Its link's failures since it last connected (`MateLink.failuresSinceConnect`). */
    readonly failuresSinceConnect: number;
  },
): boolean {
  if (reachability === null) return true;
  const failing = context.failuresSinceConnect > ARRIVAL_FAILURES_HELD;
  switch (reachability.kind) {
    case "resolving":
    case "ready":
    case "waiting-for-zerops":
      return true;
    case "connecting":
      // A wait on its access or its presence is a wait on Zerops, never its link not answering.
      return (
        reachability.waitingOn === "access" || reachability.waitingOn === "presence" || !failing
      );
    case "reconnecting":
      return !failing;
    case "retrying":
      return !reachability.restart && !failing;
    // Nothing but failed probes says it is coming up: as a boot on its way until its cap runs out.
    case "not-answering":
      return !reachability.overdue;
    case "container":
      return (
        ON_ITS_WAY_LEVELS.has(reachability.container.level) &&
        !("overdue" in reachability.container && reachability.container.overdue)
      );
    default:
      return false;
  }
}

/**
 * Whether a Mate's link still waits for its first answer, on what an arrival holds through: it has
 * not answered on this page (`MateLink.answered`), and nothing it waits for is a verdict — a Mate
 * gone or refused, a restart asked for, its container down. A server still starting fails its
 * probes until it answers, so failures that say nothing answered do not count — its listing's
 * clock (`ZeropsCandidate.arriving`) bounds the wait instead; the errors a server answered with
 * are held through an arrival's first failures only, as the window that made it holds them,
 * whatever its link is doing between them.
 */
export const arrivalAwaitsAnswer = (
  link: Pick<MateLink, "reachability" | "answered" | "errorsSinceConnect">,
): boolean =>
  !link.answered &&
  arrivalHoldsThrough(link.reachability, { failuresSinceConnect: link.errorsSinceConnect });

/** Whether a Mate's link, as its machine reads it (`MateLink`), waits on what an arrival holds through. */
export const arrivalLinkHolds = (link: {
  readonly reachability: Reachability | null;
  readonly failuresSinceConnect: number;
}): boolean => arrivalHoldsThrough(link.reachability, link);

/**
 * What a Mate's own view says as its arrival, if anything: its coming words while it comes up,
 * and — once the view has shown it coming (`cameUp`) — the board still, through every wait on its
 * way to its conversation, until the sign-in takes the board's place and the conversation the
 * route. A container down, a wait past its cap or one that asks for a restart says so in its link's
 * words instead; a Mate never shown coming here says its link's words from the start.
 */
export function mateArrivalShown(input: {
  readonly page: MateComingPage | undefined;
  readonly cameUp: boolean;
  /** Its link's failures since it last connected (`MateLink.failuresSinceConnect`). */
  readonly failuresSinceConnect: number;
}): MateComing | undefined {
  const { page } = input;
  if (page?.kind === "coming") return page.coming;
  if (!input.cameUp) return undefined;
  if (page?.kind === "up") return ARRIVAL_OPENING;
  if (page?.kind === "reaching" && arrivalHoldsThrough(page.reachability, input)) {
    return ARRIVAL_OPENING;
  }
  return undefined;
}

/**
 * The line under a Mate's name in its own view, in the route gate's words for the same verdict
 * (§4.8, one phrase producer): what its link waits for while it is on its way — "Opening this
 * conversation…" while its machine has nothing more to say — and why it cannot be opened, each
 * with its verbs.
 */
export function mateOpeningPhrase(
  page: Extract<MateComingPage, { readonly kind: "reaching" | "unreachable" }>,
  context: { readonly nowMs: number; readonly mateName: string },
): RouteGatePhrase {
  if (page.kind === "unreachable") {
    return routeGatePhrase({ kind: "unavailable", reachability: page.reachability }, context);
  }
  const waiting = routeGatePhrase({ kind: "wait", reachability: page.reachability }, context);
  return waiting.text === null
    ? routeGatePhrase({ kind: "wait", reachability: null }, context)
    : waiting;
}

/**
 * What a Mate's own view connects: its machine's target where a machine names it; else, once its
 * container answers, its listed row's. Always a target its machine holds,
 * so a connect that fails is the machine's to try again on its own ladder — never an origin that
 * a listing not caught up yet turns away once, with nothing asking again while the view stays.
 * Null while there is nothing to connect yet.
 */
export function mateConnectKey(input: {
  readonly reachingKey: string | undefined;
  readonly answering: boolean;
  readonly candidateKey: string | undefined;
}): string | null {
  if (input.reachingKey !== undefined) return input.reachingKey;
  if (!input.answering) return null;
  return input.candidateKey ?? null;
}
