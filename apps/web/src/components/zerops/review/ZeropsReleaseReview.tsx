import type { HqProblem } from "@t3tools/shared/hqProblems";
import { problemsFix } from "@t3tools/client-runtime/zerops/hq";
import { HqProblems } from "./HqProblems";
import { GitDeliveryStatus, gitWhereLine } from "../GitDeliveryStatus";
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
 * Mate, as HQ compares them from what production runs (`rollbackReads`), each opening its review
 * in place with "← Roll back".
 *
 * The views take every read handed in, so the harness shows each state.
 */
import {
  cannotTellWhatRuns,
  type GroupFlowAddress,
  servicesDeploying,
  carriedByRecords,
  outsideMoved,
  carriedMoved,
  changesCountWords,
  holdReleaseFacts,
  movedCommits,
  movedCount,
  releaseFacts,
  releaseFollows,
  releaseOutcomeOf,
  releaseReview,
  releaseStageMarks,
  releaseStep,
  releaseVersionField,
  releaseWhereWords,
  releaseVersionSuggestions,
  reviewAge,
  rollbackFromHistories,
  rollbackOnItsWay,
  rollbackReads,
  rollbackReview,
  RELEASE_CHECKING,
  rollbackServices,
  shortCommit,
  stageRead,
  stageStandings,
  type CompareRead,
  type Moved,
  type ProductionRun,
  type ReleaseEntry,
  type ReleaseFacts,
  type ReleaseGate,
  type ReleaseOutcome,
  type ReleaseReplaces,
  type ReleaseVersionSuggestion,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Input } from "~/components/ui/input";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";

