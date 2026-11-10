import type { HqProblem } from "@t3tools/shared/hqProblems";
import { problemsFix } from "@t3tools/client-runtime/zerops/hq";
import { HqProblems } from "./HqProblems";
import { GitDeliveryStatus, gitWhereLine } from "../GitDeliveryStatus";
/**
 * A release's review, and a roll back's (R5, R6).
 *
 * What goes out — one row per change, its Mate's face and when it merged — and what happens in
 * production: the steps HQ runs, in its order, a creation per service production lacks, a deploy
 * per service, and production answering (`ZeropsReleasePlan`). One button does all of it and names
 * the version. Pressed, it stays: the same steps tick in place, and it ends live, or stopped on
 * the step that stopped with the way out of that failure (S6). The sheet is as tall as what it
 * says: while it reads, its places stand in the ready sheet's size, a step the plan brings more
 * only pushes the buttons down, and from the press they never rise.
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
  carriedByRecords,
  outsideMoved,
  carriedMoved,
  changesCountWords,
  holdReleaseFacts,
  releaseFailureOf,
  movedCommits,
  movedCount,
  releaseFacts,
  releaseFollows,
  releaseOutcomeOf,
  releaseReview,
  releaseStageMarks,
  releaseStep,
  releaseVersionField,
  releaseVersionSuggestions,
  reviewAge,
  rollbackFromHistories,
  rollbackOnItsWay,
  rollbackReads,
  rollbackReview,
  RELEASE_CHECKING,
  RELEASE_READING,
  RELEASE_TAKES,
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
  productionProjectOf,
} from "@t3tools/client-runtime/zerops";
import { ArrowUpRightIcon } from "lucide-react";
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
import { NOT_RENEWING } from "~/zerops/renewDeployKey.logic";
import { releasePressKey, useReleasePresses } from "~/zerops/releasePresses";
import { useRenewDeployKey } from "~/zerops/useRenewDeployKey";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useReleaseServicePlan } from "~/zerops/useReleaseServicePlan";
import { servicePlanImportYaml } from "~/zerops/releaseImport.logic";
import { randomUUID } from "~/lib/utils";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useMateNames, useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useOpenReview, type ReviewTarget } from "~/zerops/review";
import { beginServiceCreation, useServiceCreation } from "~/zerops/serviceCreationRuns";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { ZeropsReadFailure } from "../ZeropsReadFailure";
import { useReleaseComparisons, type ComparedCommits } from "~/zerops/useReleaseComparisons";
import { useZeropsReviewMates, type ZeropsReviewMate } from "~/zerops/useZeropsReviewMates";

import { ZeropsChangeReview } from "./ZeropsChangeReview";
import {
  GrowsInPlace,
  ReleasePlan,
  ReleasePlanSkeleton,
  WordsOf,
  type ReleaseStepLog,
} from "./ZeropsReleasePlan";
import { useReleaseSteps, ZeropsReleaseSteps } from "./ZeropsReleaseSteps";
import {
  inProductionWords,
  keyRenewedSteps,
  planCreations,
  releaseNoteSaid,
  releasePressLabel,
  releaseSheetSteps,
  releaseStepWords,
  releaseStopReason,
  releaseSubtitle,
  wordsNaming,
  type KeyRenewal,
  type ReleaseCreateOperation,
  type ReleaseProgress,
  type ReleaseSheetStep,
} from "./releaseSheet.logic";
import {
  serviceCreateRunOf,
  serviceCreateTrouble,
  type ServiceCreateRun,
} from "../proposal/productionAsk.logic";
import { mainStageOf, useGroupName, useProductionAddresses } from "./reviewReads";
import {
  productionBefore,
  releaseChangeRows,
  outsideCommitsWords,
  productionCode,
  reviewKindLine,
  rollbackListNote,
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
  type ReviewButton,
  type ReviewPrimaryButton,
  type ReviewReleaseRow,
} from "./ZeropsReviewSurface";
import { useReviewDeploys } from "../ZeropsDeployAnswer";
import {
  deployAnswerSaid,
  deployLogTarget,
  jobInFlight,
  type HqJob,
} from "@t3tools/client-runtime/zerops/hq";
import { useDeployAnswerFollowing } from "~/zerops/activity/useDeployAnswerFollowing";
import { Button, InlineButton } from "~/components/ui/button";
import { GitBrowserLink, gitCodeLink } from "../gitBrowser/GitBrowserLink";
import { changeTitle } from "../projects/projectHistory.logic";

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
  if (flow === undefined && target.kind === "release") {
    return <ReleaseReadingView name={name} onClose={onClose} titleId={titleId} />;
  }
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
    /** Whether each says when it merged; the commits outside changes name their Mate alone. */
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
      // GitHub's `(#n)`, every one a squash stacked on it, is no part of its title.
      title: changeTitle(row.title),
      ...(mate === undefined ? {} : { face: { tint: mate.tint, shape: mate.shape } }),
      ...(mateName === undefined ? {} : { mate: mateName }),
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
  // "See why": opened while the newest release didn't go live and nothing is on its way, the
  // sheet opens on that release's stop, not on the next offer. Which release that is, is the one
  // fact the next-release bar's "Didn't go live" is read from (`releaseFailureOf`: the newest that
  // did not go through among those newer than what production runs, so one a newer live release
  // followed is not reopened). It is followed as one this tab pressed is, decided once when the
  // releases are first known; *Review a new release* lets it go for the offer.
  const [reopened, setReopened] = useState<string | null | undefined>(undefined);
  if (reopened === undefined && flow.releasesKnown)
    setReopened(
      flow.release.git !== undefined || flow.release.inFlight !== undefined || made !== undefined
        ? null
        : (releaseFailureOf({
            releases: flow.releases,
            environmentInputs: flow.environmentInputs,
            stalled: flow.release.stalled,
          })?.tag ?? null),
    );
  const stoppedBefore = reopened === null ? undefined : reopened;
  const follows = releaseFollows({
    made: made ?? stoppedBefore,
    held: held ?? (stoppedBefore === undefined ? undefined : { tag: stoppedBefore }),
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
    reads: { environmentInputs: flow.environmentInputs, stalled: flow.release.stalled },
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
    ages: true,
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
  // HQ reads no plan for someone it does not offer the release: that is a refusal, never a wait.
  const planPending =
    reviewing &&
    plan.required &&
    flow.release.permission?.allowed !== false &&
    plan.view.kind === "pending";
  const planFailure =
    reviewing && plan.required && plan.view.kind === "failed" ? plan.view.reason : undefined;
  const [heldPlan, setHeldPlan] = useState<ReleaseServicePlan>();
  const shownPlan = reviewing ? reviewedPlan : heldPlan;
  const reviewedRequest = releaseRequestOf(flow.release, chosen.tag, reviewedPlan);
  const releaseGate =
    "refused" in reviewedRequest
      ? { allowed: false as const, reason: reviewedRequest.refused }
      : planFailure !== undefined
        ? { allowed: false as const, reason: planFailure }
        : { allowed: true as const };

  // The early path: what production lacks, created now with the person's own Zerops access — HQ's
  // release permission says they may write production — and followed to its end. The step says
  // where it stands; HQ's plan is read again once it is done, and then creates nothing.
  const operations = useAccountOperationsOptional();
  const creationKey = `release:${flow.groupId}`;
  const creation = useServiceCreation(creationKey);
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<ReadonlyArray<ReleaseCreateOperation>>(NOTHING_CREATED);
  const [unsent, setUnsent] = useState<string>();
  const run: ServiceCreateRun =
    unsent === undefined
      ? serviceCreateRunOf(creation, sending)
      : { kind: "failed", words: unsent };
  const productionProjectId = productionProjectOf(flow.environments);
  const lacking = planCreations(shownPlan).filter(
    (operation) => !created.some((made) => made.service === operation.service),
  );
  const importYaml =
    shownPlan === undefined || lacking.length === 0
      ? undefined
      : servicePlanImportYaml({ ...shownPlan, operations: lacking });
  const createNow =
    importYaml === undefined ||
    operations === null ||
    orgId === null ||
    productionProjectId === undefined ||
    flow.release.permission?.allowed !== true ||
    outcome.kind === "releasing" ||
    outcome.kind === "released"
      ? undefined
      : async () => {
          if (sending || run.kind === "working") return;
          setSending(true);
          setUnsent(undefined);
          try {
            const requestId = randomUUID();
            beginServiceCreation(creationKey, requestId);
            await operations.submit(
              {
                kind: "create-services",
                orgId,
                projectId: productionProjectId,
                yaml: importYaml,
              },
              requestId,
            );
            const trouble = serviceCreateTrouble(await operations.untilEnd(requestId, orgId));
            if (trouble !== null) return;
            setCreated((made) => [...made, ...lacking]);
            // HQ's plan is read again: it lists what production still lacks.
            if (reviewing) plan.again();
          } catch (cause) {
            setUnsent(cause instanceof Error ? cause.message : "It could not be carried out.");
          } finally {
            setSending(false);
          }
        };

  // Production's deploy key, renewed from the sheet where it is what stopped the release.
  const renewKey = useRenewDeployKey(
    productionProjectId === undefined || production === undefined
      ? undefined
      : {
          appId: flow.groupId,
          projectId: productionProjectId,
          name: production.environment,
          place: "production",
        },
  );

  // The press's own time, and this tab's first sight of the release live (`releasePresses`).
  const pressRecord = useReleasePresses((state) =>
    follows.tag === undefined
      ? undefined
      : state.presses[releasePressKey(flow.groupId, follows.tag)],
  );
  const release = async () => {
    if (chosen.tag === undefined || chosen.error !== undefined) return;
    if (plan.required && reviewedPlan === undefined) return;
    // Capture the offer in the press. HQ's stream may change it before React draws "running".
    setHeldPlan(reviewedPlan);
    setHeld({ ...facts, tag: chosen.tag });
    setMade(chosen.tag);
    const presses = useReleasePresses.getState();
    presses.pressed(flow.groupId, chosen.tag, new Date().toISOString());
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
    if (!answer.ok) presses.refused(flow.groupId, chosen.tag);
    else if (answer.tag !== undefined) presses.renamed(flow.groupId, chosen.tag, answer.tag);
  };
  const sawLive =
    outcome.kind === "released" && pressRecord !== undefined && pressRecord.liveAt === undefined
      ? follows.tag
      : undefined;
  useEffect(() => {
    if (sawLive !== undefined)
      useReleasePresses.getState().live(flow.groupId, sawLive, new Date().toISOString());
  }, [flow.groupId, sawLive]);

  // What HQ does in production for the followed release, as its jobs there stand: the steps'
  // marks, clocks and words (`releaseSheetSteps`).
  const jobs = useMemo(
    () =>
      production === undefined
        ? NO_JOBS
        : production.services.flatMap((service) => {
            const latest = service.deploy?.latest;
            return latest !== undefined && latest.cause === "release" && latest.ref === follows.tag
              ? [{ service: service.hostname, job: latest }]
              : [];
          }),
    [follows.tag, production],
  );
  // Until HQ's navigation carries a job, the press's own answer says where it stands.
  const answered = useMemo(
    () =>
      followed === undefined || production === undefined
        ? NO_ANSWERED
        : followed.jobs.flatMap((job) =>
            job.kind === "deploy" &&
            job.service !== null &&
            job.environment === production.environment
              ? [{ service: job.service, state: job.state, reason: job.reason }]
              : [],
          ),
    [followed, production],
  );
  const progress = useMemo<ReleaseProgress>(
    () => ({
      creation: production?.releaseCreations?.find((entry) => entry.tag === follows.tag),
      deploys: [
        ...jobs.map(({ service, job }) => ({
          service,
          state: job.state,
          reason: job.reason?.trim() || undefined,
          at: job.at,
          endedAt: job.endedAt,
        })),
        ...answered
          .filter((job) => !jobs.some((streamed) => streamed.service === job.service))
          .map((job) => ({
            service: job.service,
            state: job.state,
            reason: job.reason?.trim() || undefined,
            at: undefined,
            endedAt: null,
          })),
      ],
    }),
    [answered, follows.tag, jobs, production?.releaseCreations],
  );
  const viewer = useZeropsSessionOptional()?.user?.id;
  const nameOf = usePersonNames(orgId === null ? undefined : orgId);
  const startedBy =
    follows.tagged?.by === undefined
      ? press.kind === "running" || press.kind === "done"
        ? "you"
        : undefined
      : follows.tagged.by === viewer
        ? "you"
        : nameOf(follows.tagged.by);
  const openReview = useOpenReview();
  const replaced = facts.replaces.kind === "release" ? facts.replaces.tag : undefined;
  const rollBackOffered =
    replaced !== undefined &&
    flow.releases.find((entry) => entry.tag === replaced)?.rollBack === true;
  const summary =
    legacy || flow.release.summary === undefined || flow.release.summaryRead === "pending"
      ? undefined
      : flow.release.summary;

  return (
    <ReleaseReviewView
      servicePlan={shownPlan}
      servicePlanPending={planPending}
      problems={flow.release.problems}
      servicePlanFailure={planFailure}
      servicePlanProblems={
        reviewing && plan.required && plan.view.kind === "failed" ? plan.view.problems : undefined
      }
      onRetryServicePlan={plan.again}
      creation={{
        run,
        created,
        onCreate:
          createNow === undefined
            ? undefined
            : () => {
                void createNow();
              },
      }}
      progress={progress}
      // The clock the press started keeps counting from the press: HQ tags when it gets to it,
      // and counting from its tag would take time back under the person's eyes. "Took" is the
      // press to this tab's sight of it live; a tab that did not press says HQ's own times.
      started={{
        at: pressRecord?.pressedAt ?? follows.tagged?.taggedAt,
        by: startedBy,
        liveAt: pressRecord?.liveAt,
      }}
      logOf={(service) => {
        const job = jobs.find((entry) => entry.service === service)?.job;
        const target = job === undefined ? undefined : deployLogTarget(job);
        return target === undefined || productionProject === undefined
          ? undefined
          : { projectId: productionProject, target };
      }}
      expected={summary?.changeCount}
      commits={summary?.total}
      onRollBack={
        !rollBackOffered || replaced === undefined
          ? undefined
          : () => {
              openReview({ kind: "rollback", groupId: flow.groupId, tag: replaced });
            }
      }
      onReviewNew={() => {
        setPress({ kind: "idle" });
        setMade(undefined);
        setHeld(undefined);
        setHeldPlan(undefined);
        setTypedVersion(undefined);
        setReopened(null);
        renewKey.reset();
      }}
      environmentName={production?.environment}
      entries={flow.release.entries.length}
      keyRenewal={renewKey}
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
          services: production === undefined ? NO_SERVICES : production.services,
          releasing: outcome.kind === "releasing",
        }),
        addresses: productionAddresses,
      }}
      permission={flow.release.permission}
      // A stage HQ never put anything live on counts nothing: no "0 of N".
      hasStage={stage !== undefined && stageRead(stage)}
      name={name}
      now={follows.ticking ? clockMs : now}
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

