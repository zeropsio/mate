/**
 * A release's review, and a roll back's (R5, R6).
 *
 * What goes out — one row per change, its Mate's face, and whether the stage that follows `main`
 * runs it — where it goes, and what to do if it goes wrong. The button names the version and the
 * foot says what the tag does. Pressed, it stays: it shows the release on its way, and ends with
 * "Released" or with the failure and the fix to hand to the person's own Mate (S6).
 *
 * Each change row opens that change's review in place (`ZeropsReleaseSteps`): the change, merged,
 * and "← Release" back to where the release was.
 *
 * A roll back is the same review, naming the version production goes back to and the new tag
 * that carries it: what leaves production and what comes back, each change by its title and its
 * Mate, as HQ compares them from what production runs (`rollbackReads`).
 *
 * The views take every read handed in, so the harness shows each state.
 */
import {
  cannotTellWhatRuns,
  buildZeropsGroupTree,
  movedCommits,
  movedCount,
  releaseReview,
  reviewAge,
  rollbackReads,
  rollbackReview,
  sameCommit,
  shortCommit,
  stageMarks,
  stageStandings,
  type CompareRead,
  type FlowReleaseRow,
  type MovedCommits,
  type ProductionRun,
  type ReleaseEntry,
  type ReleaseGate,
  type ReleaseOutcome,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo, useState, type ReactNode } from "react";

import { useFixMates } from "~/zerops/fixMates";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useZeropsProjectFlowOptional, type ZeropsProjectFlow } from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useZeropsCompares } from "~/zerops/useZeropsCompares";
import { useZeropsReviewMates, type ZeropsReviewMate } from "~/zerops/useZeropsReviewMates";

import { ZeropsChangeReview } from "./ZeropsChangeReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "./ZeropsReleaseSteps";
import {
  changesCountWords,
  releaseChangeRows,
  reviewKindLine,
  rollbackListNote,
  type ReleaseChangeRow,
  type ReleaseStageMark,
  type RollbackSide,
} from "./ZeropsReview.logic";
import {
  ReviewReleaseRows,
  ReviewSection,
  ReviewWhere,
  ZeropsReviewSurface,
  type ReviewReleaseRow,
} from "./ZeropsReviewSurface";

type ReleaseTarget = Extract<ReviewTarget, { readonly kind: "release" | "rollback" }>;

function useGroupName(groupId: string): string | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    () =>
      buildZeropsGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group.name,
    [groupId, listing],
  );
}

export function ZeropsReleaseReview({
  target,
  titleId,
  onClose,
}: {
  readonly target: ReleaseTarget;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(target.groupId);
  const name = useGroupName(target.groupId);
  const kind = target.kind === "release" ? "release" : "rollback";
  if (flow === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing is tagged from here until the project is read."
        kind={kind}
        kindLabel={reviewKindLine(kind)}
        onClose={onClose}
        title={name ?? "Production"}
        titleId={titleId}
        verdict={{
          state: "releasing",
          tone: "busy",
          title: "Reading the project",
          why: "What production runs and what waits for it",
          fix: undefined,
        }}
      />
    );
  }
  return target.kind === "release" ? (
    <ReleaseSteps
      flow={flow}
      groupId={target.groupId}
      name={name}
      onClose={onClose}
      titleId={titleId}
    />
  ) : (
    <RollbackData flow={flow} name={name} onClose={onClose} tag={target.tag} titleId={titleId} />
  );
}

/** A change read from its release hands over to nothing: it is already in the release. */
const STAYS = () => {};

