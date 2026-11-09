/**
 * What goes to a place next, as its page's first card: one tinted card — its title and the line
 * under it, the one verb at its end — and the changes it carries under a hairline. Production's is
 * its next release (`nextReleaseView`: ready, on its way, didn't go live); a stage's, the changes
 * that wait to be approved for it, each with its own *Review*.
 */
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { REVIEW_RELEASE_LABEL } from "~/zerops/review";
import type { CardReady } from "../projects/projectCard.logic";
import { nextReleaseTitle, nextReleaseView } from "../system";
import type { ReleaseOffer } from "../ZeropsReleaseVerb";

const NO_FACTS: ReadonlyArray<string | undefined> = [];

/** Production's next release as a card; nothing where nothing waits. */
export function PlaceNextRelease({
  release,
  ready,
  from,
  children,
}: {
  readonly release: ReleaseOffer;
  readonly ready: CardReady | undefined;
  /** Whose changes they are, said after the commits: "from Juno and Theo". */
  readonly from: string | undefined;
  /** The changes it carries: `ChangeRow`s in a `ChangeList`. */
  readonly children?: ReactNode;
}) {
  // Waiting, and not this person's to release: what waits, and why it is not offered.
  if (!release.offered && !release.releasing)
    return (
      <PlaceNextCard
        facts={[...(release.reason === undefined ? [] : [release.reason]), from]}
        state="waiting"
        title={nextReleaseTitle(ready)}
      >
        {children}
      </PlaceNextCard>
    );
  const view = nextReleaseView({ release, ready });
  if (view.kind === "none") return null;
  return (
    <PlaceNextCard
      facts={view.kind === "releasing" ? [] : [...view.facts, from]}
      lead={view.kind === "failed" ? <Badge tone="danger">{view.pill}</Badge> : undefined}
      state={view.kind}
      title={view.title}
      verb={
        <Button
          data-zerops-primary-action={REVIEW_RELEASE_LABEL}
          onClick={(event) => {
            release.onReview(event.currentTarget);
          }}
          size="md"
          variant={view.kind === "ready" ? "primary" : "secondary"}
        >
          {view.verb}
        </Button>
      }
    >
      {children}
    </PlaceNextCard>
  );
}

/**
 * The card itself. Props: `title`; `facts` (one muted line under it; empty parts left out); `lead`
 * (a pill before the title); `verb` (one `Button`); `state` (a data attribute naming the state, for
 * tests and harnesses); `children` (`ChangeRow`s in a `ChangeList`, under a hairline).
 */
export function PlaceNextCard({
  title,
  facts = NO_FACTS,
  lead,
  verb,
  state,
  children,
}: {
  readonly title: string;
  readonly facts?: ReadonlyArray<string | undefined>;
  readonly lead?: ReactNode;
  readonly verb?: ReactNode;
  readonly state: string;
  readonly children?: ReactNode;
}) {
  const line = facts.filter((fact) => fact !== undefined && fact !== "").join(" · ");
  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.06]"
      data-zerops-next-block=""
    >
      <div
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
        data-zerops-next-release={state}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2.5">
            {lead}
            <span className="min-w-0 text-base font-semibold text-foreground">{title}</span>
          </div>
          {line === "" ? null : <span className="text-body text-muted-foreground">{line}</span>}
        </div>
        {verb === undefined || verb === null ? null : <span className="flex shrink-0">{verb}</span>}
      </div>
      {children === undefined || children === null ? null : (
        <div className="border-t border-primary/15 px-5 pt-3 pb-2">{children}</div>
      )}
    </div>
  );
}
