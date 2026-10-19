/**
 * What a project's own page decides before it draws: what needs the person, in the order it asks
 * (`needsInOrder`), how many of a list stand before *Show all* (`capped`), whether the project is
 * still in development, and that state's one next step (`developmentStep`).
 */

/** What needs the person, by kind: what went wrong, a Mate asking, a release ready, a review. */
export type NeedKind = "trouble" | "ask" | "release" | "review";

const NEED_RANK: Readonly<Record<NeedKind, number>> = {
  trouble: 0,
  ask: 1,
  release: 2,
  review: 3,
};

/** How many needs the page lists before *Show all*. */
export const NEEDS_SHOWN = 4;

/** How many Mates the page's Mates card lists before *Show all*. */
export const PAGE_MATES_SHOWN = 4;

/**
 * Needs, most urgent first: what went wrong, then a Mate asking, then a release ready, then the
 * changes waiting for review — each kind in the order it came.
 */
export function needsInOrder<N extends { readonly kind: NeedKind }>(
  needs: ReadonlyArray<N>,
): ReadonlyArray<N> {
  return needs.toSorted((left, right) => NEED_RANK[left.kind] - NEED_RANK[right.kind]);
}

/** A list cut at `max`: the rows that stand, and how many wait behind *Show all*. */
export function capped<T>(
  rows: ReadonlyArray<T>,
  max: number,
): { readonly shown: ReadonlyArray<T>; readonly hidden: number } {
  return { shown: rows.slice(0, max), hidden: Math.max(0, rows.length - max) };
}

/**
 * Whether a project is still in development: no production, no stage and none being added. Its
 * page then says so once, with one next step, in place of two empty sections.
 */
export function inDevelopment(input: {
  readonly productionAbsent: boolean;
  readonly stages: number;
  readonly stageBeingAdded: boolean;
  /** An environment the platform holds for a stage or production, read or not. */
  readonly placesHeld: boolean;
}): boolean {
  return (
    input.productionAbsent && input.stages === 0 && !input.stageBeingAdded && !input.placesHeld
  );
}

/** The one next step of a project in development: what it is, and its one sentence of why. */
export type DevelopmentStep = {
  readonly title: string;
  readonly words: string;
} & (
  | { readonly kind: "put-live" }
  | { readonly kind: "review" }
  | { readonly kind: "open-mate"; readonly mate: string }
  | { readonly kind: "add-mate" }
);

const COMES_LATER = "Production and a stage come once a change is merged.";

export function developmentStep(input: {
  /** Production can be made now (`setUpProduction`): there is merged work to put live. */
  readonly canPutLive: boolean;
  /** Changes waiting for the person's review, said above in what needs them. */
  readonly reviews: number;
  /** Its Mates by name, in the person's order, and which of them is at work. */
  readonly mates: ReadonlyArray<{ readonly name: string; readonly working: boolean }>;
}): DevelopmentStep {
  if (input.canPutLive)
    return {
      kind: "put-live",
      title: "Ready for its first release",
      words:
        "Its merged work runs only in the Mates’ own workspaces. Putting it live gives it production and an address.",
    };
  if (input.reviews > 0)
    return {
      kind: "review",
      title: `Review what the Mates made`,
      words: `Nothing is merged yet. Once ${input.reviews === 1 ? "the change" : "a change"} above is merged, it can go live.`,
    };
  const working = input.mates.find((mate) => mate.working);
  if (working !== undefined)
    return {
      kind: "open-mate",
      mate: working.name,
      title: `${working.name} is building it`,
      words: `Nothing is merged yet. ${COMES_LATER}`,
    };
  const first = input.mates[0];
  if (first !== undefined)
    return {
      kind: "open-mate",
      mate: first.name,
      title: `Tell ${first.name} what to build`,
      words: `Nothing is built yet. ${COMES_LATER}`,
    };
  return {
    kind: "add-mate",
    title: "Add a Mate to start",
    words: `A Mate builds it in a workspace of its own. ${COMES_LATER}`,
  };
}
