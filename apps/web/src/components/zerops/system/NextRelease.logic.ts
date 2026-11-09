/**
 * What goes to production next, said once per page: "2 changes ready for production" with its
 * commits and the one verb (Review release); a release on its way ("Putting v0.1.4 live"); one that
 * didn't go live, with production still running what it ran (See why); or nothing at all while
 * nothing waits.
 *
 * Read from the release the flow offers (`useReleaseOffer`) and the card's reading of it
 * (`cardReady`). Pure: no React.
 */
import {
  flowVerbLabel,
  releaseFailureOf,
  REVIEW_RELEASE_LABEL,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import type { CardReady } from "../projects/projectCard.logic";
import { mainStageOf } from "../review/reviewReads";

export type NextReleaseView =
  | { readonly kind: "none" }
  | {
      readonly kind: "ready";
      readonly title: string;
      readonly facts: ReadonlyArray<string>;
      readonly verb: string;
    }
  | { readonly kind: "releasing"; readonly title: string; readonly verb: string }
  | {
      readonly kind: "failed";
      readonly pill: string;
      readonly title: string;
      readonly facts: ReadonlyArray<string>;
      readonly verb: string;
    };

/** The words for a release that didn't go through, as design-system.md names it. */
export const DIDNT_GO_LIVE = "Didn't go live";

const plural = (count: number, atLeast: boolean, one: string, many: string) =>
  `${atLeast ? "At least " : ""}${String(count)} ${count === 1 && !atLeast ? one : many}`;

/** "2 changes ready for production", "At least 3 changes ready for production". */
export function nextReleaseTitle(ready: CardReady | undefined): string {
  if (ready === undefined) return "Changes ready for production";
  const changes =
    ready.changeCount === undefined
      ? plural(ready.count, ready.atLeast, "change", "changes")
      : plural(ready.changeCount, false, "change", "changes");
  return `${changes} ready for production`;
}

/** What stands muted after the title: its commits where they are counted apart, where it is now. */
function readyFacts(ready: CardReady | undefined, onStage: boolean | undefined): string[] {
  if (ready === undefined) return [];
  const facts: string[] = [];
  if (ready.changeCount !== undefined)
    facts.push(
      `${String(ready.count)}${ready.atLeast ? "+" : ""} ${ready.count === 1 && !ready.atLeast ? "commit" : "commits"}`,
    );
  if (ready.stage !== undefined && onStage !== undefined)
    facts.push(onStage ? `on ${ready.stage}` : `not on ${ready.stage} yet`);
  return facts;
}

/**
 * The next release's state. `release`: whether the flow offers one, one is on its way, and the tag
 * it would cut (`ReleaseOffer`); `ready`: `cardReady(flow)`; `onStage`: whether the stage runs
 * every change it carries (`undefined` while unread, or where there is no stage).
 */
export function nextReleaseView(input: {
  readonly release: {
    readonly offered: boolean;
    readonly releasing: boolean;
    readonly tag: string | undefined;
  };
  readonly ready: CardReady | undefined;
  readonly onStage?: boolean | undefined;
}): NextReleaseView {
  const { release, ready } = input;
  if (release.releasing)
    return {
      kind: "releasing",
      title:
        release.tag === undefined ? flowVerbLabel("release", true) : `Putting ${release.tag} live`,
      verb: "See progress",
    };
  if (!release.offered) return { kind: "none" };
  if (ready?.failed === true)
    return {
      kind: "failed",
      pill: DIDNT_GO_LIVE,
      title: nextReleaseTitle(ready),
      facts: ready.from === undefined ? [] : [`${ready.from} still runs`],
      verb: "See why",
    };
  return {
    kind: "ready",
    title: nextReleaseTitle(ready),
    facts: readyFacts(ready, input.onStage),
    verb: REVIEW_RELEASE_LABEL,
  };
}

/**
 * The release waiting for production as an application's flow reads it (`flow.release.summary`),
 * in the card's shape (`CardReady`), so a page holding a `ZeropsProjectFlow` builds `NextRelease`
 * as a page holding a `GroupFlow` does (`cardReady`). `undefined` while HQ has not read what a
 * release would carry, and where it carries nothing.
 */
export function readyOfFlow(flow: ZeropsProjectFlow): CardReady | undefined {
  const { summary, summaryRead } = flow.release;
  if (summary === undefined || summaryRead === "pending") return undefined;
  if (summary.total === 0 && (summary.changeCount ?? 0) === 0) return undefined;
  return {
    count: summary.total,
    ...(summary.changeCount === undefined ? {} : { changeCount: summary.changeCount }),
    atLeast: summary.atLeast,
    stage: mainStageOf(flow)?.name,
    from: flow.releases.find((release) => release.standing === "live")?.tag,
    failed:
      releaseFailureOf({
        releases: flow.releases,
        environmentInputs: flow.environmentInputs,
        stalled: flow.release.stalled,
      }) !== undefined,
  };
}
