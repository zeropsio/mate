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
 * - this browser holds its birth (`zeropsBirths.ts`) with a container to bring up — its step's
 *   words: "Coming up. A few minutes.", then "Almost there." once its Mate is waited on, and
 *   "Taking longer than usual." past a step's cap, with the page's *Keep waiting*;
 * - or, where no birth is held here — another device, a tab opened after it ended — the listing
 *   reads its project or its container on the way up (`provisioning`, never a restart).
 *
 * It did not come when the platform refused its creation (`creationFailed`, the page's verdict),
 * or when this tab's creation stopped after the platform took the project: both say so, with the
 * page's *Remove*. Connected, it is up, and nothing here speaks for it any more.
 *
 * Its own view (`mateComingPage`) is where every door opens a Mate whose conversation cannot be
 * opened yet, new or not: past its first minutes it says what its link waits for, in its machine's
 * words, until its conversation takes the route.
 *
 * Pure: the reading and the words; the menu, the view and the page draw them.
 */
import type { BirthStep } from "@t3tools/client-runtime/zerops/birth";
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
  RESTARTING_SERVICE_STATUSES,
} from "../components/zerops/ZeropsProjectRow.logic";

/** What the person can do about it, from the projects page's verbs. */
export type MateComingVerb =
  /** A step past its cap: its clock starts over (`retryBirth`). */
  | "keep-waiting"
  /** It never became a Mate: its project is taken off the account. */
  | "remove";

export type MateComing =
  | {
      readonly kind: "coming";
      /** How far it has got, as its row says it. */
      readonly line: string;
      readonly verb: "keep-waiting" | undefined;
    }
  | {
      readonly kind: "failed";
      /** Why it did not come, as its row says it. */
      readonly line: string;
      readonly verb: "remove";
    };

export interface MateComingInput {
  /** Its birth, where this browser holds one. */
  readonly birth:
    | {
        readonly step: BirthStep;
        /** The step outlasted its cap. */
        readonly overdue: boolean;
        /** Whether a Mate container is being brought up at all. */
        readonly container: boolean;
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
  /** Why this tab's creation stopped after the platform had taken the project. */
  readonly setUpFailed?: string | undefined;
}

/** Said after "Could not be set up.", as a sentence. */
function sentence(reason: string): string {
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
  const { birth, candidate } = input;
  if (candidate?.group === "connected") return undefined;
  if (candidate?.creationFailed !== undefined) {
    return {
      kind: "failed",
      line: creationFailedLine(candidate.creationFailed.message),
      verb: "remove",
    };
  }
  if (input.setUpFailed !== undefined) {
    const why = sentence(input.setUpFailed);
    return {
      kind: "failed",
      line: why.length === 0 ? "Could not be set up." : `Could not be set up. ${why}`,
      verb: "remove",
    };
  }
  if (birth !== undefined && birth.container) {
    return {
      kind: "coming",
      line: comingMateLine({ step: birth.step, overdue: birth.overdue }),
      verb: birth.overdue ? "keep-waiting" : undefined,
    };
  }
  if (
    birth === undefined &&
    candidate?.group === "provisioning" &&
    !RESTARTING_SERVICE_STATUSES.has(candidate.service?.status ?? "")
  ) {
    return { kind: "coming", line: COMING_UP_LINE, verb: undefined };
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
  if (input.coming !== undefined) return { kind: "coming", coming: input.coming };
  const { candidate, reachability } = input;
  if (input.linked || candidate?.group === "connected") return { kind: "up" };
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