import { putLiveAddress } from "~/zerops/putLive.logic";
import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useFixMates } from "~/zerops/fixMates";
import { useLacksOwnDomain } from "~/zerops/ownDomain";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { releaseRequestOf, type HqAppDetailRead } from "@t3tools/client-runtime/data";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useReleaseServicePlan } from "~/zerops/useReleaseServicePlan";
import { useMateNames, useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import type { ReviewTarget } from "~/zerops/review";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { ZeropsReadFailure } from "../ZeropsReadFailure";
import { useReleaseComparisons, type ComparedCommits } from "~/zerops/useReleaseComparisons";
import { useZeropsReviewMates, type ZeropsReviewMate } from "~/zerops/useZeropsReviewMates";

import { ZeropsChangeReview } from "./ZeropsChangeReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "./ZeropsReleaseSteps";
import { mainStageOf, useGroupName, useProductionAddresses } from "./reviewReads";
import {
  productionBefore,
  productionNow,
  releaseChangeRows,
  releaseHeading,
  releaseLine,
  outsideCommitsWords,
  productionCode,
  reviewKindLine,
  rollbackListNote,
  sinceWords,
  whySaid,
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
import { useReviewDeploys } from "../ZeropsDeployAnswer";
import { jobInFlight } from "@t3tools/client-runtime/zerops/hq";
import { useDeployAnswerFollowing } from "~/zerops/activity/useDeployAnswerFollowing";
import { Button } from "~/components/ui/button";
import { GitBrowserLink, gitCodeLink } from "../gitBrowser/GitBrowserLink";

type ReleaseTarget = Extract<ReviewTarget, { readonly kind: "release" | "rollback" }>;

/** A release the review lists from what HQ recorded; an HQ that records none is compared instead. */
const COMPARED = { compare: true } as const;
/** What production runs and builds from, read from the store; nothing is compared. */
const PLANNED = { plan: true } as const;

export function ZeropsReleaseReview({
  target,
  titleId,
  onClose,
}: {
  readonly target: ReleaseTarget;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  // What a release lists is its application's detail: held while it is drawn.
  const detail = useHqAppDetail(target.groupId);
  // A read detail without the release's recorded changes is an HQ that does not record them: its
  // release is compared, as before. Otherwise nothing is compared on opening.
  const legacy =
    target.kind === "release" && detail.read === "read" && detail.releaseChanges === undefined;
  const { flows } = useProjectFlows(
    useMemo(() => [target.groupId], [target.groupId]),
    legacy ? COMPARED : PLANNED,
  );
  const flow = flows.get(target.groupId);
  const name = useGroupName(target.groupId);
  const kind = target.kind === "release" ? "release" : "rollback";
  if (flow === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing is tagged from here until the project is read."
        kind={kind}
        kindLabel={name ?? reviewKindLine(kind)}
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
    <ChangeSteps
      back="Release"
      groupId={target.groupId}
      onClose={onClose}
      review={(onOpenChange, shownTitleId) => (
        <ReleaseData
          detail={detail}
          flow={flow}
          legacy={legacy}
          name={name}
          onClose={onClose}
          onOpenChange={onOpenChange}
          titleId={shownTitleId}
        />
      )}
      titleId={titleId}
    />
  ) : (
    <ChangeSteps
      back="Roll back"
      groupId={target.groupId}
      onClose={onClose}
      review={(onOpenChange, shownTitleId) => (
        <RollbackData
          detail={detail}
          flow={flow}
          name={name}
          onClose={onClose}
          onOpenChange={onOpenChange}
          tag={target.tag}
          titleId={shownTitleId}
        />
      )}
      titleId={titleId}
    />
  );
}

/**
 * A release or a roll back, and a change it lists read in place, "← {back}" its way back: the
 * title is the shown step's.
 */
function ChangeSteps({
  back,
  groupId,
  titleId,
  onClose,
  review,
}: {
  readonly back: string;
  readonly groupId: string;
  readonly titleId: string;
  readonly onClose: () => void;
  /** The release's or the roll back's review, its rows opening their change, titled while shown. */
  readonly review: (
    onOpenChange: (row: ReviewReleaseRow) => void,
    titleId: string | undefined,
  ) => ReactNode;
}) {
  const steps = useReleaseSteps();
  const onChange = steps.step.view === "change";
  return (
    <ZeropsReleaseSteps
      change={
        steps.shown === undefined ? null : (
          <ZeropsChangeReview
            back={{ label: back, onPress: steps.back }}
            onClose={onClose}
            target={{ kind: "change", groupId, ...steps.shown }}
            titleId={onChange ? titleId : undefined}
          />
        )
      }
      release={review(steps.open, onChange ? undefined : titleId)}
      steps={steps}
    />
  );
}

/** Each row with its Mate's face, and under its title whose Mate it is and when it merged. */
function reviewRowsOf(
  rows: ReadonlyArray<ReleaseChangeRow>,
  names: {
    readonly mates: ReadonlyMap<string, ZeropsReviewMate>;
    readonly mateNames: ReadonlyMap<string, string> | undefined;
    readonly now: number;
    /** A release names each change's Mate alone; a roll back says when it merged too. */
    readonly ages: boolean;
  },
): ReadonlyArray<ReviewReleaseRow> {
  return rows.map((row) => {
    const mate = row.mateProjectId === undefined ? undefined : names.mates.get(row.mateProjectId);
    const mateName =
      mate?.name ??
      (row.mateProjectId === undefined ? undefined : names.mateNames?.get(row.mateProjectId));
    const age =
      row.mergedAt === undefined || !names.ages
        ? undefined
        : reviewAge(row.mergedAt, names.now)?.toLowerCase();
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
  detail,
  flow,
  legacy,
  name,
  titleId,
  onClose,
  onOpenChange,
}: {
  readonly detail: HqAppDetailRead;
  readonly flow: ZeropsProjectFlow;
  /** HQ records no changes for a release: what goes out is compared, as before. */
  readonly legacy: boolean;
  readonly name: string | undefined;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenChange: (row: ReviewReleaseRow) => void;
}) {
  const verbs = useFlowVerbs();
  const mateNames = useMateNames();
  const mates = useZeropsReviewMates(flow.groupId);
  const askMateToFix = useAskMateToFix();
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The version this review tags — the suggestion when it was pressed, or the one on its way.
  const [made, setMade] = useState<string | undefined>(undefined);
  // What the release is — its tag, what it replaces, what goes out and where — held from the
  // press, or from the first look at it on its way: once it lands, the reads are the state it made.
  const [held, setHeld] = useState<ReleaseFacts | undefined>(undefined);
  const [typedVersion, setTypedVersion] = useState<string | undefined>(undefined);
  const versionValue = typedVersion ?? flow.release.suggestion.slice(1);
  const versionTags = flow.releases.map((entry) => entry.tag);
  const chosen = releaseVersionField(versionValue, versionTags);
  const suggestions = releaseVersionSuggestions({
    repos: flow.repos ?? [],
    repositories: flow.release.repositories ?? new Map(),
    tags: versionTags,
  });
  const follows = releaseFollows({
    made,
    held,
    press,
    inFlight: flow.release.inFlight,
    stalled: flow.release.stalled,
    suggestion: chosen.tag ?? flow.release.suggestion,
    releases: flow.releases,
  });
  const clockMs = useSecondsNowMs(follows.ticking);

  // What goes out is what HQ recorded the release carries, with its changes' Mates from the
  // change list: nothing is read from a repository to open the review.
  const carried = useMemo(
    () =>
      legacy || detail.releaseChanges === undefined || detail.changes === undefined
        ? undefined
        : carriedByRecords({
            carried: detail.releaseChanges,
            known: detail.changes,
            repositories: flow.release.repositories,
          }),
    [detail.changes, detail.releaseChanges, flow.release.repositories, legacy],
  );
  const contents = legacy
    ? flow.release.contents
    : carried?.state === "known"
      ? carried.moved
      : NO_MOVED;
  const contentsKnown = legacy ? flow.release.contentsKnown : carried?.state === "known";

  const mainStage = mainStageOf(flow);
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  // Production's Zerops project, where it is one: a Git destination has no addresses here.
  const productionProject =
    production?.target.kind === "zerops" ? production.target.projectId : undefined;
  const productionAddresses = useProductionAddresses(productionProject);
  // Its Where row follows HQ's deploys of it: released is said with them, never before.
  const followed = useDeployAnswerFollowing(useReviewDeploys(press)).answer;
  const {
    outcome,
    held: keep,
    facts,
    productionMoved,
  } = releaseStep({
    follows,
    held,
    press,
    clockMs,
    deploying: followed?.jobs.some(jobInFlight) === true,
    read: (tag) =>
      releaseFacts({
        tag,
        live: flow.releases.find((entry) => entry.standing === "live")?.tag,
        releases: flow.releases,
        contents,
        comparison: flow.release.comparison,
        productionServices: production?.services.map((entry) => entry.hostname) ?? [],
      }),
  });
  if (keep !== held) setHeld(keep);
  // Once it is live, production on a domain of its own where it has none: read only from then.
  const orgId = useAccountOrgId();
  const offersDomain = useLacksOwnDomain(
    outcome.kind === "released" ? productionProject : undefined,
  );
  const onAddDomain =
    !offersDomain || orgId === null || productionProject === undefined
      ? undefined
      : () => {
          onClose();
          useAddressesSheet.getState().open({
            orgId,
            projectId: productionProject,
            groupId: flow.groupId,
            intent: "add-domain",
          });
        };
  // The changes are the release's; where each stands on the stage is read as it stands now, from
  // HQ's deploys, the same for everyone who sees the application.
  const stage = useMemo(
    () => (mainStage === undefined ? undefined : stageStandings(mainStage)),
    [mainStage],
  );
  // A stage on a repository's `main` head runs every change the release carries from it.
  const mainHeads = useMemo(
    () =>
      new Map(
        (flow.repos ?? []).flatMap(({ name: repository, mainHead }) =>
          mainHead === null ? [] : [[repository, mainHead] as const],
        ),
      ),
    [flow.repos],
  );
  const marks = useMemo(
    () => releaseStageMarks(facts, stage, mainHeads),
    [facts, mainHeads, stage],
  );
  const rows = reviewRowsOf(releaseChangeRows({ moved: facts.contents, marks }), {
    mates,
    mateNames,
    now,
    ages: false,
  });
  const outsideRecorded = useMemo<RecordedOutside | undefined>(() => {
    const stored = legacy ? undefined : detail.releaseOutside;
    if (stored === undefined) return undefined;
    return stored.summaryRead === "pending"
      ? { state: "pending" }
      : {
          state: "known",
          count: stored.count,
          moved: outsideMoved({
            commits: stored.commits,
            repositories: flow.release.repositories,
          }),
        };
  }, [detail.releaseOutside, flow.release.repositories, legacy]);
  const outside = useOutsideCommits({
    flow,
    recorded: outsideRecorded,
    // The count is the offer's commits less the changes the release carries: known when both are.
    count:
      legacy || carried?.state !== "known" || flow.release.summary === undefined
        ? undefined
        : flow.release.summaryRead === "pending"
          ? undefined
          : {
              total: Math.max(0, flow.release.summary.total - rows.length),
              atLeast: flow.release.summary.atLeast,
            },
    stage,
    mainHeads,
    mates,
    mateNames,
    now,
  });
  // A failed release is anybody's to fix: the person's own Mate in the project, the one they
  // used last (S6, `fixMates.ts`).
  const [fixer] = useFixMates(
    flow.release.git === undefined
      ? { projectId: production?.projectId ?? flow.groupId, groupId: flow.groupId }
      : undefined,
  );

  // A branch production releases only what HQ just found ready on its remote branch: the review
  // asks HQ to check it on opening and whenever what goes out changes, until it is pressed.
  const preflight = useGitTargetOperations(flow.groupId).actions?.preflight;
  const preflightRef = useRef(preflight);
  preflightRef.current = preflight;
  const [check, setCheck] = useState<{ readonly of: string; readonly why: string }>();
  const checked =
    flow.release.git === undefined
      ? undefined
      : flow.release.entries.map(({ service, commit }) => `${service}@${commit}`).join(" ");
  const checking = press.kind === "idle" ? checked : undefined;
  const canCheck = preflight !== undefined;
  useEffect(() => {
    if (checking === undefined || !canCheck) return;
    preflightRef.current?.().catch((error: unknown) => {
      setCheck({ of: checking, why: error instanceof Error ? error.message : String(error) });
    });
  }, [canCheck, checking]);

  const reviewing = press.kind === "idle" || press.kind === "refused";
  const plan = useReleaseServicePlan(
    flow,
    chosen.error === undefined ? chosen.tag : undefined,
    reviewing,
  );
  const reviewedPlan = plan.required && plan.view.kind === "ready" ? plan.view.plan : undefined;
  const planPending = reviewing && plan.required && plan.view.kind === "pending";
  const planFailure =
    reviewing && plan.required && plan.view.kind === "failed" ? plan.view.reason : undefined;
  const [heldPlan, setHeldPlan] = useState<ReleaseServicePlan>();
  const reviewedRequest = releaseRequestOf(flow.release, chosen.tag, reviewedPlan);
  const releaseGate =
    "refused" in reviewedRequest
      ? {
          allowed: false as const,
          reason: planPending ? "Reading production operations…" : reviewedRequest.refused,
        }
      : { allowed: true as const };

  const release = async () => {
    if (chosen.tag === undefined || chosen.error !== undefined) return;
    if (plan.required && reviewedPlan === undefined) return;
    // Capture the offer in the press. HQ's stream may change it before React draws "running".
    setHeldPlan(reviewedPlan);
    setHeld({ ...facts, tag: chosen.tag });
    setMade(chosen.tag);
    setPress({ kind: "running" });
    const answer =
      reviewedPlan === undefined
        ? await verbs.release(flow, chosen.tag)
        : await verbs.release(flow, chosen.tag, reviewedPlan);
    if (!answer.ok && plan.required) plan.again();
    setPress(
      answer.ok
        ? { kind: "done", deploys: answer.deploys, rollout: answer.rollout }
        : { kind: "refused", reason: answer.reason, problems: answer.problems },
    );
    // The tag it made is the one the review follows from here.
    setMade(answer.ok ? (answer.tag ?? chosen.tag) : undefined);
  };

  return (
    <ReleaseReviewView
      servicePlan={press.kind === "running" || press.kind === "done" ? heldPlan : reviewedPlan}
      servicePlanPending={planPending}
      problems={flow.release.problems}
      servicePlanFailure={planFailure}
      servicePlanProblems={
        reviewing && plan.required && plan.view.kind === "failed" ? plan.view.problems : undefined
      }
      onRetryServicePlan={plan.again}
      git={
        flow.release.git === undefined
          ? undefined
          : {
              ...flow.release.git,
              check: check !== undefined && check.of === checked ? check.why : undefined,
            }
      }
      changesPending={!contentsKnown}
      comparisonFailure={flow.release.comparisonFailure}
      fixer={fixer?.name}
      gate={releaseGate}
      production={{
        ...productionBefore({
          replaces: facts.replaces,
          releases: flow.releases,
          services: production?.services ?? [],
          releasing: outcome.kind === "releasing",
        }),
        addresses: productionAddresses,
      }}
      stage={
        mainStage === undefined
          ? undefined
          : { name: mainStage.name, at: newestLive(mainStage.services) }
      }
      permission={flow.release.permission}
      // A stage HQ never put anything live on counts nothing: no "0 of N".
      hasStage={stage !== undefined && stageRead(stage)}
      name={name}
      now={now}
      onClose={onClose}
      onOpenChange={onOpenChange}
      onFix={(problem) => {
        if (fixer === undefined) return;
        askMateToFix(fixer.mateProjectId, problem);
        onClose();
      }}
      onAddDomain={onAddDomain}
      appId={flow.groupId}
      productionCode={productionCode(flow.release)}
      onRelease={() => {
        void release();
      }}
      outcome={outcome}
      outside={outside}
      press={press}
      productionMoved={productionMoved}
      replaces={facts.replaces}
      rows={rows}
      untold={flow.release.untold}
      services={facts.services}
      tag={facts.tag}
      version={{
        value: versionValue,
        onChange: setTypedVersion,
        tags: versionTags,
        suggestions,
        nextPatch: flow.release.suggestion,
      }}
      titleId={titleId}
      where={facts.where}
    />
  );
}

const NO_MOVED: ReadonlyArray<Moved> = [];

/** The count of commits outside changes, with Show commits to list them. */
function OutsideCommitsList({
  outside,
  appId,
  onOpen,
}: {
  readonly outside: OutsideCommits;
  readonly appId: string | undefined;
  readonly onOpen: ((row: ReviewReleaseRow) => void) | undefined;
}) {
  const { list } = outside;
  if (list.state === "pending") {
    return <p className="rv-note">Commits outside changes: not known yet.</p>;
  }
  return (
    <>
      <p className="rv-note">
        {outsideCommitsWords(outside.count, outside.atLeast)}
        {list.state === "closed" ? (
          <>
            {" · "}
            <Button onClick={list.onShow} size="sm" variant="link">
              Show commits
            </Button>
          </>
        ) : null}
      </p>
      {list.state === "reading" ? <p className="rv-note">Comparing in HQ…</p> : null}
      {list.state === "failed" ? (
        <ZeropsReadFailure action="Compare again" reason={list.reason} again={list.again} />
      ) : null}
      {list.state === "known" ? (
        <ReviewReleaseRows appId={appId} onOpen={onOpen} rows={list.rows} />
      ) : null}
      {list.state === "known" && list.rows.length < outside.count ? (
        <p className="rv-note">{`The newest ${String(list.rows.length)} are shown.`}</p>
      ) : null}
    </>
  );
}
const NO_APP_IDS: ReadonlyArray<string> = [];

/** The commits a release carries that no change landed: how many, and their list once asked for. */
export interface OutsideCommits {
  readonly count: number;
  readonly atLeast: boolean;
  readonly list:
    | { readonly state: "closed"; readonly onShow: () => void }
    | { readonly state: "pending" }
    | { readonly state: "reading" }
    | {
        readonly state: "failed";
        readonly reason: string;
        readonly again?: (() => void) | undefined;
      }
    | { readonly state: "known"; readonly rows: ReadonlyArray<ReviewReleaseRow> };
}

/** The commits outside changes as HQ stored them: not known yet, or their number and newest. */
type RecordedOutside =
  | { readonly state: "pending" }
  | { readonly state: "known"; readonly count: number; readonly moved: ReadonlyArray<Moved> };

/**
 * The commits outside changes come from what HQ stored when it has stored them: the person's ask
 * only unfolds them. An HQ that stores none counts them from the offer, and compares the release,
 * so reads its repositories, only once the person asks to see them.
 */
function useOutsideCommits({
  flow,
  recorded,
  count,
  stage,
  mainHeads,
  mates,
  mateNames,
  now,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly recorded: RecordedOutside | undefined;
  readonly count: { readonly total: number; readonly atLeast: boolean } | undefined;
  readonly stage: ReturnType<typeof stageStandings> | undefined;
  readonly mainHeads: ReadonlyMap<string, string>;
  readonly mates: ReadonlyMap<string, ZeropsReviewMate>;
  readonly mateNames: ReadonlyMap<string, string> | undefined;
  readonly now: number;
}): OutsideCommits | undefined {
  const [asked, setAsked] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const { flows } = useProjectFlows(
    useMemo(() => (asked ? [flow.groupId] : NO_APP_IDS), [asked, flow.groupId]),
    asked ? COMPARED : undefined,
  );
  if (recorded?.state === "pending") {
    return { count: 0, atLeast: false, list: { state: "pending" } };
  }
  if (recorded?.state === "known") {
    if (recorded.count === 0) return undefined;
    return {
      count: recorded.count,
      atLeast: false,
      list: unfolded
        ? {
            state: "known",
            rows: reviewRowsOf(
              releaseChangeRows({
                moved: recorded.moved,
                marks: releaseStageMarks({ contents: recorded.moved }, stage, mainHeads),
              }),
              { mates, mateNames, now, ages: false },
            ),
          }
        : { state: "closed", onShow: () => setUnfolded(true) },
    };
  }
  if (count === undefined || (count.total === 0 && !count.atLeast)) return undefined;
  const compared = flows.get(flow.groupId)?.release;
  const list: OutsideCommits["list"] = !asked
    ? { state: "closed", onShow: () => setAsked(true) }
    : compared?.comparisonFailure !== undefined
      ? { state: "failed", ...compared.comparisonFailure }
      : compared === undefined || !compared.contentsKnown
        ? { state: "reading" }
        : {
            state: "known",
            rows: reviewRowsOf(
              releaseChangeRows({
                moved: compared.contents,
                marks: releaseStageMarks({ contents: compared.contents }, stage, mainHeads),
              }).filter((row) => row.change === undefined),
              { mates, mateNames, now, ages: false },
            ),
          };
  return { count: count.total, atLeast: count.atLeast, list };
}

/** When the newest of these services' deploys went live: since when the stage runs what it runs. */
function newestLive(
  services: ReadonlyArray<{
    readonly deploy?:
      | { readonly live: { readonly at: string; readonly endedAt: string | null } | null }
      | undefined;
  }>,
): string | undefined {
  let newest: string | undefined;
  for (const service of services) {
    const live = service.deploy?.live;
    const at = live === null || live === undefined ? undefined : (live.endedAt ?? live.at);
    if (at !== undefined && (newest === undefined || Date.parse(at) > Date.parse(newest))) {
      newest = at;
    }
  }
  return newest;
}

export interface ReleaseReviewViewProps {
  readonly problems?: ReadonlyArray<HqProblem> | undefined;
  /** Read from HQ for these exact immutable release inputs, never reconstructed in the browser. */
  readonly servicePlan?: ReleaseServicePlan | undefined;
  readonly servicePlanPending?: boolean | undefined;
  readonly servicePlanFailure?: string | undefined;
  readonly servicePlanProblems?: ReadonlyArray<HqProblem> | undefined;
  readonly onRetryServicePlan?: () => void;
  readonly git?: ZeropsProjectFlow["release"]["git"];
  readonly onReplaceToken?: (() => void) | undefined;
  /** HQ has not said what the release carries: no count, no list — "not known yet". */
  readonly changesPending?: boolean | undefined;
  /** The commits no change landed, once the offer counts them. */
  readonly outside?: OutsideCommits | undefined;
  readonly comparisonFailure?:
    | { readonly reason: string; readonly again?: (() => void) | undefined }
    | undefined;
  /** The project's name: the title is it and the version. */
  readonly name: string | undefined;
  readonly tag: string;
  /** The person's editable name, shown only while this review offers a release. */
  readonly version?:
    | {
        readonly value: string;
        readonly onChange: (value: string) => void;
        readonly tags: ReadonlyArray<string>;
        readonly suggestions: ReadonlyArray<ReleaseVersionSuggestion>;
        readonly nextPatch: string;
      }
    | undefined;
  readonly gate: ReleaseGate;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  /** Production's services whose commit cannot be told: what goes live on them is not said. */
  readonly untold: ReadonlyArray<string>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** The project's application in the Git browser; without it nothing links there. */
  readonly appId?: string | undefined;
  /** The code production runs, per service, to browse before it is replaced. */
  readonly productionCode?: ReturnType<typeof productionCode> | undefined;
  readonly hasStage: boolean;
  /** The stage that follows `main`: its name, and when what it runs went live. */
  readonly stage?: { readonly name: string; readonly at: string | undefined } | undefined;
  /** Production: when the release it runs was tagged, its parts, and the addresses it answers at. */
  readonly production?:
    | {
        readonly at: string | undefined;
        readonly addresses: ReadonlyArray<GroupFlowAddress>;
        readonly parts: ReadonlyArray<{
          readonly hostname: string;
          readonly version: string | undefined;
        }>;
      }
    | undefined;
  readonly services: ReadonlyArray<string>;
  /** What production ran as this one was offered. */
  readonly replaces: ReleaseReplaces;
  /** After a failure, whether production no longer runs what it replaced. */
  readonly productionMoved?: boolean | undefined;
  readonly outcome: ReleaseOutcome;
  readonly press: ReviewPress;
  /** The person's own Mate a failure is handed to, the one they used last. */
  readonly fixer: string | undefined;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRelease: () => void;
  /** Production on a domain of its own, offered once a release is live where it has none. */
  readonly onAddDomain?: (() => void) | undefined;
  readonly onFix: (problem: FixProblem) => void;
  /** A change row pressed: its review, in place. */
  readonly onOpenChange?: ((row: ReviewReleaseRow) => void) | undefined;
  readonly onClose: () => void;
}

export function ReleaseReviewView(props: ReleaseReviewViewProps) {
  const { rows, press, tag } = props;
  const versionId = useId();
  const answer = useReviewDeploys(press);
  // Pressed, its Version stays — not to be changed — until Where takes its place: the panel's foot
  // does not jump up and back down under the pointer (the onboarding run: 110 px up, 76 px down).
  const offered = props.outcome.kind === "offered";
  const version =
    offered || (props.outcome.kind === "releasing" && answer === undefined)
      ? props.version
      : undefined;
  const checkedVersion =
    version === undefined || !offered
      ? undefined
      : releaseVersionField(version.value, version.tags);
  // A first release names its version in words: the field and its rules — semver, what the code
  // declares — come only when the person asks to change it, or when what they typed is wrong.
  const [changing, setChanging] = useState(false);
  const inWords =
    props.replaces.kind === "first" && !changing && checkedVersion?.error === undefined;
  // What goes out is still compared: how many is not said until it is known.
  const comparing =
    offered &&
    (props.changesPending === true ||
      (!props.gate.allowed && props.gate.reason === RELEASE_CHECKING));
  const model = releaseReview({
    tag,
    git: props.git,
    gate: props.gate,
    permission: props.permission,
    changes: props.changesPending === true ? undefined : rows.length,
    onStage:
      props.hasStage && props.changesPending !== true
        ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
        : undefined,
    services: props.services,
    replaces: props.replaces,
    outcome: props.outcome,
    productionMoved: props.productionMoved,
    now: props.now,
  });
  const answered = new Set(answer?.jobs.map(({ service }) => service));
  const problems =
    press.kind === "refused"
      ? press.problems
      : (props.servicePlanProblems ??
        (props.outcome.kind === "failed" ? props.outcome.problems : props.problems));
  const fix = problemsFix(problems ?? []) ?? model.verdict.fix;
  const refused = press.kind === "refused" ? press.reason : undefined;
  // While it releases, a service it redeploys is deploying: its version names what is going, or
  // nothing yet, and is no fact to be unable to tell.
  const deploying =
    props.outcome.kind === "releasing"
      ? props.untold.filter((service) => props.services.includes(service))
      : [];
  const untold = props.untold.filter(
    (service) => !deploying.includes(service) && !answered.has(service),
  );
  const untoldDeploying = deploying.filter((service) => !answered.has(service));
  // What production runs as this one was offered: the version a roll back goes to.
  const live =
    props.replaces.kind === "release"
      ? props.replaces.tag
      : props.replaces.kind === "unnamed"
        ? "what production runs"
        : undefined;
  const ready = model.verdict.state === "release-ready";
  const openLive =
    model.primary === undefined && props.outcome.kind === "released" && props.git === undefined
      ? putLiveAddress(props.production?.addresses ?? [])
      : undefined;
  const now = productionNow({
    live,
    since: sinceWords(props.production?.at, props.now),
    parts: props.production?.parts ?? [],
    addresses: props.production?.addresses ?? [],
  });
  const line = releaseLine({
    changes: comparing ? undefined : rows.length,
    stage: props.hasStage ? props.stage?.name : undefined,
    since: sinceWords(props.stage?.at, props.now),
    onStage:
      props.hasStage && !comparing
        ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
        : undefined,
    live,
  });
  // Pressed, the head says where it stands once — its title and its step's clock — never the
  // offer's facts beside it (the owner's 10-19 look: "1 change, on stage… · Releasing v0.1.4").
  const heading = releaseHeading({
    tag,
    model,
    line,
    live: props.replaces.kind === "release" ? props.replaces.tag : undefined,
  });
  const git = props.git !== undefined;
  return (
    <ZeropsReviewSurface
      consequence={refused ?? (git ? model.consequence : heading.foot)}
      // Released onto the live app, its foot is the way in: the panel's × closes it, no Close
      // wraps onto a line of its own beside it.
      dismiss={
        props.git !== undefined
          ? "Cancel"
          : model.primary !== undefined
            ? "Cancel"
            : props.outcome.kind === "released" &&
                (openLive !== undefined || props.onAddDomain !== undefined)
              ? undefined
              : "Close"
      }
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
      kindLabel={props.name ?? reviewKindLine("release")}
      meta={git || heading.meta === undefined ? undefined : <span>{heading.meta}</span>}
      onClose={props.onClose}
      // Released, it ends on the live app: its address the way in, a domain of its own beside it.
      secondary={
        openLive !== undefined && props.onAddDomain !== undefined
          ? { label: "Put it on your domain", enabled: true, onPress: props.onAddDomain }
          : undefined
      }
      primary={
        model.primary === undefined ||
        (model.primary.label === "Replace token" && props.onReplaceToken === undefined)
          ? openLive !== undefined
            ? {
                label: "Open",
                text: `Open ${openLive.host}`,
                enabled: true,
                safe: true,
                icon: "globe",
                onPress: () => {
                  window.open(openLive.url, "_blank", "noopener,noreferrer");
                },
              }
            : model.primary === undefined &&
                props.outcome.kind === "released" &&
                props.onAddDomain !== undefined
              ? {
                  label: "Put it on your domain",
                  enabled: true,
                  safe: false,
                  icon: "globe",
                  onPress: props.onAddDomain,
                }
              : undefined
          : {
              ...model.primary,
              enabled:
                model.primary.enabled &&
                checkedVersion?.error === undefined &&
                props.servicePlanPending !== true &&
                props.servicePlanFailure === undefined,
              busy: press.kind === "running",
              label: press.kind === "running" ? `Releasing ${tag}` : model.primary.label,
              text: `${model.primary.label} to production`,
              onPress:
                model.primary.label === "Replace token"
                  ? props.onReplaceToken!
                  : (event?: { readonly currentTarget: EventTarget | null }) => {
                      holdSheetHeight(event?.currentTarget);
                      props.onRelease();
                    },
            }
      }
      title={git ? `Release ${tag} to production` : heading.title}
      titleId={props.titleId}
      verdict={
        git
          ? model.verdict
          : {
              ...model.verdict,
              title: heading.state ?? model.verdict.title,
              why: heading.note ?? "",
            }
      }
      verdictInLine={git ? !ready : heading.state !== undefined}
      whySaid={git ? whySaid(model.verdict, false) : heading.note !== undefined}
    >
      {props.git === undefined ? null : (
        <>
          <ReviewSection title="Where">
            {model.repositories?.map((repo) => (
              <div key={repo.repository}>
                <p className="rv-words">
                  {repo.repository} ·{" "}
                  {repo.included ? "Included" : `Left out: ${repo.reason ?? "Not ready"}`} ·{" "}
                  {repo.sha == null ? (
                    "Nothing merged yet"
                  ) : props.appId === undefined ? (
                    repo.sha.slice(0, 7)
                  ) : (
                    <GitBrowserLink
                      to={gitCodeLink({ appId: props.appId, repo: repo.repository }, repo.sha)}
                    >
                      {repo.sha.slice(0, 7)}
                    </GitBrowserLink>
                  )}
                </p>
                {repo.remote == null ? null : (
                  <p className="rv-note">
                    {gitWhereLine("production", props.git!.attachment.target, repo.remote.url)}
                    {repo.expiry === undefined ? null : <> · {repo.expiry}</>}
                  </p>
                )}
              </div>
            ))}
            {props.outcome.kind === "offered" ? null : (
              <GitDeliveryStatus
                environment={{ tier: "production", target: props.git.attachment.target }}
                delivery={props.git.delivery}
                showDestination={false}
              />
            )}
          </ReviewSection>
        </>
      )}
      <HqProblems problems={problems} />
      {props.servicePlanPending === true ? (
        <ReviewSection title="Production operations">
          <p className="rv-note">Reading production operations…</p>
        </ReviewSection>
      ) : props.servicePlanFailure !== undefined ? (
        <ReviewSection title="Production operations">
          <ZeropsReadFailure
            reason={props.servicePlanFailure}
            action="Review again"
            again={props.onRetryServicePlan}
          />
        </ReviewSection>
      ) : props.servicePlan === undefined ? null : (
        <ReviewSection title="Production operations">
          <ol className="rv-service-plan">
            {props.servicePlan.operations.map((operation, index) => (
              <li key={`${index}-${operation.kind}-${operation.service}`}>
                <p className="rv-words">
                  {operation.kind === "create" ? "Create" : "Deploy"} {operation.service}
                </p>
                {operation.kind === "create" ? (
                  <>
                    <dl>
                      {Object.entries(operation.settings).map(([name, value]) => (
                        <div key={name}>
                          <dt>{name}</dt>
                          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="rv-note">{operation.cost}</p>
                  </>
                ) : (
                  <p className="rv-note">{operation.sha}</p>
                )}
              </li>
            ))}
          </ol>
        </ReviewSection>
      )}
      {props.comparisonFailure === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...props.comparisonFailure} />
      )}
      {props.git !== undefined &&
      rows.length === 0 &&
      props.outside === undefined ? null : rows.length === 0 &&
        props.outside === undefined &&
        props.changesPending !== true &&
        untold.length === 0 &&
        untoldDeploying.length === 0 &&
        (answer !== undefined || props.where.length === 0) ? null : (
        <ReviewSection title="What goes out">
          {rows.length === 0 ? null : (
            <ReviewReleaseRows appId={props.appId} onOpen={props.onOpenChange} rows={rows} />
          )}
          {props.changesPending === true && offered ? (
            <p className="rv-note">Not known yet.</p>
          ) : null}
          {props.outside === undefined ? null : (
            <OutsideCommitsList
              appId={props.appId}
              onOpen={props.onOpenChange}
              outside={props.outside}
            />
          )}
          {props.git !== undefined || untoldDeploying.length === 0 ? null : (
            <p className="rv-note">{servicesDeploying(untoldDeploying)}.</p>
          )}
          {props.git !== undefined || untold.length === 0 ? null : (
            <p className="rv-note">{cannotTellWhatRuns(untold)}.</p>
          )}
          {/* Which release each service gets, until HQ answers where it went. */}
          {props.git === undefined && answer === undefined
            ? releaseWhereWords(props.where, tag).map((words) => (
                <p className="rv-note" key={words}>
                  {words}
                </p>
              ))
            : null}
        </ReviewSection>
      )}
      {/* What ran before it, until production runs it: then the head says so, and since when. */}
      {props.git !== undefined ||
      props.replaces.kind === "first" ||
      props.outcome.kind === "released" ? null : (
        <ReviewSection title="Production now">
          <p className="rv-words">{now.line}</p>
          {now.rows.map((row) => (
            <p className="rv-note" data-zerops-production-part="" key={row}>
              {row}
            </p>
          ))}
          {offered && props.appId !== undefined ? (
            <ProductionCode appId={props.appId} code={props.productionCode ?? []} />
          ) : null}
        </ReviewSection>
      )}
      {props.git !== undefined || answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere answer={answer} rows={props.where} />
        </ReviewSection>
      )}
      {version === undefined ? null : inWords ? (
        <ReviewSection title="Version">
          <div className="rv-version-use">
            <span className="rv-words">{checkedVersion?.tag ?? `v${version.value}`}</span>
            {offered ? (
              <Button onClick={() => setChanging(true)} size="sm" variant="link">
                Change
              </Button>
            ) : null}
          </div>
        </ReviewSection>
      ) : (
        <ReviewSection title="Version">
          <div className="rv-version">
            <div className="w-44">
              <Input
                aria-label="Version"
                aria-describedby={`${versionId}-help`}
                aria-invalid={checkedVersion?.error !== undefined}
                autoComplete="off"
                disabled={press.kind === "running" || !offered}
                font="mono"
                id={versionId}
                nativeInput
                onChange={(event) => version.onChange(event.target.value)}
                spellCheck={false}
                value={version.value}
              />
            </div>
            <p className="rv-note" id={`${versionId}-help`}>
              {checkedVersion?.error ??
                // The next patch, said only while the field holds something else.
                (`v${version.value}` === version.nextPatch
                  ? "Must be newer than every release."
                  : `Must be newer than every release. Next patch is ${version.nextPatch}.`)}
            </p>
            {version.suggestions.map((suggestion) => (
              <p className="rv-note rv-version-use" key={suggestion.source}>
                Your code names {suggestion.tag}.
                <Button
                  disabled={!offered}
                  onClick={() => version.onChange(suggestion.tag.slice(1))}
                  size="sm"
                  variant="link"
                >
                  Use it
                </Button>
              </p>
            ))}
          </div>
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}

/**
 * From the press, the release's sheet keeps at least the height it stood at: what it says next —
 * its progress, then Where — never pulls its buttons up under the pointer (the onboarding run: the
 * foot rose 110 px at the press).
 */
function holdSheetHeight(pressed: EventTarget | null | undefined) {
  const sheet = pressed instanceof HTMLElement ? pressed.closest<HTMLElement>(".rv") : null;
  if (sheet !== null) sheet.style.minHeight = `${String(sheet.getBoundingClientRect().height)}px`;
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
  /** HQ recorded no membership for a release in between: compared only if the person asks. */
  | { readonly state: "unrecorded"; readonly compare?: (() => void) | undefined }
  | {
      readonly state: "failed";
      readonly reason: string;
      readonly again?: (() => void) | undefined;
    };

/** What a roll back takes off production and brings back, and the services nothing is told of. */
interface RollbackLists {
  readonly leaving: ComparedCommits;
  readonly comingBack: ComparedCommits;
  readonly untold: ReadonlyArray<string>;
}

const NO_ASKS: ReadonlyMap<string, ReadonlyArray<CompareRead>> = new Map();
/** What a roll back to a release not listed goes back to: nothing. */
const NO_ENTRIES: ReadonlyArray<ReleaseEntry> = [];
const COMPARING: ComparedCommits = { state: "reading" };
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
  /** Whether the person asked for the comparison: none is made before. */
  asked: boolean,
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
      reads === undefined || !asked
        ? NO_ASKS
        : new Map([[groupId, [...reads.leaving, ...reads.comingBack]]]),
    [asked, groupId, reads],
  );
  const compares = useReleaseComparisons(asks);
  return useMemo(() => {
    if (reads === undefined) return LISTS_UNREAD;
    const answered = compares.get(groupId);
    const listOf = (listReads: ReadonlyArray<CompareRead>): ComparedCommits =>
      answered === undefined
        ? COMPARING
        : {
            ...movedCommits({ reads: listReads, ...answered }),
            again: () => answered.again(listReads),
          };
    return {
      leaving: listOf(reads.leaving),
      comingBack: listOf(reads.comingBack),
      untold: reads.untold,
    };
  }, [compares, groupId, reads]);
}

function RollbackData({
  detail,
  flow,
  name,
  tag,
  titleId,
  onClose,
  onOpenChange,
}: {
  readonly detail: HqAppDetailRead;
  readonly flow: ZeropsProjectFlow;
  readonly name: string | undefined;
  readonly tag: string;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenChange: (row: ReviewReleaseRow) => void;
}) {
  const verbs = useFlowVerbs();
  const mateNames = useMateNames();
  const mates = useZeropsReviewMates(flow.groupId);
  const askMateToFix = useAskMateToFix();
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The release the roll back made — HQ's answer, not the flow's guess — which the review follows
  // through HQ's record of it and production's deploy, as a release's.
  const [made, setMade] = useState<string | undefined>(undefined);
  // What the review offered when it was pressed: HQ's flow moves under the request (production's
  // baseline, the next version), and the review keeps saying what was approved.
  const [asked, setAsked] = useState<{ runs: typeof flow.release.runs; tag: string } | undefined>(
    undefined,
  );
  const suggestion = asked?.tag ?? flow.release.suggestion;
  const runs = asked === undefined ? flow.release.runs : asked.runs;
  // A roll back to this release already on its way, pressed elsewhere — production's "Rolling back
  // to v0.1.0" line opens this review on it: it follows that roll back to its end, held once seen.
  const onItsWay = rollbackOnItsWay({
    inFlight: flow.release.inFlight,
    releases: flow.releases,
    tag,
  });
  const [following, setFollowing] = useState<string | undefined>(undefined);
  if (made === undefined && following === undefined && onItsWay !== undefined)
    setFollowing(onItsWay);
  const followed = made ?? following;
  const follows = releaseFollows({
    made,
    held: following === undefined ? undefined : { tag: following },
    press,
    inFlight: onItsWay,
    stalled: flow.release.stalled,
    suggestion,
    releases: flow.releases,
  });
  const tagged = followed === undefined ? undefined : follows.tagged;
  const done = press.kind === "done";
  const tracking = done || following !== undefined;
  const clockMs = useSecondsNowMs(tracking && follows.ticking);
  // Past the wait for it, or with a newer release above it, the roll back says how it ended.
  const outcome = releaseOutcomeOf({
    tagged,
    releasing: tracking,
    stalled: tracking && follows.stalled,
    superseded: tracking ? follows.superseded : undefined,
    pressing: false,
    tag: followed ?? suggestion,
    clockMs,
  });
  // What production ran as it was offered, held from the press: once it lands, production runs
  // the roll back's own tag.
  const current = { tag, live: flow.releases.find((entry) => entry.standing === "live")?.tag };
  const [held, setHeld] = useState<typeof current | undefined>(undefined);
  const keep = holdReleaseFacts({ held, current, press, outcome });
  if (keep !== held) setHeld(keep);
  const earlier = flow.releases.find((entry) => entry.tag === tag);
  const { repositories } = flow.release;
  // What leaves and what comes back is what the releases in between recorded they carried; a
  // repository is compared only for a side no release recorded, and only once the person asks.
  const liveTag = flow.releases.find((entry) => entry.standing === "live")?.tag;
  const recorded = useMemo(
    () =>
      detail.releases === undefined
        ? undefined
        : rollbackFromHistories({ releases: detail.releases, live: liveTag, target: tag }),
    [detail.releases, liveTag, tag],
  );
  const [compareAsked, setCompareAsked] = useState(false);
  const lists = useRollbackLists(flow.groupId, earlier?.entries, runs, repositories, compareAsked);
  const compareUnrecorded =
    earlier === undefined
      ? undefined
      : () => {
          setCompareAsked(true);
        };
  const listOf = (side: "leaving" | "comingBack"): RollbackList => {
    const told = recorded?.[side];
    if (told?.state === "known" && detail.changes !== undefined) {
      return {
        state: "known",
        rows: reviewRowsOf(
          releaseChangeRows({
            moved: carriedMoved({ changes: told.changes, known: detail.changes, repositories }),
            marks: NO_MARKS,
          }),
          { mates, mateNames, now, ages: true },
        ),
        count: told.changes.length,
        atLeast: false,
      };
    }
    if (!compareAsked) return { state: "unrecorded", compare: compareUnrecorded };
    const moved = lists[side];
    return moved.state !== "known"
      ? moved
      : {
          state: "known",
          rows: reviewRowsOf(releaseChangeRows({ moved: moved.moved, marks: NO_MARKS }), {
            mates,
            mateNames,
            now,
            ages: true,
          }),
          ...movedCount(moved.moved),
        };
  };
  // A roll back that hasn't landed is anybody's to look into, as a release's (S6, `fixMates.ts`).
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  const [fixer] = useFixMates({
    projectId: production?.projectId ?? flow.groupId,
    groupId: flow.groupId,
  });
  const rollBack = async () => {
    setAsked({ runs: flow.release.runs, tag: flow.release.suggestion });
    setPress({ kind: "running" });
    const answer = await verbs.rollBack(flow, tag);
    setPress(
      answer.ok
        ? { kind: "done", deploys: answer.deploys, rollout: answer.rollout }
        : { kind: "refused", reason: answer.reason, problems: answer.problems },
    );
    if (answer.ok) setMade(answer.tag);
    else setAsked(undefined);
  };
  return (
    <RollbackReviewView
      comingBack={listOf("comingBack")}
      fixer={fixer?.name}
      leaving={listOf("leaving")}
      line={earlier?.line}
      live={(keep ?? current).live}
      // Rolling back is a release: HQ's rule for releasing decides, whatever else holds Release
      // back now.
      permission={flow.release.permission}
      name={name}
      nextTag={followed ?? suggestion}
      now={now}
      onClose={onClose}
      onFix={(problem) => {
        if (fixer === undefined) return;
        askMateToFix(fixer.mateProjectId, problem);
        onClose();
      }}
      onOpenChange={onOpenChange}
      onRollBack={() => {
        void rollBack();
      }}
      outcome={outcome}
      press={press}
      services={rollbackServices({ entries: earlier?.entries ?? NO_ENTRIES, runs })}
      tag={tag}
      titleId={titleId}
      untold={lists.untold}
      appId={flow.groupId}
      where={(earlier?.entries ?? NO_ENTRIES).map((entry) => {
        const repository = repositories?.get(entry.service);
        return {
          service: entry.service,
          line: `goes back to ${shortCommit(entry.commit)}`,
          code: repository === undefined ? undefined : { repository, sha: entry.commit },
        };
      })}
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
  /** Each service and the commit it goes back to, its code where its repository is known. */
  readonly where: ReadonlyArray<{
    readonly service: string;
    readonly line: string;
    readonly code?: { readonly repository: string; readonly sha: string } | undefined;
  }>;
  /** The project's application in the Git browser; without it nothing links there. */
  readonly appId?: string | undefined;
  /** What production runs that the release does not: it leaves production. */
  readonly leaving: RollbackList;
  /** What the release lists that production does not run: it comes back. */
  readonly comingBack: RollbackList;
  /** Production's services whose commit cannot be told: what moves on them is not said. */
  readonly untold: ReadonlyArray<string>;
  /** A change row pressed: its review, in place. */
  readonly onOpenChange?: ((row: ReviewReleaseRow) => void) | undefined;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly press: ReviewPress;
  /** The person's own Mate a roll back that hasn't landed is handed to, the one they used last. */
  readonly fixer?: string | undefined;
  readonly onFix?: ((problem: FixProblem) => void) | undefined;
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
  onOpen,
  appId,
  children,
}: {
  readonly title: string;
  readonly side: RollbackSide;
  readonly list: RollbackList;
  readonly onOpen: ((row: ReviewReleaseRow) => void) | undefined;
  readonly appId: string | undefined;
  readonly children?: ReactNode;
}) {
  const listed = list.state === "known" && list.rows.length > 0;
  return (
    <ReviewSection
      aside={listed ? changesCountWords(list.count, list.atLeast) : undefined}
      title={title}
    >
      {listed ? (
        <ReviewReleaseRows appId={appId} onOpen={onOpen} rows={list.rows} />
      ) : list.state === "failed" && list.again !== undefined ? (
        <ZeropsReadFailure
          action="Compare again"
          reason={rollbackListNote(side, list)}
          again={list.again}
        />
      ) : (
        <p className="rv-note">
          {rollbackListNote(side, list)}
          {list.state === "unrecorded" && list.compare !== undefined ? (
            <>
              {" · "}
              <Button onClick={list.compare} size="sm" variant="link">
                Compare
              </Button>
            </>
          ) : null}
        </p>
      )}
      {children}
    </ReviewSection>
  );
}

export function RollbackReviewView(props: RollbackReviewViewProps) {
  const { press, tag } = props;
  const model = rollbackReview({
    comparisons: { leaving: props.leaving.state, comingBack: props.comingBack.state },
    tag,
    nextTag: props.nextTag,
    live: props.live,
    services: props.services,
    permission: props.permission,
    press,
    outcome: props.outcome,
    now: props.now,
  });
  const problems =
    press.kind === "refused"
      ? press.problems
      : props.outcome.kind === "failed"
        ? props.outcome.problems
        : undefined;
  const fix = problemsFix(problems ?? []) ?? model.verdict.fix;
  const onFix = props.onFix;
  const answer = useReviewDeploys(press);
  const answered = new Set(answer?.jobs.map(({ service }) => service));
  const untold = props.untold.filter((service) => !answered.has(service));
  return (
    <ZeropsReviewSurface
      consequence={model.consequence}
      dismiss={model.primary === undefined ? "Close" : "Cancel"}
      fix={
        fix === undefined || props.fixer === undefined || onFix === undefined
          ? undefined
          : {
              label: `Ask ${props.fixer} to ${fix.verb}`,
              onPress: () => {
                onFix(fix.problem);
              },
            }
      }
      kind="rollback"
      kindLabel={props.name ?? reviewKindLine("rollback")}
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
      title={`Roll back to ${tag}`}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      <HqProblems problems={problems} />
      <RollbackListSection
        appId={props.appId}
        list={props.leaving}
        onOpen={props.onOpenChange}
        side="leaving"
        title="Leaves production"
      >
        {untold.length === 0 ? null : <p className="rv-note">{cannotTellWhatRuns(untold)}.</p>}
      </RollbackListSection>
      <RollbackListSection
        appId={props.appId}
        list={props.comingBack}
        onOpen={props.onOpenChange}
        side="coming-back"
        title="Comes back"
      />
      {props.where.length === 0 && answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere
            answer={answer}
            rows={props.where.map(({ service, line, code }) => ({
              service,
              line,
              code:
                code === undefined || props.appId === undefined
                  ? undefined
                  : gitCodeLink({ appId: props.appId, repo: code.repository }, code.sha),
            }))}
          />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}

/**
 * The code production runs, to read before a release replaces it: one service's is "Browse files",
 * several are each by its name — never by a hash, which names no release.
 */
function ProductionCode({
  appId,
  code,
}: {
  readonly appId: string;
  readonly code: ReturnType<typeof productionCode>;
}) {
  if (code.length === 0) return null;
  const link = (entry: (typeof code)[number], words: string) => (
    <GitBrowserLink
      key={entry.service}
      to={gitCodeLink({ appId, repo: entry.repository }, entry.sha)}
    >
      {words}
    </GitBrowserLink>
  );
  return (
    <p className="rv-note">
      {code.length === 1
        ? link(code[0]!, "Browse files")
        : [
            "Browse files: ",
            ...code.flatMap((entry, index) => [
              index === 0 ? null : " · ",
              link(entry, entry.service),
            ]),
          ]}
    </p>
  );
}
