/**
 * Where an open change that asks for review stands for the person looking at it, where its
 * application limits who merges: whose press it waits for. Every surface that names a change —
 * its review, the menu, the composer's top, the project's page — says it by this one rule, so no
 * surface tells a person who cannot merge to review or merge it.
 */
import type { HqMergeAsk } from "@t3tools/shared/hqChanges";

import type { FlowPullRequest } from "./projectFlow.ts";

/**
 * Whether the person looking merges in the change's application: `yes`, `held` by its limit on
 * who merges (`not_app_merger`: they work there and may ask), or `no` — refused for another
 * reason, or not said yet — which leaves every surface as it reads without a limit.
 */
export type ViewerMerges = "yes" | "held" | "no";

/** {@link ViewerMerges} of an application's merge verb as HQ's offers state it. */
export function viewerMerges(
  merge:
    | { readonly kind: "allowed" }
    | { readonly kind: "refused"; readonly reason: string | undefined }
    | { readonly kind: "unknown" },
): ViewerMerges {
  if (merge.kind === "allowed") return "yes";
  return merge.kind === "refused" && merge.reason === "not_app_merger" ? "held" : "no";
}

export type ChangeStanding =
  /** The person merges and nobody asked: theirs to review, as without a limit. */
  | { readonly kind: "to-merge" }
  /** The person merges and somebody asked them to. */
  | { readonly kind: "asked-of-me"; readonly by: string; readonly at: string }
  /** The person cannot merge and nobody has asked yet: theirs to ask. */
  | { readonly kind: "to-ask" }
  /** The person cannot merge and it was asked, by them (`mine`) or by somebody else. */
  | { readonly kind: "waiting"; readonly by: string; readonly at: string; readonly mine: boolean };

/**
 * A change's {@link ChangeStanding} for the person looking. Its readiness is the caller's
 * (`changeAsksForReview`): a draft, a conflict or a change `main` already holds waits on its Mate,
 * whoever looks.
 */
export function changeStanding(
  pull: Pick<FlowPullRequest, "mergeAsk">,
  viewer: { readonly merges: ViewerMerges; readonly userId: string | undefined },
): ChangeStanding {
  const ask = pull.mergeAsk;
  if (viewer.merges === "held") {
    return ask === undefined
      ? { kind: "to-ask" }
      : { kind: "waiting", by: ask.by, at: ask.at, mine: ask.by === viewer.userId };
  }
  // A person the ask is not for — one who merges nowhere here — reads it as without a limit.
  return ask === undefined || viewer.merges !== "yes"
    ? { kind: "to-merge" }
    : { kind: "asked-of-me", by: ask.by, at: ask.at };
}

/** How many of the people who merge are said by name before the rest are "another person". */
const MERGERS_SAID = 2;

/**
 * Who a change waits for where its application limits who merges, as a sentence's object: the
 * people it names, as the member list calls them — "Ada K.", "Ada K. or Sam R.", "Ada K., Sam R.
 * or another person who merges here" — and "an Owner or Admin" where it names nobody, or nobody
 * the list knows.
 */
export function mergersWho(
  people: ReadonlyArray<string>,
  nameOf: (userId: string) => string | undefined,
): string {
  const named = people.flatMap((userId) => nameOf(userId) ?? []);
  const said = named.slice(0, MERGERS_SAID);
  if (said.length === 0) return "an Owner or Admin";
  if (people.length > said.length) return `${said.join(", ")} or another person who merges here`;
  return said.join(" or ");
}

/**
 * Who merges where an application limits it, said calmly to a person it holds: the people it
 * names — "Ada K. merges here.", "Ada K. and Sam R. merge here.", "Ada K., Sam R. and others
 * merge here." — and the organization's Owner and Admins where it names nobody, or nobody the
 * member list knows.
 */
export function mergersLine(
  people: ReadonlyArray<string>,
  nameOf: (userId: string) => string | undefined,
): string {
  const said = people.flatMap((userId) => nameOf(userId) ?? []).slice(0, MERGERS_SAID);
  if (said.length === 0) return "The organization's Owner and Admins merge here.";
  if (people.length > said.length) return `${said.join(", ")} and others merge here.`;
  return said.length === 1 ? `${said[0]} merges here.` : `${said.join(" and ")} merge here.`;
}

/** Who asked, as a sentence's subject: "You", the name the member list has, or "Someone". */
export function askerName(
  standing: Extract<ChangeStanding, { readonly by: string }>,
  nameOf: (userId: string) => string | undefined,
): string {
  if (standing.kind === "waiting" && standing.mine) return "You";
  return nameOf(standing.by) ?? "Someone";
}

/** The press that hands a ready change to the people who merge. */
export const ASK_TO_MERGE = "Ask to merge";
/** The press that takes an ask back. */
export const TAKE_ASK_BACK = "Take back";
/** What stands where the press was, once somebody asked. */
export const ASKED = "Asked";

/**
 * What a person who merges reads under Merge, of a change that builds on other open ones: its
 * merge puts them on `main` too — "Merging this also merges #11.", "… #11 and #12.". Nothing is
 * held by it.
 */
