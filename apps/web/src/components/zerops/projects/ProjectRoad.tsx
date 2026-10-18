/**
 * A project's state line and its road (`projectRoad.logic.ts`): Development, Stage and Production
 * as three stops on one thin line, with what waits between them on the line — changes in review,
 * a release ready to go (the page's door, a white chip), a release that failed — and one quiet line
 * under each stop. A stop that does not exist yet is a ghost, so the road's shape never changes.
 *
 * `CardRoad` is the overview card's; `RoadStops` the project page's row of stop names over its
 * three columns.
 */

import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

import { PlaceDot } from "./ProjectCards";
import type { PlaceLine } from "./projectCard.logic";
import {
  failedWords,
  inReviewWords,
  type ProjectState,
  type ReleaseSegment,
  type StopUnder,
} from "./projectRoad.logic";

/** The project's one state in small caps, its dot before it. */
export function ProjectStateLine({ state }: { readonly state: ProjectState }) {
  return (
    <p className="pp-road-state" data-state={state.kind} data-zerops-surface="project-state">
      <i aria-hidden="true" className="ov-dot" data-dot={state.dot} />
      <span>{state.words}</span>
    </p>
  );
}

/** A stop on the line: its place's dot, or a dashed ghost where the place does not exist yet. */
function Stop({ line }: { readonly line: PlaceLine | undefined }) {
  return line === undefined ? (
    <i aria-hidden="true" className="pp-road-stop" data-ghost="" />
  ) : (
    <span aria-hidden="true" className="pp-road-stop">
      <PlaceDot dot={line.dot} />
    </span>
  );
}

/** A quiet chip on the line: changes in review, merged work, a failed release. */
function LineChip({
  children,
  tone = "muted",
}: {
  readonly children: ReactNode;
  readonly tone?: "muted" | "failed" | "info";
}) {
  return (
    <span className="pp-road-chip" data-tone={tone}>
      {children}
    </span>
  );
}

const readyShown = (segment: ReleaseSegment) =>
  segment.kind === "ready" || (segment.kind === "failed" && segment.ready !== undefined);

/** What the line between Stage and Production carries: the ready door, a failure, merged work. */
function ReleaseChip({
  segment,
  door,
}: {
  readonly segment: ReleaseSegment;
  readonly door: ReactNode;
}) {
  switch (segment.kind) {
    case "ready":
      return door;
    case "failed":
      return (
        <>
          <LineChip tone="failed">{failedWords(segment.tag)}</LineChip>
          {segment.ready === undefined ? null : door}
        </>
      );
    case "merged":
      return <LineChip>{`${String(segment.count)} merged`}</LineChip>;
    case "none":
      return null;
  }
}

function Under({ under }: { readonly under: StopUnder | undefined }) {
  if (under === undefined || under.words.length === 0) return null;
  return (
    <span className="pp-road-under" data-tone={under.tone}>
      {under.words.join(" · ")}
    </span>
  );
}

export interface RoadReading {
  /** The main stage's line; `undefined` where the project has no stage. */
  readonly stage: PlaceLine | undefined;
  readonly production: PlaceLine;
  /** Production does not exist: a ghost stop. */
  readonly productionAbsent: boolean;
  readonly review: number;
  readonly segment: ReleaseSegment;
  /** The page's door for the release `segment` offers, drawn as its chip. */
  readonly releaseDoor: ReactNode;
  readonly stageUnder: StopUnder | undefined;
  readonly productionUnder: StopUnder | undefined;
}

/**
 * The card's road: the three stop names in small caps, the line with its stops and chips, and a
 * quiet line under Stage and Production. `putLive` stands under production where it can be made.
 */
export function CardRoad({
  road,
  stageNote,
  putLive,
}: {
  readonly road: RoadReading;
  /** Under the stage where none exists: "not added", or how far its adding has got. */
  readonly stageNote: ReactNode;
  readonly putLive: ReactNode;
}) {
  return (
    <div className="pp-road" data-zerops-surface="project-road">
      <div className="pp-road-names" aria-hidden="true">
        <span>Development</span>
        <span>Stage</span>
        <span>Production</span>
      </div>
      <div className="pp-road-line">
        <span aria-hidden="true" className="pp-road-stop">
          <i className="ov-dot" data-dot="none" data-dev="" />
        </span>
        <span className="pp-road-seg">
          {road.review === 0 ? null : <LineChip>{inReviewWords(road.review, false)}</LineChip>}
        </span>
        <span data-zerops-place="stage" className="contents">
          <Stop line={road.stage} />
        </span>
        <span
          className="pp-road-seg"
          data-zerops-card-ready={readyShown(road.segment) ? "true" : undefined}
        >
          <ReleaseChip door={road.releaseDoor} segment={road.segment} />
        </span>
        <Stop line={road.productionAbsent ? undefined : road.production} />
      </div>
      <div className="pp-road-unders">
        <span />
        <span className="pp-road-under-stage" data-zerops-place="stage">
          {road.stage === undefined ? stageNote : <Under under={road.stageUnder} />}
        </span>
        <span className="pp-road-under-prod" data-zerops-place="production">
          {putLive ?? <Under under={road.productionUnder} />}
        </span>
      </div>
    </div>
  );
}

/**
 * The project page's stop names in one row, joined by the line, the chips riding it; under each, its
 * column. `columns` are Development's, Stage's and Production's.
 */
export function PageRoad({
  road,
  columns,
}: {
  readonly road: RoadReading;
  readonly columns: readonly [ReactNode, ReactNode, ReactNode];
}) {
  return (
    <section aria-label="Road" className="pp-road-page" data-zerops-surface="project-road">
      <div className="pp-road-col" data-zerops-road="development">
        <h2 className="pp-road-head">
          <span aria-hidden="true" className="pp-road-stop">
            <i className="ov-dot" data-dot="none" data-dev="" />
          </span>
          <span className="pp-road-name">Development</span>
          <span className="pp-road-seg">
            {/* The changes in review open where the page lists them (its Changes card). */}
            {road.review === 0 ? null : (
              <Button render={<a href="#project-changes" />} size="sm" variant="secondary">
                {inReviewWords(road.review, true)}
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            )}
          </span>
        </h2>
        {columns[0]}
      </div>
      <div className="pp-road-col" data-zerops-road="stage">
        <h2 className="pp-road-head">
          <Stop line={road.stage} />
          <span className="pp-road-name">Stage</span>
          <span
            className="pp-road-seg"
            data-zerops-card-ready={readyShown(road.segment) ? "true" : undefined}
          >
            <ReleaseChip door={road.releaseDoor} segment={road.segment} />
          </span>
        </h2>
        {columns[1]}
      </div>
      <div className="pp-road-col" data-zerops-road="production">
        <h2 className="pp-road-head">
          <Stop line={road.productionAbsent ? undefined : road.production} />
          <span className="pp-road-name">Production</span>
        </h2>
        {columns[2]}
      </div>
    </section>
  );
}
