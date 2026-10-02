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
 * that carries it.
 *
 * The views take every read handed in, so the harness shows each state.
 */
import {
  buildZeropsGroupTree,
  holdReleaseFacts,
  RELEASE_NOT_A_RELEASER,
  releaseFacts,
  releaseFollows,
  releaseOutcomeOf,
  releaseStageMarks,
  releaseStep,
  releaseContentsCommits,
  releaseReview,
  reviewAge,
  deployedCommit,
  rollbackReview,
  sameCommit,
  shortCommit,
  stageStandings,
  type ReleaseFacts,
  type ReleaseGate,
  type ReleaseReplaces,
  type ReleaseOutcome,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Fragment, useMemo, useState } from "react";

import { useFixMates } from "~/zerops/fixMates";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useZeropsProjectFlowOptional, type ZeropsProjectFlow } from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";

import { ZeropsChangeReview } from "./ZeropsChangeReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "./ZeropsReleaseSteps";
import { releaseChangeRows, reviewKindLine } from "./ZeropsReview.logic";
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
  // What the release is — its tag, what it replaces, what goes out and where — held from the
  // press, or from the first look at it on its way: once it lands, the reads are the state it made.
  const [held, setHeld] = useState<ReleaseFacts | undefined>(undefined);
  const follows = releaseFollows({
    made,
    held,
    press,
    inFlight: flow.release.inFlight,
    suggestion: flow.release.suggestion,
    releases: flow.releases,
  });
  const clockMs = useSecondsNowMs(follows.ticking);

  const mainStage = flow.environmentInputs.find(
    (entry) =>
      entry.tier === "stage" &&
      flow.environments.find((row) => row.projectId === entry.projectId)?.source === "main",
  );
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  const {
    outcome,
    held: keep,
    facts,
  } = releaseStep({
    follows,
    held,
    press,
    clockMs,
    read: (tag) =>
      releaseFacts({
        tag,
        live: flow.releases.find((entry) => entry.standing === "live")?.tag,
        releases: flow.releases,
        contents: flow.release.contents,
        mainHeads: flow.mainHeads,
        comparison: flow.release.comparison,
        productionServices: production?.services.map((entry) => entry.hostname) ?? [],
      }),
  });
  if (keep !== held) setHeld(keep);
  // The changes are the release's; where each stands on the stage is read as it stands now.
  const stage = useMemo(
    () =>
      mainStage === undefined
        ? undefined
        : stageStandings({
            environment: mainStage,
            deployment: flowValue?.deployments.get(mainStage.projectId),
          }),
    [flowValue?.deployments, mainStage],
  );
  const marks = useMemo(() => releaseStageMarks(facts, stage), [facts, stage]);
  const rows = releaseChangeRows({
    commits: releaseContentsCommits(facts.contents),
    merged: flow.merged,
    marks,
  }).map((row) => {
    const mate = row.mateProjectId === undefined ? undefined : mates.get(row.mateProjectId);
    const mateName =
      mate?.name ??
      (row.mateProjectId === undefined ? undefined : flowValue?.mateNames.get(row.mateProjectId));
    const age =
      row.mergedAt === undefined ? undefined : reviewAge(row.mergedAt, now)?.toLowerCase();
    return {
      ...row,
      ...(mate === undefined ? {} : { face: { tint: mate.tint, shape: mate.shape } }),
      sub: [mateName, age === undefined ? undefined : `merged ${age}`]
        .filter((part) => part !== undefined)
        .join(" · "),
    };
  });
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
      hasStage={mainStage !== undefined}
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
      replaces={facts.replaces}
      rows={rows}
      services={facts.services}
      tag={facts.tag}
      titleId={titleId}
      where={facts.where}
    />
  );
}

export interface ReleaseReviewViewProps {
  /** The project's name: the title is it and the version. */
  readonly name: string | undefined;
  readonly tag: string;
  readonly gate: ReleaseGate;
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  readonly hasStage: boolean;
  readonly services: ReadonlyArray<string>;
  /** What production ran as this one was offered. */
  readonly replaces: ReleaseReplaces;
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
    changes: rows.length,
    onStage: props.hasStage
      ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
      : undefined,
    services: props.services,
    replaces: props.replaces,
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
      meta={model.meta.map((part, index) => (
        <Fragment key={part}>
          {index === 0 ? null : <span aria-hidden="true">·</span>}
          <span>{part}</span>
        </Fragment>
      ))}
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
      {rows.length === 0 ? null : (
        <ReviewSection
          aside={`${String(rows.length)} ${rows.length === 1 ? "change" : "changes"}`}
          title="What goes out"
        >
          <ReviewReleaseRows onOpen={props.onOpenChange} rows={rows} />
        </ReviewSection>
      )}
      {props.where.length === 0 ? null : (
        <ReviewSection title="Where">
          <ReviewWhere rows={props.where} />
        </ReviewSection>
      )}
      {model.ifWrong === undefined ? null : (
        <ReviewSection title="If it goes wrong">
          <p className="rv-words">{model.ifWrong}</p>
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
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
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The tag the roll back made — its own read of the tags, not the flow's guess — which the
  // review follows through the broker's verdict and production's deploy, as a release's.
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
  // What production ran as it was offered, held from the press: once it lands, production runs
  // the roll back's own tag.
  const current = { tag, live: flow.releases.find((entry) => entry.standing === "live")?.tag };
  const [held, setHeld] = useState<typeof current | undefined>(undefined);
  const keep = holdReleaseFacts({ held, current, press, outcome });
  if (keep !== held) setHeld(keep);
  const live = (keep ?? current).live;
  const earlier = flow.releases.find((entry) => entry.tag === tag);
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  const running = new Map(
    (production?.services ?? []).map((service) => [service.hostname, service.appVersionName]),
  );
  const moving = (earlier?.entries ?? [])
    .filter((entry) => !sameCommit(deployedCommit(running.get(entry.service)), entry.commit))
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
      line={earlier?.line}
      live={live}
      // Rolling back is a release: only a releaser tags, whatever else holds Release back now.
      mayRelease={flow.release.gate.allowed || flow.release.gate.reason !== RELEASE_NOT_A_RELEASER}
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
  readonly mayRelease: boolean;
  readonly press: ReviewPress;
  /** Where the tag it made stands, once it was made. */
  readonly outcome: ReleaseOutcome;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRollBack: () => void;
  readonly onClose: () => void;
}

export function RollbackReviewView(props: RollbackReviewViewProps) {
  const { press, tag } = props;
  const model = rollbackReview({
    tag,
    nextTag: props.nextTag,
    live: props.live,
    services: props.services,
    mayRelease: props.mayRelease,
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
          {model.meta === undefined ? null : <span>{model.meta}</span>}
          {props.line === undefined ? null : (
            <>
              {model.meta === undefined ? null : <span aria-hidden="true">·</span>}
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
      {props.where.length === 0 ? null : (
        <ReviewSection title="Where">
          <ReviewWhere rows={props.where} />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}
