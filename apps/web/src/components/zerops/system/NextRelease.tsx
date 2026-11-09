/**
 * What goes to production next, the one place a page offers *Review release* (`nextReleaseView`):
 *
 * - `line` (overview card, project page inside Production, Mate panels): one tinted line — the
 *   title, its facts muted, the one verb at its end.
 * - `block` (the place's page, under its "Next release" label): the same line, then the changes it
 *   carries (`children`: `ChangeRow`s in a `ChangeList`).
 *
 * Nothing waiting draws nothing, so a caller needs no guard of its own.
 */
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { REVIEW_RELEASE_LABEL } from "~/zerops/review";
import type { CardReady } from "../projects/projectCard.logic";
import type { ReleaseOffer } from "../ZeropsReleaseVerb";
import { nextReleaseView } from "./NextRelease.logic";

/** What `NextRelease` reads: the shapes `useApplicationPlaces(groupId).next` hands over. */
export interface NextReleaseInput {
  /** `useReleaseOffer(groupId, flow)`: offered, on its way, its tag, and `onReview(from)`. */
  readonly release: ReleaseOffer;
  /** `cardReady(flow)`: how many changes and commits, where tested, what production runs. */
  readonly ready: CardReady | undefined;
  /** The stage runs every change it carries; `undefined` while unread or without a stage. */
  readonly onStage?: boolean | undefined;
}

/**
 * Props: `NextReleaseInput` (`release`, `ready`, `onStage`); `density` (default `line`);
 * `children` (`block` only: the changes it carries). The verb opens the release review
 * (`release.onReview` → `openReview({ kind: "release", groupId })`): ready, on its way (its
 * progress) and didn't go live (why) alike.
 */
export function NextRelease({
  release,
  ready,
  onStage,
  density = "line",
  children,
}: NextReleaseInput & {
  readonly density?: "line" | "block";
  readonly children?: ReactNode;
}) {
  const view = nextReleaseView({ release, ready, onStage });
  if (view.kind === "none") return null;
  return (
    <NextBlock
      facts={view.kind === "releasing" ? [] : view.facts}
      lead={view.kind === "failed" ? <Badge tone="danger">{view.pill}</Badge> : undefined}
      title={view.title}
      variant={density}
      verb={
        <Button
          data-zerops-primary-action={REVIEW_RELEASE_LABEL}
          onClick={(event) => {
            release.onReview(event.currentTarget);
          }}
          size="sm"
          variant={view.kind === "ready" ? "primary" : "secondary"}
        >
          {view.verb}
        </Button>
      }
      state={view.kind}
    >
      {children}
    </NextBlock>
  );
}

/**
 * What goes to a place next, in the next release's look without its words: one tinted line — a
 * `lead` (a pill), the title, its facts muted, a verb at its end — and, as a block, the rows it
 * carries under it. A stage's "3 changes ready to merge to stage" is one, with no verb of its own
 * where each `ChangeRow` carries its *Review*.
 *
 * Props: `title`; `facts` (muted after it); `lead` (before the title: a `Badge`); `verb` (one
 * `Button size="sm"`); `variant` (`line`, or `block` to draw `children` under the line; default
 * `block` where children are given); `state` (a data attribute naming the state, for tests and
 * harnesses); `children` (`ChangeRow`s in a `ChangeList`).
 */
export function NextBlock({
  title,
  facts = [],
  lead,
  verb,
  variant,
  state,
  children,
}: {
  readonly title: string;
  readonly facts?: ReadonlyArray<string>;
  readonly lead?: ReactNode;
  readonly verb?: ReactNode;
  readonly variant?: "line" | "block";
  readonly state?: string;
  readonly children?: ReactNode;
}) {
  const line = (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-control bg-primary/10 px-3 py-2 text-body"
      data-zerops-next-release={state ?? ""}
    >
      {lead}
      <span className="min-w-0 font-medium text-foreground">{title}</span>
      {facts.map((fact) => (
        <span className="min-w-0 text-muted-foreground" key={fact}>
          {fact}
        </span>
      ))}
      {verb === undefined || verb === null ? null : (
        <span className="ms-auto flex shrink-0">{verb}</span>
      )}
    </div>
  );
  const block =
    variant === undefined ? children !== undefined && children !== null : variant === "block";
  if (!block) return line;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-zerops-next-block="">
      {line}
      {children}
    </div>
  );
}