/** The release, and a change it carries read in place: the title is the shown step's. */
function ReleaseSteps({
  flow,
  groupId,
  name,
  titleId,
  onClose,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly groupId: string;
  readonly name: string | undefined;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  const steps = useReleaseSteps();
  const onChange = steps.step.view === "change";
  return (
    <ZeropsReleaseSteps
      change={
        steps.shown === undefined ? null : (
          <ZeropsChangeReview
            onBack={steps.back}
            onClose={onClose}
            onReplace={STAYS}
            target={{ kind: "change", groupId, ...steps.shown }}
            titleId={onChange ? titleId : undefined}
          />
        )
      }
      release={
        <ReleaseData
          flow={flow}
          name={name}
          onClose={onClose}
          onOpenChange={steps.open}
          titleId={onChange ? undefined : titleId}
        />
      }
      steps={steps}
    />
  );
}

/** Where the tag it made stands: on its way, live, or failed — `undefined` before it was made. */
export function releaseOutcomeOf(input: {
  readonly tagged: FlowReleaseRow | undefined;
  readonly releasing: boolean;
  readonly pressing: boolean;
  readonly tag: string;
  readonly clockMs: number;
}): ReleaseOutcome {
  const { tagged } = input;
  if (tagged?.standing === "live") return { kind: "released", at: tagged.taggedAt };
  if (tagged?.standing === "deploy-failed" || tagged?.verdict === "refused") {
    const service = tagged.failedEntry?.service;
    return {
      kind: "failed",
      detail:
        tagged.verdict === "refused"
          ? (tagged.detail ?? "HQ refused the release")
          : service === undefined
            ? "Its production deploy failed"
            : `The deploy of ${service} failed`,
      service,
      at: tagged.taggedAt,
    };
  }
  if (!input.releasing) return { kind: "offered" };
  if (input.pressing && tagged === undefined) {
    return { kind: "releasing", progress: `Tagging main as ${input.tag}` };
  }
  const since = tagged?.taggedAt === undefined ? Number.NaN : Date.parse(tagged.taggedAt);
  if (Number.isNaN(since)) {
    return { kind: "releasing", progress: `Production redeploys from ${input.tag}` };
  }
  const elapsed = Math.max(0, Math.floor((input.clockMs - since) / 1000));
  const clock = `${String(Math.floor(elapsed / 60))}:${String(elapsed % 60).padStart(2, "0")}`;
  return { kind: "releasing", progress: `Production redeploys from ${input.tag} · ${clock}` };
}

/** Each row with its Mate's face, and under its title whose Mate it is and when it merged. */
function reviewRowsOf(
  rows: ReadonlyArray<ReleaseChangeRow>,
  names: {
    readonly mates: ReadonlyMap<string, ZeropsReviewMate>;
    readonly mateNames: ReadonlyMap<string, string> | undefined;
    readonly now: number;
  },
): ReadonlyArray<ReviewReleaseRow> {
  return rows.map((row) => {
    const mate = row.mateProjectId === undefined ? undefined : names.mates.get(row.mateProjectId);
    const mateName =
      mate?.name ??
      (row.mateProjectId === undefined ? undefined : names.mateNames?.get(row.mateProjectId));
    const age =
      row.mergedAt === undefined ? undefined : reviewAge(row.mergedAt, names.now)?.toLowerCase();
    return {
      ...row,
      ...(mate === undefined ? {} : { face: { tint: mate.tint, shape: mate.shape } }),
      sub: [mateName, age === undefined ? undefined : `merged ${age}`]
        .filter((part) => part !== undefined)
        .join(" · "),
    };
  });
}

function ReleaseData({
  flow,
  name,
  titleId,
  onClose,
  onOpenChange,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly name: string | undefined;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenChange: (row: ReviewReleaseRow) => void;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const mates = useZeropsReviewMates(flow.groupId);
  const askMateToFix = useAskMateToFix();
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The version this review tags — the suggestion when it was pressed, or the one on its way.
  const [made, setMade] = useState<string | undefined>(undefined);
  const inFlight = flow.release.inFlight;
  const tag = made ?? inFlight ?? flow.release.suggestion;
  const tagged = flow.releases.find((entry) => entry.tag === tag);
  const releasing = press.kind === "running" || press.kind === "done" || inFlight === tag;
  const clockMs = useSecondsNowMs(releasing && tagged?.standing === undefined);
  const outcome = releaseOutcomeOf({
    tagged,
    releasing,
    pressing: press.kind === "running",
    tag,
    clockMs,
  });

  const mainStage = flow.environmentInputs.find(
    (entry) =>
      entry.tier === "stage" &&
      flow.environments.find((row) => row.projectId === entry.projectId)?.source === "main",
  );
  const marks = useMemo(
    () =>
      stageMarks({
        contents: flow.release.contents,
        stage:
          mainStage === undefined
            ? undefined
            : stageStandings({
                environment: mainStage,
                deployment: flowValue?.deployments.get(mainStage.projectId),
              }),
      }),
    [flow.release.contents, flowValue?.deployments, mainStage],
  );
  const rows = reviewRowsOf(releaseChangeRows({ moved: flow.release.contents, marks }), {
    mates,
    mateNames: flowValue?.mateNames,
    now,
  });
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  const moving = flow.release.comparison.filter((row) => row.changed).map((row) => row.service);
  // A failed release is anybody's to fix: the person's own Mate in the project, the one they
  // used last (S6, `fixMates.ts`).
  const [fixer] = useFixMates({
    projectId: production?.projectId ?? flow.groupId,
    groupId: flow.groupId,
  });

  const release = async () => {
    if (flowValue === null) return;
    setMade(flow.release.suggestion);
    setPress({ kind: "running" });
    const answer = await flowValue.release(flow.groupId);
    setPress(answer.ok ? { kind: "done" } : { kind: "refused", reason: answer.reason });
    // The tag it made is the one the review follows from here.
    setMade(answer.ok ? (answer.tag ?? flow.release.suggestion) : undefined);
  };

  return (
    <ReleaseReviewView
      fixer={fixer?.name}
      gate={flow.release.gate}
      permission={flow.release.permission}
      hasStage={mainStage !== undefined}
      live={flow.releases.find((entry) => entry.standing === "live")?.tag}
      name={name}
      now={now}
      onClose={onClose}
      onOpenChange={onOpenChange}
      onFix={(problem) => {
        if (fixer === undefined) return;
        askMateToFix(fixer.mateProjectId, problem);
        onClose();
      }}
      onRelease={() => {
        void release();
      }}
      outcome={outcome}
      press={press}
      rows={rows}
      untold={flow.release.untold}
      services={
        moving.length === 0 ? (production?.services.map((entry) => entry.hostname) ?? []) : moving
      }
      tag={tag}
      titleId={titleId}
      where={flow.release.comparison.map((row) => ({
        service: row.service,
        line: row.changed
          ? `redeploys from ${row.candidate ?? "main"}`
          : `stays on ${row.production ?? "what it runs"}`,
      }))}
    />
  );
}

export interface ReleaseReviewViewProps {
  /** The project's name: the title is it and the version. */
  readonly name: string | undefined;
  readonly tag: string;
  readonly gate: ReleaseGate;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  /** Production's services whose commit cannot be told: what goes live on them is not said. */
  readonly untold: ReadonlyArray<string>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  readonly hasStage: boolean;
  readonly services: ReadonlyArray<string>;
  readonly live: string | undefined;
  readonly outcome: ReleaseOutcome;
  readonly press: ReviewPress;
  /** The person's own Mate a failure is handed to, the one they used last. */
  readonly fixer: string | undefined;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRelease: () => void;
  readonly onFix: (problem: FixProblem) => void;
  /** A change row pressed: its review, in place. */
  readonly onOpenChange?: ((row: ReviewReleaseRow) => void) | undefined;
  readonly onClose: () => void;
}

export function ReleaseReviewView(props: ReleaseReviewViewProps) {
  const { rows, press, tag } = props;
  const model = releaseReview({
    tag,
    gate: props.gate,
    permission: props.permission,
    changes: rows.length,
    onStage: props.hasStage
      ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
      : undefined,
    services: props.services,
    live: props.live,
    outcome: props.outcome,
    now: props.now,
  });
  const fix = model.verdict.fix;
  const refused = press.kind === "refused" ? press.reason : undefined;
  return (
    <ZeropsReviewSurface
      consequence={refused ?? model.consequence}
      dismiss={model.primary === undefined ? "Close" : "Cancel"}
      fix={
        fix === undefined || props.fixer === undefined
          ? undefined
          : {
              label: `Ask ${props.fixer} to ${fix.verb}`,
              onPress: () => {
                props.onFix(fix.problem);
              },
            }
      }
      kind="release"
      kindLabel={reviewKindLine("release")}
      meta={
        <>
          <span>{props.live === undefined ? "the first release" : `replaces ${props.live}`}</span>
          <span aria-hidden="true">·</span>
          <span>
            {rows.length} {rows.length === 1 ? "change" : "changes"}
          </span>
        </>
      }
      onClose={props.onClose}
      primary={
        model.primary === undefined
          ? undefined
          : {
              ...model.primary,
              icon: "tag",
              busy: press.kind === "running",
              label: press.kind === "running" ? `Releasing ${tag}` : model.primary.label,
              onPress: props.onRelease,
            }
      }
      title={`${props.name ?? "Production"} ${tag}`}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      {rows.length === 0 && props.untold.length === 0 ? null : (
        <ReviewSection
          aside={`${String(rows.length)} ${rows.length === 1 ? "change" : "changes"}`}
          title="What goes out"
        >
          {rows.length === 0 ? null : <ReviewReleaseRows onOpen={props.onOpenChange} rows={rows} />}
          {props.untold.length === 0 ? null : (
            <p className="text-sm text-muted-foreground">{cannotTellWhatRuns(props.untold)}.</p>
          )}
        </ReviewSection>
      )}
      {props.where.length === 0 ? null : (
        <ReviewSection title="Where">
          <ReviewWhere rows={props.where} />
        </ReviewSection>
      )}
      {props.live === undefined ? null : (
        <ReviewSection title="If it goes wrong">
          <p className="rv-words">
            Roll back to {props.live} from production's menu. It gets its own review.
          </p>
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}

/** A roll back's list as HQ compared it: its rows and how many move, or why that is not known. */
export type RollbackList =
  | {
      readonly state: "known";
      readonly rows: ReadonlyArray<ReviewReleaseRow>;
      readonly count: number;
      readonly atLeast: boolean;
    }
  | { readonly state: "reading" }
  | { readonly state: "failed"; readonly reason: string };

/** What a roll back takes off production and brings back, and the services nothing is told of. */
interface RollbackLists {
  readonly leaving: MovedCommits;
  readonly comingBack: MovedCommits;
  readonly untold: ReadonlyArray<string>;
}

const NO_ASKS: ReadonlyMap<string, ReadonlyArray<CompareRead>> = new Map();
const COMPARING: MovedCommits = { state: "reading" };
const LISTS_UNREAD: RollbackLists = { leaving: COMPARING, comingBack: COMPARING, untold: [] };
/** A roll back's rows are never marked by the stage: nothing it brings back is new to `main`. */
const NO_MARKS: ReadonlyMap<string, ReleaseStageMark> = new Map();

/**
 * What HQ compares a roll back to `entries` from: per service, the commits production runs that the
 * release does not, and the ones it lists that production does not run — asked once what
 * production runs and the repositories it builds from are known.
 */
function useRollbackLists(
  groupId: string,
  entries: ReadonlyArray<ReleaseEntry> | undefined,
  runs: ReadonlyMap<string, ProductionRun> | undefined,
  repositories: ReadonlyMap<string, string> | undefined,
): RollbackLists {
  const reads = useMemo(
    () =>
      entries === undefined || runs === undefined || repositories === undefined
        ? undefined
        : rollbackReads({ productionRepositories: repositories, entries, running: runs }),
    [entries, repositories, runs],
  );
  const asks = useMemo(
    () =>
      reads === undefined ? NO_ASKS : new Map([[groupId, [...reads.leaving, ...reads.comingBack]]]),
    [groupId, reads],
  );
  const compares = useZeropsCompares(asks);
  return useMemo(() => {
    if (reads === undefined) return LISTS_UNREAD;
    const answered = compares.get(groupId);
    const listOf = (listReads: ReadonlyArray<CompareRead>): MovedCommits =>
      answered === undefined ? COMPARING : movedCommits({ reads: listReads, ...answered });
    return {
      leaving: listOf(reads.leaving),
      comingBack: listOf(reads.comingBack),
      untold: reads.untold,
    };
  }, [compares, groupId, reads]);
}

function RollbackData({
  flow,
  name,
  tag,
  titleId,
  onClose,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly name: string | undefined;
  readonly tag: string;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const mates = useZeropsReviewMates(flow.groupId);
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The release the roll back made — HQ's answer, not the flow's guess — which the review follows
  // through HQ's record of it and production's deploy, as a release's.
  const [made, setMade] = useState<string | undefined>(undefined);
  const tagged = made === undefined ? undefined : flow.releases.find((entry) => entry.tag === made);
  const clockMs = useSecondsNowMs(press.kind === "done" && tagged?.standing === undefined);
  const outcome = releaseOutcomeOf({
    tagged,
    releasing: press.kind === "done",
    pressing: false,
    tag: made ?? flow.release.suggestion,
    clockMs,
  });
  const earlier = flow.releases.find((entry) => entry.tag === tag);
  const { runs, repositories } = flow.release;
  const lists = useRollbackLists(flow.groupId, earlier?.entries, runs, repositories);
  const listOf = (moved: MovedCommits): RollbackList =>
    moved.state !== "known"
      ? moved
      : {
          state: "known",
          rows: reviewRowsOf(releaseChangeRows({ moved: moved.moved, marks: NO_MARKS }), {
            mates,
            mateNames: flowValue?.mateNames,
            now,
          }),
          ...movedCount(moved.moved),
        };
  // A service moves where production runs another commit than the release lists, or none.
  const moving = (earlier?.entries ?? [])
    .filter(({ service, commit }) => {
      const run = runs?.get(service);
      return run?.kind === "nothing" || (run?.kind === "commit" && !sameCommit(run.sha, commit));
    })
    .map((entry) => entry.service);
  const rollBack = async () => {
    if (flowValue === null) return;
    setPress({ kind: "running" });
    const answer = await flowValue.rollBack(flow.groupId, tag);
    setPress(answer.ok ? { kind: "done" } : { kind: "refused", reason: answer.reason });
    if (answer.ok) setMade(answer.tag);
  };
  return (
    <RollbackReviewView
      comingBack={listOf(lists.comingBack)}
      leaving={listOf(lists.leaving)}
      line={earlier?.line}
      live={flow.releases.find((entry) => entry.standing === "live")?.tag}
      // Rolling back is a release: HQ's rule for releasing decides, whatever else holds Release
      // back now.
      permission={flow.release.permission}
      name={name}
      nextTag={made ?? flow.release.suggestion}
      now={now}
      onClose={onClose}
      onRollBack={() => {
        void rollBack();
      }}
      outcome={outcome}
      press={press}
      services={
        moving.length === 0 ? (earlier?.entries.map((entry) => entry.service) ?? []) : moving
      }
      tag={tag}
      titleId={titleId}
      untold={lists.untold}
      where={(earlier?.entries ?? []).map((entry) => ({
        service: entry.service,
        line: `goes back to ${shortCommit(entry.commit)}`,
      }))}
    />
  );
}

export interface RollbackReviewViewProps {
  readonly name: string | undefined;
  /** The earlier release production goes back to. */
  readonly tag: string;
  /** The tag the roll back makes. */
  readonly nextTag: string;
  readonly live: string | undefined;
  /** What the earlier release lists, short: `app 3fa9c21 · api 3fa9c21`. */
  readonly line: string | undefined;
  readonly services: ReadonlyArray<string>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** What production runs that the release does not: it leaves production. */
  readonly leaving: RollbackList;
  /** What the release lists that production does not run: it comes back. */
  readonly comingBack: RollbackList;
  /** Production's services whose commit cannot be told: what moves on them is not said. */
  readonly untold: ReadonlyArray<string>;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly press: ReviewPress;
  /** Where the tag it made stands, once it was made. */
  readonly outcome: ReleaseOutcome;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRollBack: () => void;
  readonly onClose: () => void;
}

/** One of a roll back's lists: its changes and how many, or what is said in their place. */
function RollbackListSection({
  title,
  side,
  list,
  children,
}: {
  readonly title: string;
  readonly side: RollbackSide;
  readonly list: RollbackList;
  readonly children?: ReactNode;
}) {
  const listed = list.state === "known" && list.rows.length > 0;
  return (
    <ReviewSection
      aside={listed ? changesCountWords(list.count, list.atLeast) : undefined}
      title={title}
    >
      {listed ? (
        <ReviewReleaseRows rows={list.rows} />
      ) : (
        <p className="text-sm text-muted-foreground">{rollbackListNote(side, list)}</p>
      )}
      {children}
    </ReviewSection>
  );
}

export function RollbackReviewView(props: RollbackReviewViewProps) {
  const { press, tag } = props;
  const model = rollbackReview({
    tag,
    nextTag: props.nextTag,
    live: props.live,
    services: props.services,
    permission: props.permission,
    press,
    outcome: props.outcome,
    now: props.now,
  });
  return (
    <ZeropsReviewSurface
      consequence={model.consequence}
      dismiss={model.primary === undefined ? "Close" : "Cancel"}
      kind="rollback"
      kindLabel={reviewKindLine("rollback")}
      meta={
        <>
          <span>production runs {props.live ?? "a later release"}</span>
          {props.line === undefined ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{props.line}</span>
            </>
          )}
        </>
      }
      onClose={props.onClose}
      primary={
        model.primary === undefined
          ? undefined
          : {
              ...model.primary,
              icon: "rollback",
              busy: press.kind === "running",
              label: press.kind === "running" ? `Rolling back to ${tag}` : model.primary.label,
              onPress: props.onRollBack,
            }
      }
      title={`${props.name ?? "Production"} ${tag}`}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      <RollbackListSection list={props.leaving} side="leaving" title="Leaves production">
        {props.untold.length === 0 ? null : (
          <p className="text-sm text-muted-foreground">{cannotTellWhatRuns(props.untold)}.</p>
        )}
      </RollbackListSection>
      <RollbackListSection list={props.comingBack} side="coming-back" title="Comes back" />
      {props.where.length === 0 ? null : (
        <ReviewSection title="Where">
          <ReviewWhere rows={props.where} />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}