const NOTHING_CREATED: ReadonlyArray<ReleaseCreateOperation> = [];
const NO_JOBS: ReadonlyArray<{ readonly service: string; readonly job: HqJob }> = [];
const NO_ANSWERED: ReadonlyArray<{
  readonly service: string;
  readonly state: HqJob["state"];
  readonly reason: string | null;
}> = [];
const NO_SERVICES: ReadonlyArray<never> = [];

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
  // Not counted yet: its line's place, never a sentence the count takes back.
  if (list.state === "pending") {
    return <span aria-hidden="true" className="rv-pskel mt-2.5 w-44" />;
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

export interface ReleaseReviewViewProps {
  readonly problems?: ReadonlyArray<HqProblem> | undefined;
  /** Read from HQ for these exact immutable release inputs, never reconstructed in the browser. */
  readonly servicePlan?: ReleaseServicePlan | undefined;
  readonly servicePlanPending?: boolean | undefined;
  readonly servicePlanFailure?: string | undefined;
  readonly servicePlanProblems?: ReadonlyArray<HqProblem> | undefined;
  readonly onRetryServicePlan?: () => void;
  /**
   * The early path, on a creation's step: where the person's own create stands, what it has made
   * here, and its press — offered to whoever may release.
   */
  readonly creation?:
    | {
        readonly run: ServiceCreateRun;
        readonly created: ReadonlyArray<ReleaseCreateOperation>;
        readonly onCreate: (() => void) | undefined;
      }
    | undefined;
  /** What HQ does in production for the release, as its jobs there stand. */
  readonly progress?: ReleaseProgress | undefined;
  /** When the release on its way was made, and who asked for it: "you", or a person's name. */
  readonly started?:
    | {
        readonly at: string | undefined;
        readonly by: string | undefined;
        /** When the tab that pressed saw it live; none for a tab that did not press. */
        readonly liveAt?: string | undefined;
      }
    | undefined;
  /** A service's deploy log, once its job has one. */
  readonly logOf?: ((service: string) => ReleaseStepLog | undefined) | undefined;
  /** How many changes the offer counts, known before they are listed. */
  readonly expected?: number | undefined;
  /** How many commits the offer counts. */
  readonly commits?: number | undefined;
  /** Production as HQ names it: where HQ's words lead with that name, the sheet says Production. */
  readonly environmentName?: string | undefined;
  /** How many services the release lists, known before HQ's plan: the places its steps hold. */
  readonly entries?: number | undefined;
  /**
   * The renewal of production's deploy key, for a release HQ stopped because it will not use the
   * one it keeps: where the sheet's own run of it stands, and its press — absent for a person
   * without admin access to production's project, who cannot renew it.
   */
  readonly keyRenewal?:
    | { readonly run: KeyRenewal; readonly onRenew: (() => void) | undefined }
    | undefined;
  /** The roll back's review of the release this one replaced, where HQ offers it. */
  readonly onRollBack?: (() => void) | undefined;
  /** Back to the offer, after a release that stopped: the next version's review. */
  readonly onReviewNew?: (() => void) | undefined;
  readonly git?: ZeropsProjectFlow["release"]["git"];
  readonly onReplaceToken?: (() => void) | undefined;
  /** HQ has not said what the release carries: its rows hold their places. */
  readonly changesPending?: boolean | undefined;
  /** The commits no change landed, once the offer counts them. */
  readonly outside?: OutsideCommits | undefined;
  readonly comparisonFailure?:
    | { readonly reason: string; readonly again?: (() => void) | undefined }
    | undefined;
  /** The project's name, beside where it acts. */
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
  /** Production: its parts and what each runs, and the addresses it answers at. */
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
  /** The clock every age and elapsed time here is read against: seconds while it is on its way. */
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

const PRODUCTION = { words: "Production", production: true } as const;
const NO_CREATION: ServiceCreateRun = { kind: "none" };
/** How many changes stand before "Show N more". */
const ROWS_SHOWN = 6;

/**
 * The release before its project is read: every section's place held, the button waiting. Nothing
 * here is taken back when the reads land.
 */
export function ReleaseReadingView({
  name,
  titleId,
  onClose,
}: {
  readonly name: string | undefined;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  return (
    <ZeropsReviewSurface
      consequence={RELEASE_READING}
      dismiss="Cancel"
      kind="release"
      kindLabel={name ?? ""}
      onClose={onClose}
      primary={{ label: "Release", enabled: false, safe: false, onPress: () => undefined }}
      subtitle={<span aria-hidden="true" className="rv-pskel my-1 w-56" />}
      title="Release"
      titleId={titleId}
      verdict={{
        state: "release-blocked",
        tone: "busy",
        title: "Release",
        why: RELEASE_READING,
        fix: undefined,
      }}
      where={PRODUCTION}
    >
      {/* The least a release says: one change, one service and production answering. What the
          project's reads bring more of only pushes the buttons down. */}
      <ReviewSection title="What goes out">
        <ReleaseRowsSkeleton count={1} />
      </ReviewSection>
      <ReviewSection title="What happens in production">
        <ReleasePlanSkeleton steps={2} />
      </ReviewSection>
    </ZeropsReviewSurface>
  );
}

/** The changes' places while HQ has not listed them: as many rows as it counted, in their size. */
function ReleaseRowsSkeleton({ count }: { readonly count: number }) {
  return (
    <div aria-busy="true" className="rv-rel">
      {Array.from({ length: Math.max(1, Math.min(count, ROWS_SHOWN)) }, (_, index) => (
        <div aria-hidden="true" className="rv-relrow" data-skeleton="" key={index}>
          <span className="rv-pskel" />
          <span className={`rv-pskel rv-relrow-t ${index % 2 === 0 ? "w-64" : "w-48"}`} />
          <span className="rv-pskel rv-relrow-sub w-28" />
        </div>
      ))}
    </div>
  );
}

export function ReleaseReviewView(props: ReleaseReviewViewProps) {
  return props.git === undefined ? (
    <ProductionReleaseView {...props} />
  ) : (
    <GitReleaseView {...props} git={props.git} />
  );
}

/** The version's field with its rules and what the code declares: shown once asked for. */
export function ReleaseVersionField({
  version,
  error,
  disabled,
}: {
  readonly version: NonNullable<ReleaseReviewViewProps["version"]>;
  readonly error: string | undefined;
  readonly disabled: boolean;
}) {
  const versionId = useId();
  return (
    <div className="rv-version">
      <div className="w-44">
        <Input
          aria-label="Version"
          aria-describedby={`${versionId}-help`}
          aria-invalid={error !== undefined}
          autoComplete="off"
          disabled={disabled}
          font="mono"
          id={versionId}
          nativeInput
          onChange={(event) => version.onChange(event.target.value)}
          spellCheck={false}
          value={version.value}
        />
      </div>
      <p className="rv-note" id={`${versionId}-help`}>
        {error ??
          // The next patch, said only while the field holds something else.
          (`v${version.value}` === version.nextPatch
            ? "Must be newer than every release."
            : `Must be newer than every release. Next patch is ${version.nextPatch}.`)}
      </p>
      {version.suggestions.map((suggestion) => (
        <p className="rv-note rv-version-use" key={suggestion.source}>
          Your code names {suggestion.tag}.
          <Button
            disabled={disabled}
            onClick={() => version.onChange(suggestion.tag.slice(1))}
            size="sm"
            variant="link"
          >
            Use it
          </Button>
        </p>
      ))}
    </div>
  );
}

/** A release to a Zerops production, from reading to done (the module's note). */
function ProductionReleaseView(props: ReleaseReviewViewProps) {
  const { rows, press, tag, outcome } = props;
  const offered = outcome.kind === "offered";
  const checkedVersion =
    props.version === undefined || !offered
      ? undefined
      : releaseVersionField(props.version.value, props.version.tags);
  // The version stands in words; its field and rules — semver, what the code declares — come when
  // the person asks to change it, or when what they typed is wrong.
  const [changing, setChanging] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const model = releaseReview({
    tag,
    git: undefined,
    gate: props.gate,
    permission: props.permission,
    changes: props.changesPending === true ? undefined : rows.length,
    onStage:
      props.hasStage && props.changesPending !== true
        ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
        : undefined,
    services: props.services,
    replaces: props.replaces,
    outcome,
    productionMoved: props.productionMoved,
    now: props.now,
  });
  const { state } = model.verdict;
  // Not read yet is no refusal: the sections hold their places and the button waits.
  const reading =
    offered &&
    ((!props.gate.allowed && props.gate.reason === RELEASE_CHECKING) ||
      (props.gate.allowed && props.servicePlanPending === true));
  const blocked = offered && !reading && !props.gate.allowed;
  // Nothing to release is nothing to plan: no steps, no version to name.
  const nothing = blocked && model.verdict.tone === "done";
  const refused = press.kind === "refused" ? press.reason : undefined;
  const problems =
    press.kind === "refused"
      ? press.problems
      : (props.servicePlanProblems ??
        (outcome.kind === "failed" ? outcome.problems : props.problems));
  const fix = problemsFix(problems ?? NO_PROBLEMS) ?? model.verdict.fix;

  const early = props.creation?.run ?? NO_CREATION;
  const made = props.creation === undefined ? NO_OPERATIONS : props.creation.created;
  const open = putLiveAddress(props.production === undefined ? [] : props.production.addresses);
  const deployed = planDeployServices(props.servicePlan, props.services);
  const steps = releaseSheetSteps({
    tag,
    outcome,
    pressing: press.kind === "running",
    plan: props.servicePlan,
    created: made,
    early,
    canCreate: props.creation?.onCreate !== undefined,
    services: props.services,
    untouched: props.where
      .map((entry) => entry.service)
      .filter((service) => !deployed.includes(service)),
    versions: new Map(
      (props.production === undefined ? [] : props.production.parts).flatMap((part) =>
        part.version === undefined ? [] : [[part.hostname, part.version] as const],
      ),
    ),
    replaces: props.replaces,
    host: open?.host,
    progress: props.progress,
    stopped:
      state === "release-stalled"
        ? model.verdict.why
        : state === "release-superseded"
          ? model.consequence
          : undefined,
    environmentName: props.environmentName,
    renewal: props.keyRenewal?.run,
    mayRenew: props.keyRenewal?.onRenew !== undefined,
    nowMs: props.now,
  });
  const creates = offered
    ? steps.flatMap((step) =>
        step.kind === "create" && step.mark !== "done" && step.service !== undefined
          ? [step.service]
          : [],
      )
    : [];
  const liveAt =
    props.started?.liveAt ??
    newestEnd(props.progress) ??
    (outcome.kind === "released" ? outcome.at : undefined);
  const subtitle = releaseSubtitle({
    state,
    said: state === "release-stalled" ? model.consequence : model.verdict.why,
    changes: props.changesPending === true ? props.expected : rows.length,
    mates: [...new Set(rows.flatMap((row) => (row.mate === undefined ? [] : [row.mate])))],
    replaces: props.replaces,
    startedAt: props.started?.at,
    startedBy: props.started?.by,
    liveAt,
    deployed: steps.some((step) => step.kind === "deploy" && step.mark === "done"),
    nowMs: props.now,
  });
  const where = releaseStepWords({
    steps,
    outcome,
    startedAt: props.started?.at,
    nowMs: props.now,
  });

  // The foot: its note, and the way out of whatever state it stands in.
  const stopped = outcome.kind === "failed" || outcome.kind === "stalled";
  // Stopped on production's deploy key: creating again cannot help, renewing the key does, and
  // then the way on is a new release — HQ runs nothing of a release whose creation did not stand.
  const keyStop = steps.find((step) => step.deployKey !== undefined);
  const renewal = props.keyRenewal?.run ?? NOT_RENEWING;
  const onRenew = props.keyRenewal?.onRenew;
  const failedCreation = steps.find((step) => step.kind === "create" && step.mark === "failed");
  const onCreate = props.creation?.onCreate;
  const { onReviewNew } = props;
  const wayOut: ReviewPrimaryButton | undefined = !stopped
    ? undefined
    : keyStop !== undefined
      ? renewal.kind === "renewed"
        ? onReviewNew === undefined
          ? undefined
          : { label: "Review a new release", enabled: true, safe: false, onPress: onReviewNew }
        : onRenew === undefined
          ? undefined
          : {
              label: renewal.kind === "working" ? "Renewing" : "Renew the key",
              enabled: true,
              safe: false,
              busy: renewal.kind === "working",
              onPress: onRenew,
            }
      : early.kind === "working"
        ? {
            label: "Creating",
            enabled: false,
            safe: false,
            busy: true,
            onPress: () => undefined,
          }
        : failedCreation?.action !== undefined && onCreate !== undefined
          ? {
              label: `Create ${creationNames(steps)} again`,
              enabled: true,
              safe: false,
              onPress: onCreate,
            }
          : onReviewNew !== undefined
            ? { label: "Review a new release", enabled: true, safe: false, onPress: onReviewNew }
            : undefined;
  // A stop whose one button is its own way out (the key, the creation) keeps the way to the next
  // release behind ⋯: no stop is a dead end, opened again or not.
  const reviewNext =
    stopped && onReviewNew !== undefined && wayOut?.onPress !== onReviewNew
      ? [{ label: "Review a new release", onPress: onReviewNew }]
      : [];
  const press1 = releasePressLabel(tag, creates);
  const primary: ReviewPrimaryButton | undefined = offered
    ? {
        label: press1,
        enabled:
          model.primary?.enabled === true &&
          !reading &&
          checkedVersion?.error === undefined &&
          props.servicePlanFailure === undefined &&
          early.kind !== "working",
        safe: false,
        onPress: props.onRelease,
      }
    : wayOut;
  const note: {
    readonly words: string;
    readonly tone?: "attention" | "failed";
    readonly action?: ReviewButton;
  } = !offered
    ? outcome.kind === "released"
      ? props.onRollBack !== undefined && props.replaces.kind === "release"
        ? {
            words: "",
            action: {
              label: `Roll back to ${props.replaces.tag}…`,
              onPress: props.onRollBack,
            },
          }
        : { words: "" }
      : where.tone === "quiet"
        ? { words: where.note }
        : { words: where.note, tone: where.tone }
    : refused !== undefined
      ? { words: inProductionWords(refused, props.environmentName), tone: "failed" }
      : reading
        ? { words: RELEASE_READING }
        : props.servicePlanFailure !== undefined
          ? {
              // HQ's finding stands above in its own words: the foot says only what it holds back.
              words:
                problems !== undefined && problems.length > 0
                  ? "Nothing is released until this is fixed"
                  : inProductionWords(props.servicePlanFailure, props.environmentName).replace(
                      /\.$/u,
                      "",
                    ),
              tone: "attention",
              ...(props.onRetryServicePlan === undefined
                ? {}
                : { action: { label: "Review again", onPress: props.onRetryServicePlan } }),
            }
          : blocked
            ? {
                words: inProductionWords(model.verdict.why, props.environmentName),
                ...(model.verdict.tone === "attention" ? { tone: "attention" as const } : {}),
              }
            : { words: creates.length > 0 ? "Takes a few minutes" : RELEASE_TAKES };

  // HQ's own note on what it asked for at the press, where it left one.
  const answer = useReviewDeploys(press);
  const answerNote = releaseNoteSaid({
    note: answer === undefined ? undefined : deployAnswerSaid(answer).note,
    stopped: releaseStopReason(props.progress),
    // The key renewed, its sentence stands nowhere: the note says only what HQ could not do.
    reasonGone: renewal.kind === "renewed",
    environmentName: props.environmentName,
  });
  const shown = allRows ? rows : rows.slice(0, ROWS_SHOWN);
  const counted =
    props.changesPending === true ? props.expected : rows.length === 0 ? undefined : rows.length;
  const browse =
    offered && props.appId !== undefined
      ? (props.productionCode ?? NO_CODE).map((entry) => ({
          label:
            (props.productionCode ?? NO_CODE).length === 1
              ? "Browse production's files"
              : `Browse ${entry.service}'s files`,
          to: gitCodeLink({ appId: props.appId!, repo: entry.repository }, entry.sha),
        }))
      : [];
  // While it releases, a service it redeploys is deploying — its step says so — and what it ran
  // is no fact to be unable to tell.
  const untold =
    outcome.kind === "releasing"
      ? props.untold.filter((service) => !deployed.includes(service))
      : props.untold;
  const version = offered && !nothing ? props.version : undefined;
  return (
    <ZeropsReviewSurface
      consequence={note.words}
      consequenceTone={note.tone}
      dismiss={offered ? "Cancel" : outcome.kind === "released" ? "Done" : "Close"}
      held={!offered}
      // What HQ refused with a fix a Mate can make: asked for beside the way out.
      ask={
        // Offered, or stopped on something a Mate can fix: never for the key, which is a person's.
        (offered || (stopped && keyStop === undefined && early.kind !== "working")) &&
        fix !== undefined &&
        props.fixer !== undefined
          ? {
              label: `Ask ${props.fixer} to ${fix.verb}`,
              onPress: () => {
                props.onFix(fix.problem);
              },
            }
          : undefined
      }
      kind="release"
      kindLabel={props.name ?? ""}
      menu={[...browse, ...reviewNext]}
      noteAction={note.action}
      onClose={props.onClose}
      primary={primary}
      subtitle={
        <>
          <WordsOf words={subtitle} />
          {outcome.kind === "released" && open !== undefined ? (
            <>
              {" · "}
              <InlineButton render={<a href={open.url} rel="noreferrer" target="_blank" />}>
                {open.host}
                <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
              </InlineButton>
            </>
          ) : null}
        </>
      }
      title={model.verdict.title}
      titleId={props.titleId}
      titleWords={<WordsOf words={wordsNaming(model.verdict.title)} />}
      verdict={model.verdict}
      where={PRODUCTION}
    >
      <HqProblems problems={problems} />
      {rows.length === 0 &&
      props.outside === undefined &&
      props.changesPending !== true &&
      untold.length === 0 &&
      props.comparisonFailure === undefined ? null : (
        <ReviewSection
          aside={
            counted === undefined
              ? undefined
              : [
                  `${String(counted)} ${counted === 1 ? "change" : "changes"}`,
                  ...(props.commits === undefined || props.commits < counted
                    ? []
                    : [`${String(props.commits)} ${props.commits === 1 ? "commit" : "commits"}`]),
                ].join(" · ")
          }
          title="What goes out"
        >
          {props.comparisonFailure === undefined ? null : (
            <ZeropsReadFailure action="Compare again" {...props.comparisonFailure} />
          )}
          {props.changesPending === true ? (
            offered ? (
              <ReleaseRowsSkeleton count={props.expected ?? 1} />
            ) : null
          ) : rows.length === 0 ? null : (
            <ReviewReleaseRows appId={props.appId} onOpen={props.onOpenChange} rows={shown} />
          )}
          {rows.length > shown.length ? (
            <Button onClick={() => setAllRows(true)} size="sm" variant="ghost">
              Show {rows.length - shown.length} more
            </Button>
          ) : null}
          {props.outside === undefined ? null : (
            <OutsideCommitsList
              appId={props.appId}
              onOpen={props.onOpenChange}
              outside={props.outside}
            />
          )}
          {untold.length === 0 ? null : <p className="rv-note">{cannotTellWhatRuns(untold)}.</p>}
        </ReviewSection>
      )}
      {/* What HQ's plan would say is not known where it could not be read: the foot says why. */}
      {props.servicePlanFailure !== undefined || nothing ? null : (
        <ReviewSection title="What happens in production">
          <GrowsInPlace>
            {reading ? (
              // A step per service the release lists, known before HQ's plan, and production
              // answering: the plan then only adds what it creates.
              <ReleasePlanSkeleton steps={(props.entries ?? deployed.length) + 1} />
            ) : (
              <ReleasePlan
                live={{ open, onAddDomain: props.onAddDomain }}
                logOf={props.logOf}
                // Stopped, the way out is the foot's button: the step does not say it twice.
                onCreate={stopped ? undefined : onCreate}
                onRenew={onRenew}
                renewing={renewal.kind === "working"}
                steps={renewal.kind === "renewed" ? keyRenewedSteps(steps) : steps}
              />
            )}
          </GrowsInPlace>
          {answerNote === undefined ? null : <p className="rv-note">{answerNote}</p>}
        </ReviewSection>
      )}
      {version === undefined ? null : changing || checkedVersion?.error !== undefined ? (
        <ReviewSection title="Version">
          <ReleaseVersionField
            disabled={press.kind === "running"}
            error={checkedVersion?.error}
            version={version}
          />
        </ReviewSection>
      ) : (
        // A section as its field is: the sheet's last, the one its buttons follow.
        <section className="rv-version-row" data-zerops-surface="release-version">
          Version
          <span className="rv-code text-foreground">
            {checkedVersion?.tag ?? `v${version.value}`}
          </span>
          <span aria-hidden="true">·</span>
          <InlineButton onClick={() => setChanging(true)}>Change</InlineButton>
        </section>
      )}
    </ZeropsReviewSurface>
  );
}

const NO_PROBLEMS: ReadonlyArray<HqProblem> = [];
const NO_OPERATIONS: ReadonlyArray<ReleaseCreateOperation> = [];
const NO_CODE: ReturnType<typeof productionCode> = [];

/** The services the release deploys to: the plan's, else the ones the comparison moves. */
function planDeployServices(
  plan: ReleaseServicePlan | undefined,
  services: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const planned =
    plan === undefined
      ? []
      : plan.operations.flatMap((operation) =>
          operation.kind === "deploy" ? [operation.service] : [],
        );
  return planned.length > 0 ? planned : services;
}

/** The creations Zerops failed, by name: "db", "db and cache". */
function creationNames(steps: ReadonlyArray<ReleaseSheetStep>): string {
  const names = steps.flatMap((step) =>
    step.kind === "create" && step.mark === "failed" && step.service !== undefined
      ? [step.service]
      : [],
  );
  return names.length <= 1
    ? (names[0] ?? "it")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/** When the last of the release's deploys ended: when production took it. */
function newestEnd(progress: ReleaseProgress | undefined): string | undefined {
  let newest: string | undefined;
  for (const deploy of progress === undefined ? [] : progress.deploys) {
    if (deploy.state !== "live" || deploy.endedAt === null) continue;
    if (newest === undefined || Date.parse(deploy.endedAt) > Date.parse(newest))
      newest = deploy.endedAt;
  }
  return newest;
}

/**
 * A release delivered to a branch of a repository: Mate's push is the hand-over, and what happens
 * after it is that repository's. Its own facts, in the review's frame.
 */
function GitReleaseView(
  props: ReleaseReviewViewProps & {
    readonly git: NonNullable<ReleaseReviewViewProps["git"]>;
  },
) {
  const { rows, press, tag } = props;
  const offered = props.outcome.kind === "offered";
  const version = offered || props.outcome.kind === "releasing" ? props.version : undefined;
  const checkedVersion =
    version === undefined || !offered
      ? undefined
      : releaseVersionField(version.value, version.tags);
  const [changing, setChanging] = useState(false);
  const inWords =
    props.replaces.kind === "first" && !changing && checkedVersion?.error === undefined;
  const model = releaseReview({
    tag,
    git: props.git,
    gate: props.gate,
    permission: props.permission,
    changes: props.changesPending === true ? undefined : rows.length,
    onStage: undefined,
    services: props.services,
    replaces: props.replaces,
    outcome: props.outcome,
    productionMoved: props.productionMoved,
    now: props.now,
  });
  const problems =
    press.kind === "refused"
      ? press.problems
      : props.outcome.kind === "failed"
        ? props.outcome.problems
        : props.problems;
  const fix = problemsFix(problems ?? NO_PROBLEMS) ?? model.verdict.fix;
  const refused = press.kind === "refused" ? press.reason : undefined;
  const ready = model.verdict.state === "release-ready";
  const { onReplaceToken } = props;
  return (
    <ZeropsReviewSurface
      consequence={refused ?? model.consequence}
      consequenceTone={refused === undefined ? undefined : "failed"}
      dismiss="Cancel"
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
      kindLabel={props.name ?? ""}
      onClose={props.onClose}
      primary={
        model.primary === undefined ||
        (model.primary.label === "Replace token" && onReplaceToken === undefined)
          ? undefined
          : {
              ...model.primary,
              enabled: model.primary.enabled && checkedVersion?.error === undefined,
              busy: press.kind === "running",
              label: press.kind === "running" ? `Releasing ${tag}` : model.primary.label,
              text: `${model.primary.label} to production`,
              onPress:
                model.primary.label === "Replace token" && onReplaceToken !== undefined
                  ? onReplaceToken
                  : props.onRelease,
            }
      }
      title={`Release ${tag}`}
      titleId={props.titleId}
      titleWords={<WordsOf words={wordsNaming(`Release ${tag}`)} />}
      verdict={model.verdict}
      verdictInLine={!ready}
      whySaid={whySaid(model.verdict, false)}
      where={PRODUCTION}
    >
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
                {gitWhereLine("production", props.git.attachment.target, repo.remote.url)}
                {repo.expiry === undefined ? null : <> · {repo.expiry}</>}
              </p>
            )}
          </div>
        ))}
        {offered ? null : (
          <GitDeliveryStatus
            environment={{ tier: "production", target: props.git.attachment.target }}
            delivery={props.git.delivery}
            showDestination={false}
          />
        )}
      </ReviewSection>
      <HqProblems problems={problems} />
      {props.comparisonFailure === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...props.comparisonFailure} />
      )}
      {rows.length === 0 && props.outside === undefined ? null : (
        <ReviewSection title="What goes out">
          {rows.length === 0 ? null : (
            <ReviewReleaseRows appId={props.appId} onOpen={props.onOpenChange} rows={rows} />
          )}
          {props.outside === undefined ? null : (
            <OutsideCommitsList
              appId={props.appId}
              onOpen={props.onOpenChange}
              outside={props.outside}
            />
          )}
        </ReviewSection>
      )}
      {version === undefined ? null : inWords ? (
        <p className="rv-version-row" data-zerops-surface="release-version">
          Version
          <span className="rv-code text-foreground">
            {checkedVersion?.tag ?? `v${version.value}`}
          </span>
          {offered ? (
            <>
              <span aria-hidden="true">·</span>
              <InlineButton onClick={() => setChanging(true)}>Change</InlineButton>
            </>
          ) : null}
        </p>
      ) : (
        <ReviewSection title="Version">
          <ReleaseVersionField
            disabled={press.kind === "running" || !offered}
            error={checkedVersion?.error}
            version={version}
          />
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
    reads: { environmentInputs: flow.environmentInputs, stalled: flow.release.stalled },
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
      where={PRODUCTION}
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
