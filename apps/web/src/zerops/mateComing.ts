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
 * - or, where this browser made no press — another device, a reload — the listing reads its
 *   project or its container on the way up (`provisioning`, never a restart).
 *
 * It did not come when the platform refused its creation (`creationFailed`, the page's verdict),
 * or when this tab's press stopped after the platform took the project: both say so — a press
 * that stopped at a step safe to ask again with *Try again*, any other with the page's *Remove*.
 * Connected, it is up, and nothing here speaks for it any more.
 *
 * Its own view (`mateComingPage`) is where every door opens a Mate whose conversation cannot be
 * opened yet, new or not: past its first minutes it says what its link waits for, in its machine's
 * words, until its conversation takes the route.
 *
 * Pure: the reading and the words; the menu, the view and the page draw them.
 */
import type { ZeropsCandidateGroup } from "@t3tools/client-runtime/zerops/candidates";
import {
  isTerminalReachability,
  routeGatePhrase,
  type Reachability,
  type RouteGatePhrase,
} from "@t3tools/client-runtime/zerops/environments";

import { comingMateLine } from "../components/zerops/projects/projectsView.logic";
import {
  COMING_UP_LINE,
  creationFailedLine,
  NOT_SET_UP_LINE,
  RESTARTING_SERVICE_STATUSES,
} from "../components/zerops/ZeropsProjectRow.logic";

/** What the person can do about it, from the projects page's verbs. */
export type MateComingVerb =
  /** It never became a Mate: its project is taken off the account. */
  | "remove"
  /** A press stopped at a step safe to ask again: it resumes there, on the same project. */
  | "try-again"
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
        readonly service?: { readonly status: string } | undefined;
      }
    | undefined;
  /** Why this tab's press stopped after the platform had taken the project. */
  readonly setUpFailed?: string | undefined;
}

/** A reason, as a sentence: capitalised, and ended; empty where it says nothing. */
export function asSentence(reason: string): string {
  const said = reason.trim();
  if (said.length === 0) return "";
  const capital = said.charAt(0).toUpperCase() + said.slice(1);
  return /[.!?]$/u.test(capital) ? capital : `${capital}.`;
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
      line: creationFailedLine(candidate.creationFailed.message),
      verb: "remove",
    };
  }
  if (input.setUpFailed !== undefined) {
    const why = asSentence(input.setUpFailed);
    return {
      kind: "failed",
      line: why.length === 0 ? NOT_SET_UP_LINE : `${NOT_SET_UP_LINE} ${why}`,
      verb: press?.retryable === true ? "try-again" : "remove",
    };
  }
  if (press !== undefined && press.container) {
    return {
      kind: "coming",
      line: comingMateLine({}),
      ...(press.startedAt === undefined ? {} : { since: press.startedAt }),
    };
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