export function alsoMergesWords(buildsOn: ReadonlyArray<number>): string {
  const numbers = buildsOn.map((number) => `#${String(number)}`);
  const listed =
    numbers.length <= 1
      ? (numbers[0] ?? "")
      : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1) ?? ""}`;
  return `Merging this also merges ${listed}.`;
}

/**
 * The ask a surface shows of a change: what HQ's navigation holds (`held`), under this surface's
 * own ask or its taking back once HQ answered it — the answer is the ask as it stands (`now`,
 * `null` for none), until the navigation says anything else than it said at the answer (`over`).
 */
export function shownMergeAsk(
  held: HqMergeAsk | undefined,
  answer: { readonly over: HqMergeAsk | undefined; readonly now: HqMergeAsk | null } | null,
): HqMergeAsk | undefined {
  if (answer === null) return held;
  const unmoved = held?.by === answer.over?.by && held?.at === answer.over?.at;
  return unmoved ? (answer.now ?? undefined) : held;
}

/**
 * The few words a row, tag or chip says of a ready change's standing. What it builds on is its
 * review's to say: nothing is held by it.
 */
export function standingWord(
  standing: ChangeStanding,
  mergers: { readonly people: ReadonlyArray<string> } | null | undefined,
  nameOf: (userId: string) => string | undefined,
): string {
  switch (standing.kind) {
    case "to-merge":
      return "Ready to merge";
    case "asked-of-me":
      return `${askerName(standing, nameOf)} asks to merge`;
    case "to-ask":
      return "Ready";
    case "waiting":
      return `Waiting for ${mergersWho(mergers?.people ?? [], nameOf)}`;
  }
}

/**
 * A ready change's standing for the person looking and the few words that say it
 * (`standingWord`), as one surface hands it to the next: read once, said alike everywhere.
 */
export interface ChangeStandingRead {
  readonly standing: ChangeStanding;
  /**
   * "Ready to merge", "Ready", "Waiting for Ada K. or Sam R.", "Dana L. asks to merge". Never what
   * it builds on: nothing is held by that, and only its review says it.
   */
  readonly word: string;
  /** Who merges there, as a sentence's object (`mergersWho`): "Ada K. or Sam R.". */
  readonly who: string;
  /** Who asked, as a sentence's subject (`askerName`), where somebody did. */
  readonly asker?: string | undefined;
}

/** A change's {@link ChangeStandingRead}, by the application it is of. */
export type ChangeStandingOf = (
  appId: string | undefined,
  pull: Pick<FlowPullRequest, "mergeAsk">,
) => ChangeStandingRead;

/** What decides a standing: per application whether the person merges and who does, and names. */
export interface ChangeStandingFacts {
  readonly apps: {
    readonly [appId: string]: {
      readonly merges: ViewerMerges;
      /** The people its limit names; `null` where it limits nothing. */
      readonly people: ReadonlyArray<string> | null;
    };
  };
  /** What the member list calls each person, by their Zerops user id. */
  readonly names: { readonly [userId: string]: string };
}

/**
 * The one reader of a change's standing every surface shares: an application the facts do not
 * hold reads as one without a limit, so a surface says today's words until HQ has said otherwise.
 */
export function changeStandingOf(
  facts: ChangeStandingFacts,
  viewer: { readonly userId: string | undefined; readonly name?: string | undefined },
): ChangeStandingOf {
  const nameOf = (userId: string) =>
    facts.names[userId] ?? (userId === viewer.userId ? viewer.name : undefined);
  return (appId, pull) => {
    const app = appId === undefined ? undefined : facts.apps[appId];
    const standing = changeStanding(pull, {
      merges: app?.merges ?? "no",
      userId: viewer.userId,
    });
    const mergers = app === undefined || app.people === null ? null : { people: app.people };
    return {
      standing,
      word: standingWord(standing, mergers, nameOf),
      who: mergersWho(mergers?.people ?? [], nameOf),
      ...(standing.kind === "asked-of-me" || standing.kind === "waiting"
        ? { asker: askerName(standing, nameOf) }
        : {}),
    };
  };
}

/** The press that opens a change the person only waits on: nothing is asked of them there. */
export const VIEW_CHANGE = "View";

/**
 * Whether a standing asks the person for nothing: they asked, and it waits on the people who
 * merge. Its surfaces say so quietly — no call to action, a plain way in.
 */
export function standingWaits(
  standing: ChangeStanding | ChangeStanding["kind"] | undefined,
): boolean {
  return (typeof standing === "string" ? standing : standing?.kind) === "waiting";
}

/**
 * The verb a row's press says for a change that asks, by its standing: *Ask to merge* where the
 * person cannot merge and nobody asked, *View* where it waits on the people who merge, else the
 * surface's own *Review* (`review`).
 */
export function standingPressLabel(
  standing: ChangeStanding | ChangeStanding["kind"] | undefined,
  review: string,
): string {
  const kind = typeof standing === "string" ? standing : standing?.kind;
  return kind === "to-ask" ? ASK_TO_MERGE : kind === "waiting" ? VIEW_CHANGE : review;
}
