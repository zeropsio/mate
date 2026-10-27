/**
 * A change's review: a pull request, read before it is merged (R2–R6).
 *
 * Its row comes from the flow the moment it opens, with the change's description; what the flow
 * does not carry is HQ's detail of it, read as it opens (`useZeropsChangeDetail`): its files with
 * their diffs, the commits it squashes, how it merges and whether `main` moved on under it. The run
 * that made it is its Mate's newest answer linking it: what it said stands in for a description
 * nobody wrote.
 *
 * Merge squashes it in HQ with the head the review shows, and *Close without merging…* asks
 * before it closes it — each where HQ offers it to the person (`useChangeOffers`). After
 * Merge the review stays: it says what happened and where production waits for a code change.
 * Production has its own release review. A recipe change is never released: its review
 * says, from the files it changed, what its merge does to the environments made from it.
 *
 * `ChangeReviewView` is the picture with every read handed in, so the harness shows each state.
 */
import {
  changeAskPrompt,
  changeHandedPrompt,
  changeRemarks,
  changeReview,
  recipeReach,
  waitingForProduction,
  type ChangeReadout,
  type ChangeReviewInput,
  type ReviewClose,
  type ReviewHand,
  type ReviewPress,
  type ReviewQuestion,
  type ChangeReadoutCommit,
  type ChangeRemark,
  type FlowPullRequest,
  type GroupEnvironmentTier,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useRouter } from "@tanstack/react-router";
import { ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, InlineButton } from "~/components/ui/button";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useMateNames, useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import { reviewTargetKey, useOpenReview, type ReviewTarget } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import { pullRequestLinkWords } from "~/zerops/automatedMate.logic";
import { useAddEnvironment, useEnvironmentQuestionFacts } from "~/zerops/useAddEnvironment";
import { useOpenPutLive } from "~/zerops/putLive";
import { type ZeropsChangeOffers, useChangeOffers } from "~/zerops/useChangeOffers";
import {
  mergedMain,
  useZeropsChangeDetail,
  type ReadoutPart,
} from "~/zerops/useZeropsChangeDetail";
import { useChangeDiscussion, type ChangeDiscussion } from "~/zerops/useChangeDiscussion";
import { useZeropsChangeRun } from "~/zerops/useZeropsChangeRun";
import { useZeropsChangeCommits } from "~/zerops/useZeropsChangeCommits";
import { useZeropsChangeFileDiffs } from "~/zerops/useZeropsChangeFileDiffs";
import { useHqPictureSource, type ChangePictureSource } from "~/zerops/useProjectedHqPicture";
import { useLinkedChange } from "~/zerops/useLinkedChange";
import { useNowMs } from "~/zerops/useNowMs";
import { useFixMates } from "~/zerops/fixMates";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { useReviewDeploys } from "../ZeropsDeployAnswer";
import {
  changeChecks,
  changeCode,
  changeReceipt,
  changeReadVerdict,
  mergeFoot,
  otherOpenChanges,
  reviewBranch,
  reviewKindLine,
  sizeWords,
  whySaid,
  type ReviewFrame,
  type ReviewKind,
} from "./ZeropsReview.logic";
import {
  GitBrowserLink,
  gitCodeLink,
  gitCommitLink,
  gitFileLink,
  type GitRepoAt,
} from "../gitBrowser/GitBrowserLink";
import { ReviewCommits } from "./ReviewCommits";
import { mainStageOf, useGroupName, useMatePreviews, type ReviewPreview } from "./reviewReads";
import { ReviewConversation } from "./ReviewConversation";
import { ReviewDescription } from "./ReviewDescription";
import { useReviewHold } from "./ZeropsReviewDialog";
import {
  ReviewFiles,
  ReviewSection,
  ReviewTry,
  ReviewWhere,
  ReviewSize,
  useReviewFold,
  ZeropsReviewSurface,
  type ReviewButton,
  type ReviewDiffState,
} from "./ZeropsReviewSurface";

const KIND: ReviewKind = "change";
/** How long a change with no description holds the room of its run's words for them. */
const RUN_WORDS_WAIT_MS = 3_000;

type ChangeTarget = Extract<ReviewTarget, { readonly kind: "change" }>;

export function ZeropsChangeReview({
  frame = "dialog",
  target,
  titleId,
  onClose,
  back,
}: {
  /** In a dialog over the conversation, or as the change's own page. */
  readonly frame?: ReviewFrame;
  readonly target: ChangeTarget;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  /**
   * Read from the release or the roll back that lists it: already merged, it offers no button,
   * and "← Release" or "← Roll back" goes back.
   */
  readonly back?: ReviewButton | undefined;
}) {
  // The change's head, words and landing are its application's detail: held while it is drawn.
  useHqAppDetailHold([target.groupId]);
  const reviewOffers = useChangeOffers()(target.groupId);
  const denied = reviewOffers?.readRefused === true;
  const router = useRouter();
  // The application's flow, with the release offer HQ recorded: nothing is compared here.
  const flows = useProjectFlows(useMemo(() => [target.groupId], [target.groupId]));
  // The dialog's way to the same review at the change's own address.
  const onOpenPage =
    frame === "page"
      ? undefined
      : () => {
          onClose();
          void router.navigate({
            to: "/change/$groupId/$repository/$number",
            params: {
              groupId: target.groupId,
              repository: target.repository,
              number: String(target.number),
            },
          });
        };
  const flow = flows.flows.get(target.groupId);
  const matches = (pull: FlowPullRequest) =>
    pull.repository === target.repository && pull.number === target.number;
  const open = flow?.pullRequests.find(matches);
  const merged = flow?.merged.find(matches);
  // A change the flow does not hold — landed before the flow was read, or a flow not read yet —
  // is read on its own.
  const landed = useLinkedChange(
    denied || open !== undefined || merged !== undefined
      ? null
      : { appId: target.groupId, repo: target.repository, number: target.number },
  );
  const current = denied
    ? undefined
    : (open ?? merged ?? (landed.kind === "read" ? landed.pull : undefined));
  // A change just merged leaves the open ones a read before the landed ones have it: the review
  // keeps the change it was showing.
  const [held, setHeld] = useState(current);
  if (denied && held !== undefined) setHeld(undefined);
  else if (current !== undefined && current !== held) setHeld(current);
  const pull = denied ? undefined : (current ?? held);
  // The change itself still read: the sheet waits a moment to show it whole.
  useReviewHold(
    pull === undefined && !denied && (landed.kind === "reading" || landed.kind === "idle"),
  );

  if (pull === undefined) {
    return (
      <ZeropsReviewSurface
        back={back}
        consequence="Nothing is merged from here until the change is read."
        frame={frame}
        kind={KIND}
        kindLabel={reviewKindLine(KIND)}
        onClose={onClose}
        onOpenPage={onOpenPage}
        primary={
          denied || landed.readAgain === undefined
            ? undefined
            : {
                label: "Read again",
                onPress: landed.readAgain,
                enabled: true,
                safe: true,
              }
        }
        title={`#${String(target.number)}`}
        titleId={titleId}
        verdict={changeReadVerdict({
          repository: target.repository,
          number: target.number,
          read: denied
            ? {
                kind: "refused",
                reason: reviewOffers.why.read ?? "HQ no longer offers read access to this change.",
              }
            : landed.kind === "read"
              ? { kind: "reading" }
              : landed,
          failure: flows.readFailure,
          projectKnown: flows.groupsRead ? flows.knownGroups.has(target.groupId) : undefined,
        })}
      />
    );
  }
  return (
    // Keyed by the change, so a page whose address moves to another change starts that review
    // from its own state: nothing pressed on the one before carries over.
    <ChangeReviewData
      key={reviewTargetKey(target)}
      reviewOffers={reviewOffers}
      flow={flow}
      hqAddress={flows.hqAddress}
      frame={frame}
      back={back}
      onOpenPage={onOpenPage}
      onClose={onClose}
      pull={pull}
      target={target}
      titleId={titleId}
    />
  );
}

function ChangeReviewData({
  reviewOffers,
  flow,
  hqAddress,
  frame,
  onOpenPage,
  back,
  pull,
  target,
  titleId,
  onClose,
}: {
  readonly reviewOffers: ZeropsChangeOffers | undefined;
  /** The project's flow; `undefined` while it waits its turn to be read. */
  readonly flow: ZeropsProjectFlow | undefined;
  /** The organization's official HQ, whose addresses name its changes. */
  readonly hqAddress: string | undefined;
  readonly frame: ReviewFrame;
  readonly onOpenPage: (() => void) | undefined;
  readonly back: ReviewButton | undefined;
  readonly pull: FlowPullRequest;
  readonly target: ChangeTarget;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const openReview = useOpenReview();
  const now = useNowMs();
  const askMate = useAskMate();
  const askMateToFix = useAskMateToFix();
  const mates = useZeropsReviewMates(target.groupId);
  const pictures = useHqPictureSource();
  const addEnvironment = useAddEnvironment();
  const openPutLive = useOpenPutLive();
  const question = useEnvironmentQuestionFacts(target.groupId, flow);
  const verbs = useFlowVerbs();
  const mateNames = useMateNames();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The offer HQ sends right after a merge is not read yet; once it has gone pending and is read
  // again, it counts the change this review merged, and the review stops adding it.
  const offerPending = flow?.release.summaryRead === "pending";
  const [offerMoved, setOfferMoved] = useState(false);
  if (press.kind === "done" && offerPending && !offerMoved) setOfferMoved(true);
  const [closePress, setClosePress] = useState({
    head: pull.headSha,
    press: { kind: "idle" } as ReviewClose,
  });
  // A confirmation is for the work shown when it was asked. A newer push needs a new confirmation;
  // an already-submitted close keeps following its receipt.
  const changed =
    closePress.head !== pull.headSha &&
    (closePress.press.kind === "asked" || closePress.press.kind === "refused");
  const closing: ReviewClose = changed ? { kind: "idle" } : closePress.press;
  if (changed) setClosePress({ head: pull.headSha, press: { kind: "idle" } });
  const setClosing = (press: ReviewClose) => setClosePress({ head: pull.headSha, press });
  const change = { repository: pull.repository, number: pull.number };
  const merge = async () => {
    setPress({ kind: "running" });
    // The head the review shows: its files were read for it, and one pushed since HQ refuses.
    const outcome = await verbs.merge(target.groupId, change, pull.headSha);
    setPress(
      outcome.ok
        ? { kind: "done", deploys: outcome.deploys, rollout: outcome.rollout }
        : { kind: "refused", reason: outcome.reason },
    );
  };
  const close = async () => {
    setClosing({ kind: "running" });
    const outcome = await verbs.close(target.groupId, change, pull.headSha ?? null);
    setClosing(outcome.ok ? { kind: "done" } : { kind: "refused", reason: outcome.reason });
  };
  const [hand, setHand] = useState<ReviewHand>({ kind: "idle" });
  // Handed over, the Mate it went to is told in its conversation that the change is its own now.
  const handTo = async (mateProjectId: string) => {
    setHand({ kind: "running", to: mateProjectId });
    const outcome = await verbs.hand(target.groupId, change, mateProjectId);
    if (!outcome.ok) {
      setHand({ kind: "refused", reason: outcome.reason });
      return;
    }
    setHand({ kind: "done", to: mateProjectId });
    askMate(
      mateProjectId,
      changeHandedPrompt({
        number: pull.number,
        repository: pull.repository,
        title: pull.title,
        branch: pull.branch,
      }),
    );
    onClose();
  };

  const mate = mates.get(pull.mateProjectId);
  const heirs = useMemo(
    () =>
      [...mates.values()]
        .filter((entry) => entry.mateProjectId !== pull.mateProjectId)
        .map((entry) => ({ projectId: entry.mateProjectId, name: entry.name })),
    [mates, pull.mateProjectId],
  );
  // Only the Mate that wrote it can push to its branch: the fix goes to it, if it is the
  // person's own (S6, the one rule `fixMates.ts` keeps for every surface).
  const fixers = useFixMates({ projectId: pull.mateProjectId, groupId: target.groupId });
  const mine = fixers.some((option) => option.mateProjectId === pull.mateProjectId);
  const detail = useZeropsChangeDetail({
    link: { appId: target.groupId, repo: pull.repository, number: pull.number },
    head: pull.headSha,
    // The base belongs to this repository, even when another repository merged more recently.
    main:
      flow?.repos?.find((repo) => repo.name === pull.repository)?.mainHead ??
      mergedMain(pull.repository, flow?.merged),
  });
  // The recorded review holds no diff: a file's is read when the person unfolds it.
  const fileDiffs = useZeropsChangeFileDiffs({
    appId: target.groupId,
    repo: pull.repository,
    base: detail.readout.kind === "read" ? detail.readout.value.diffBase : null,
    head: pull.headSha,
  });
  // Commits HQ never recorded are read from the repository only on the person's press.
  const [commitsWanted, setCommitsWanted] = useState(false);
  const showCommits = useCallback(() => {
    setCommitsWanted(true);
  }, []);
  const commitsUnrecorded = detail.readout.kind === "read" && !detail.readout.value.commitsKnown;
  const commits = useZeropsChangeCommits(
    commitsWanted && commitsUnrecorded
      ? {
          link: { appId: target.groupId, repo: pull.repository, number: pull.number },
          head: pull.headSha,
          main:
            flow?.repos?.find((repo) => repo.name === pull.repository)?.mainHead ??
            mergedMain(pull.repository, flow?.merged),
        }
      : null,
  );
  const readCommits = useMemo<ReadoutPart<ReadonlyArray<ChangeReadoutCommit>> | undefined>(
    () =>
      !commitsWanted || !commitsUnrecorded
        ? undefined
        : commits.readout.kind === "read"
          ? { kind: "read", value: commits.readout.value.commits }
          : commits.readout,
    [commitsWanted, commitsUnrecorded, commits.readout],
  );
  const run = useZeropsChangeRun({
    mateProjectId: pull.mateProjectId,
    appId: target.groupId,
    repository: pull.repository,
    number: pull.number,
  });
  const comments = useChangeDiscussion({
    appId: target.groupId,
    repo: pull.repository,
    number: pull.number,
  });
  // Who said it, as the organization's members name them; the reader's own words marked.
  const session = useZeropsSessionOptional();
  const nameOf = useHqPersonNames(session?.activeOrganization?.id);
  const me = session?.user?.id;
  // A Mate's words brought over from HQ, as the application names its Mates.
  const mateNameOf = useCallback((projectId: string) => mates.get(projectId)?.name, [mates]);
  const remarks = useMemo(
    () =>
      comments.state.kind === "read"
        ? changeRemarks({ comments: comments.state.comments, nameOf, mateNameOf, me })
        : NO_REMARKS,
    [comments.state, me, nameOf, mateNameOf],
  );
  // A conversation that never answers is not waited on for ever: its lines give way.
  const [runGaveUp, setRunGaveUp] = useState(false);
  useEffect(() => {
    if (!run.reading) return;
    const timer = setTimeout(() => {
      setRunGaveUp(true);
    }, RUN_WORDS_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [run.reading]);
  const runRef = run.threadRef;
  // The sheet slides in once it can say all of it: its files and commits, how it merges, whether
  // HQ offers Merge, and its words — or after a moment, each part still read standing in its shape.
  useReviewHold(
    detail.readout.kind === "reading" ||
      reviewOffers === undefined ||
      (pull.description === undefined && run.reading && !runGaveUp),
  );
  const project = useGroupName(target.groupId);
  // A recipe change is no pair's code: it offers every preview.
  const previews = useMatePreviews(
    pull.mateProjectId,
    flow?.mateTier,
    pull.kind === "recipe" ? undefined : pull.repository,
  );

  return (
    <ChangeReviewView
      environments={flow?.environmentInputs ?? NO_ENVIRONMENTS}
      productionHeld={question.productionHeld}
      addable={question.addable}
      onAddEnvironment={(tier) => {
        onClose();
        // Asked once the change is merged, where the code should run: production is the project's
        // own Put it live — what is merged goes live — and a stage is the project's form.
        if (tier === "production") openPutLive(target.groupId);
        else addEnvironment(target.groupId, tier);
      }}
      frame={frame}
      hqAddress={hqAddress}
      back={back}
      onOpenPage={onOpenPage}
      live={flow?.releases.find((entry) => entry.standing === "live")?.tag}
      previews={previews}
      project={project}
      appId={target.groupId}
      stage={flow === undefined ? undefined : mainStageOf(flow)?.name}
      release={flow?.release.gate}
      mate={
        mate === undefined
          ? {
              name: mateNames.get(pull.mateProjectId) ?? "the Mate",
              tint: undefined,
              mine,
            }
          : { name: mate.name, tint: mate.tint, shape: mate.shape, mine }
      }
      now={now}
      comments={comments}
      remarks={remarks}
      offers={reviewOffers}
      press={press}
      closing={closing}
      heirs={heirs}
      hand={hand}
      onHand={(mateProjectId) => {
        void handTo(mateProjectId);
      }}
      onMerge={() => {
        void merge();
      }}
      onClosing={(step) => {
        if (step === "press") void close();
        else setClosing(step === "ask" ? { kind: "asked" } : { kind: "idle" });
      }}
      onAsk={async (said) => {
        // The change keeps the record of what was asked; the Mate gets the words to act on.
        const refusal = await comments.say(said);
        // Asked where the change's work is: the conversation bound to a lease of its branch.
        askMate(
          pull.mateProjectId,
          changeAskPrompt({
            number: pull.number,
            repository: pull.repository,
            title: pull.title,
            said,
          }),
          { branch: pull.branch, repositoryUrl: pull.repositoryUrl },
        );
        if (refusal === null) onClose();
      }}
      onClose={onClose}
      onRetry={detail.retry}
      showFiles={detail.showFiles}
      readDiffs={detail.readDiffs}
      fileDiffs={fileDiffs}
      commits={readCommits}
      showCommits={commitsUnrecorded && !commitsWanted ? showCommits : undefined}
      onFix={(problem) => {
        askMateToFix(pull.mateProjectId, problem, {
          branch: pull.branch,
          repositoryUrl: pull.repositoryUrl,
        });
        onClose();
      }}
      others={flow === undefined ? NO_OTHERS : otherOpenChanges(pull, flow.pullRequests)}
      onOpenChange={(number) => {
        const other = {
          kind: "change",
          groupId: target.groupId,
          repository: pull.repository,
          number,
        } as const;
        if (frame === "page")
          void router.navigate({
            to: "/change/$groupId/$repository/$number",
            params: {
              groupId: other.groupId,
              repository: other.repository,
              number: String(number),
            },
          });
        else openReview(other);
      }}
      onOpenRun={
        runRef === undefined
          ? undefined
          : () => {
              onClose();
              void router.navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(runRef),
              });
            }
      }
      pictures={pictures}
      pull={pull}
      readout={detail.readout}
      run={{ words: run.words, reading: run.reading && !runGaveUp }}
      titleId={titleId}
      waitingForProduction={waitingForProduction({
        summary: flow?.release.summary,
        pending: offerPending,
        mergedAhead: press.kind === "done" && !offerMoved,
      })}
    />
  );
}

/** No environments known: the project's flow is not read yet. */
const NO_ENVIRONMENTS: ReadonlyArray<{ readonly tier: GroupEnvironmentTier }> = [];

/** Nothing said: the state before the conversation is read. */
const NO_REMARKS: ReadonlyArray<ChangeRemark> = [];

/** No other open change of its Mate's known: the project's flow is not read yet. */
const NO_OTHERS: ReadonlyArray<Pick<FlowPullRequest, "number" | "title">> = [];

export interface ChangeReviewViewProps {
  /** A dialog over the conversation, or the change's own page. */
  readonly frame?: ReviewFrame | undefined;
  readonly pull: FlowPullRequest;
  /** The Mate that wrote it — its name, its face, and whether it is the person's own. */
  readonly mate: {
    readonly name: string;
    readonly tint: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
    readonly mine: boolean;
  };
  /** HQ's detail of it: its files and diffs, its commits, how it merges. */
  readonly readout: ReadoutPart<ChangeReadout>;
  /** What was said on it, and the way to say something back. */
  readonly comments: ChangeDiscussion;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  /**
   * What HQ offers the person (`useChangeOffers`): the comment box, Merge, Close — each only
   * where it does; `undefined` while HQ has not said, when Merge waits.
   */
  readonly offers: ZeropsChangeOffers | undefined;
  /** Merge, as pressed: running, refused in HQ's words, or done. */
  readonly press: ReviewPress;
  /** Closing without merging: asked, then pressed. */
  readonly closing: ReviewClose;
  /** The application's other Mates a change whose Mate is gone may be handed to. */
  readonly heirs?: ChangeReviewInput["heirs"];
  /** Handing it to one of them, as pressed. */
  readonly hand?: ReviewHand | undefined;
  readonly onHand?: ((mateProjectId: string) => void) | undefined;
  readonly run: { readonly words: string | undefined; readonly reading: boolean };
  /** The organization's official HQ, which its description's pictures and links are on. */
  readonly hqAddress: string | undefined;
  /** Where its description's pictures are read from, as the person. */
  readonly pictures: ChangePictureSource | undefined;
  /**
   * The environments `environments.yaml` declares: where `main` goes next, and what a recipe
   * change's merge reaches.
   */
  readonly environments: ReadonlyArray<{ readonly tier: GroupEnvironmentTier }>;
  /** How many changes wait for production, as HQ's release offer counts them; `undefined` until it has. */
  readonly waitingForProduction: number | undefined;
  /** Whether the application holds a production in any state (`ReviewQuestion`). */
  readonly productionHeld?: boolean | undefined;
  /** The environments the one question after a first merge may offer. */
  readonly addable?: ChangeReviewInput["addable"];
  /** Opens the form that adds the stage or the production the question offered. */
  readonly onAddEnvironment?: ((tier: GroupEnvironmentTier) => void) | undefined;
  /** The same release verdict the flow hands to the release review. */
  readonly release: ReleaseGate | undefined;
  /** The release production runs. */
  readonly live: string | undefined;
  /** The project's name: the top line's "Sage · Tea Shop". */
  readonly project?: string | undefined;
  /** The change's application at HQ: where its code opens in the Git browser; absent, it opens nowhere. */
  readonly appId?: string | undefined;
  /** The stage that follows `main`, by name: "Merge to stage". */
  readonly stage?: string | undefined;
  /** The Mate's previews, each pair's stage half by its service: "Try it". */
  readonly previews?: ReadonlyArray<ReviewPreview> | undefined;
  readonly now: number;
  readonly titleId?: string | undefined;
  /** Files whose diff stands open from the start — the harness's. */
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
  /**
   * Where a file's diff is read from its repository when the person unfolds it (the recorded
   * review carries none); absent, the readout holds them.
   */
  readonly fileDiffs?:
    | {
        readonly diffOf: (path: string) => ReviewDiffState;
        readonly ask: (path: string) => void;
      }
    | undefined;
  /** For a change whose files were never recorded: reads them from its repository on a press. */
  readonly showFiles?: (() => void) | undefined;
  /**
   * For a change recorded with no merge base to read a file's diff from: unfolding a file reads
   * HQ's detail of the change, which holds its diffs.
   */
  readonly readDiffs?: (() => void) | undefined;
  /**
   * The commits read from the repository on the person's press, for a change whose commits HQ
   * never recorded; absent, the readout holds them.
   */
  readonly commits?: ReadoutPart<ReadonlyArray<ChangeReadoutCommit>> | undefined;
  /** For a change whose commits were never recorded: reads them on a press. */
  readonly showCommits?: (() => void) | undefined;
  readonly onFix: (problem: FixProblem) => void;
  /**
   * Its Mate's other open changes in its repository (`otherOpenChanges`), each a way to its own
   * review; none where it is the Mate's only one there.
   */
  readonly others?: ReadonlyArray<Pick<FlowPullRequest, "number" | "title">> | undefined;
  /** Opens the review of the Mate's other open change `number` in the repository. */
  readonly onOpenChange?: ((number: number) => void) | undefined;
  /** Keeps the words on the change and hands them to its Mate, who changes the code. */
  readonly onAsk: (said: string) => Promise<void>;
  /** Reads again what could not be read. */
  readonly onRetry?: (() => void) | undefined;
  readonly onOpenRun: (() => void) | undefined;
  readonly onMerge: () => void;
  /** Close without merging: asked, kept open, or pressed once asked. */
  readonly onClosing: (step: "ask" | "keep" | "press") => void;
  /** The dialog's way to this review as the change's own page. */
  readonly onOpenPage?: (() => void) | undefined;
  /**
   * Read from the release or the roll back that lists it: "Merged" in the button's place, and the
   * way back.
   */
  readonly back?: ReviewButton | undefined;
  readonly onClose: () => void;
}

export function ChangeReviewView(props: ChangeReviewViewProps) {
  const { pull, readout, mate, press, closing } = props;
  const read = readout.kind === "read" ? readout.value : undefined;
  // Recorded diffs come with the readout; where they are left for later a file's is read on unfold.
  const laterDiffs = read?.diffBase != null ? props.fileDiffs : undefined;
  const commits: ReadoutPart<ReadonlyArray<ChangeReadoutCommit>> =
    props.commits ??
    (readout.kind === "read" ? { kind: "read", value: readout.value.commits } : readout);
  const history = useReviewFold();
  const downstream = {
    production: props.environments.some((entry) => entry.tier === "production"),
    stage: props.environments.some((entry) => entry.tier === "stage"),
  };
  const model = changeReview({
    // How it merges, and whether `main` moved on under it, are its record's until HQ's detail of it
    // is read, and the detail's after.
    pull:
      read === undefined
        ? pull
        : {
            ...pull,
            mergeability: read.mergeability,
            behind: read.behind,
          },
    mateName: mate.name,
    readout: readout.kind === "read" ? "read" : readout.kind === "failed" ? "failed" : "reading",
    commits: commits.kind === "read" ? commits.value.length : undefined,
    conflict:
      read === undefined || read.mergeability !== "conflicting"
        ? undefined
        : { files: read.conflict, by: undefined },
    downstream,
    productionHeld: props.productionHeld,
    addable: props.addable,
    waiting: {
      count: props.waitingForProduction,
      live: props.live,
    },
    release: props.release,
    recipe:
      pull.kind === "recipe" && read !== undefined
        ? recipeReach({
            files: read.files.map((file) => ({ filename: file.path })),
            environments: props.environments,
          })
        : undefined,
    offered: props.offers,
    press,
    close: closing,
    heirs: props.heirs,
    hand: props.hand,
    now: props.now,
  });
  const size = sizeWords({
    files: read?.files.length,
    additions: read?.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: read?.files.reduce((sum, file) => sum + file.deletions, 0),
  });
  // A file missing from what HQ read lies past where its read stopped.
  const diffOf = (path: string): ReviewDiffState =>
    laterDiffs !== undefined
      ? laterDiffs.diffOf(path)
      : readout.kind === "read"
        ? { kind: "read", file: readout.value.diff.get(path), cut: readout.value.filesCut }
        : readout.kind === "failed"
          ? { kind: "failed", reason: readout.reason }
          : { kind: "reading" };
  const mine = mate.mine ? mate : undefined;
  const [questionClosed, setQuestionClosed] = useState(false);
  const answer = useReviewDeploys(press);
  const fix = model.verdict.fix;
  // Asked to close it: the button closes it, and the quiet word keeps it open.
  const asked =
    model.verdict.state === "close-confirm" ||
    model.verdict.state === "closing" ||
    model.verdict.state === "close-refused";
  // Merged or closed: nothing more to ask of it here.
  const over = model.verdict.state === "merged" || model.verdict.state === "closed";
  // Read from the release or roll back that lists it: merged already, and that is the next review.
  const fromRelease = props.back !== undefined;
  const primary = fromRelease ? undefined : model.primary;
  const secondary = model.secondary;
  const files = useReviewFold();
  const checks = useReviewFold();
  const talk = useReviewFold();
  // "Ask Nova to change it…" opens the conversation and puts the cursor in its box.
  const talkAt = useRef<HTMLDivElement | null>(null);
  const [asking, setAsking] = useState(0);
  useEffect(() => {
    if (asking === 0) return;
    const box = talkAt.current?.querySelector("textarea");
    box?.focus({ preventScroll: true });
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [asking]);
  const canAsk = mine !== undefined && props.offers?.comment === true && !over && !fromRelease;
  const checksSaid = changeChecks({
    state: model.verdict.state,
    checks: model.pipeline?.checks ?? [],
  });
  const pipeline = model.pipeline;
  const receipt = changeReceipt({ receipt: pull.receipt, head: pull.headSha });
  const repo: GitRepoAt | undefined =
    props.appId === undefined ? undefined : { appId: props.appId, repo: pull.repository };
  const code = repo === undefined ? undefined : changeCode(pull);
  const filesAt = repo === undefined || code === undefined ? undefined : { ...repo, sha: code.sha };
  // Merging and merged say all of it on the line under the title: words under the line would come
  // in at the press and push the body down under the person's eye (a run 2 follow-up). Merging's
  // own words only restate its title.
  const onLine = model.verdict.state === "merging" || model.verdict.state === "merged";
  const question = model.question === undefined || questionClosed ? undefined : model.question;
  // A Mate's several changes in one repository read apart by their branches.
  const branch = reviewBranch(pull);
  const others = props.others ?? NO_OTHERS;
  return (
    <ZeropsReviewSurface
      ask={
        canAsk
          ? {
              label: `Ask ${mine.name} to change it…`,
              onPress: () => {
                talk.show();
                setAsking((count) => count + 1);
              },
            }
          : undefined
      }
      back={props.back}
      answers={
        question === undefined ? undefined : (
          <ReviewQuestionAnswers
            onAnswer={(tier) => {
              props.onAddEnvironment?.(tier);
            }}
            onDismiss={() => {
              setQuestionClosed(true);
            }}
            question={question}
          />
        )
      }
      consequence={
        question !== undefined
          ? [question.text, ...question.options.map((option) => option.hint)].join(" ")
          : !over && !asked && props.offers?.merge === false && props.offers.why.merge !== undefined
            ? props.offers.why.merge
            : mergeFoot({
                state: model.verdict.state,
                consequence: model.consequence,
                stage: props.stage,
                live: props.live,
                warning: receipt?.warning,
              })
      }
      dismiss={over && !fromRelease ? "Close" : undefined}
      face={mate.tint === undefined ? undefined : { tint: mate.tint, shape: mate.shape }}
      frame={props.frame}
      fix={
        fix === undefined || mine === undefined
          ? undefined
          : {
              label: `Ask ${mine.name} to ${fix.verb}`,
              onPress: () => {
                props.onFix(fix.problem);
              },
            }
      }
      kind={KIND}
      kindLabel={props.project === undefined ? mate.name : `${mate.name} · ${props.project}`}
      meta={
        <span>
          #{pull.number}
          {branch === undefined ? null : ` · ${branch}`}
        </span>
      }
      elsewhere={
        pull.pullRequest === undefined ? undefined : (
          <InlineButton
            data-zerops-surface="change-pull-request"
            render={<a href={pull.pullRequest.url} rel="noreferrer" target="_blank" />}
          >
            {pullRequestLinkWords(pull.pullRequest)}
            <ArrowUpRightIcon aria-hidden="true" className="ms-0.5 inline size-3" />
          </InlineButton>
        )
      }
      code={
        repo === undefined || code === undefined ? undefined : (
          <GitBrowserLink
            to={
              code.view === "commit" ? gitCommitLink(repo, code.sha) : gitCodeLink(repo, code.sha)
            }
          >
            {code.words}
          </GitBrowserLink>
        )
      }
      onOpenPage={props.onOpenPage}
      onClose={props.onClose}
      primary={
        primary === undefined
          ? undefined
          : {
              ...primary,
              busy: model.verdict.state === "merging" || model.verdict.state === "closing",
              label:
                model.verdict.state === "merging"
                  ? "Merging"
                  : model.verdict.state === "closing"
                    ? "Closing"
                    : primary.label,
              // A change on GitHub merges there (squash), and HQ takes the merge from it.
              text:
                primary.label !== "Merge"
                  ? undefined
                  : pull.pullRequest?.state === "open"
                    ? "Merge on GitHub"
                    : props.stage !== undefined
                      ? `Merge to ${props.stage}`
                      : undefined,
              onPress: () => {
                if (asked) props.onClosing("press");
                else props.onMerge();
              },
            }
      }
      secondary={
        secondary === undefined
          ? undefined
          : {
              ...secondary,
              onPress: () => {
                props.onClosing(asked ? "keep" : "ask");
              },
            }
      }
      settled={fromRelease ? "Merged" : undefined}
      status={
        checksSaid !== undefined ? (
          <span className="rv-checks" data-mark={checksSaid.mark}>
            {checksSaid.mark === "passed" ? <CheckIcon aria-hidden="true" /> : null}
            {checksSaid.words}
          </span>
        ) : model.verdict.state === "merged" ? (
          <span>{model.verdict.why}</span>
        ) : undefined
      }
      title={pull.title}
      titleId={props.titleId}
      verdict={model.verdict}
      whySaid={!onLine && whySaid(model.verdict, pull.ready === false)}
    >
      {others.length === 0 ? null : (
        <p className="rv-words" data-zerops-surface="change-others">
          Other open changes in {pull.repository}:{" "}
          {others.map((other, index) => (
            <Fragment key={other.number}>
              {index === 0 ? null : ", "}
              <InlineButton
                onClick={() => {
                  props.onOpenChange?.(other.number);
                }}
                title={other.title}
              >
                #{other.number}
              </InlineButton>
            </Fragment>
          ))}
        </p>
      )}
      {model.orphan === undefined ? null : (
        <ReviewSection title="Its Mate is gone">
          <p className="rv-words">{model.orphan.text}</p>
          {model.orphan.options.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-2">
              {model.orphan.options.map((option) => (
                <Button
                  disabled={!option.enabled}
                  key={option.projectId}
                  onClick={() => {
                    props.onHand?.(option.projectId);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
        </ReviewSection>
      )}
      {answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere answer={answer} />
        </ReviewSection>
      )}
      <ReviewDescription
        code={filesAt}
        description={pull.description}
        hqAddress={props.hqAddress}
        onOpenRun={props.onOpenRun}
        pictures={props.pictures}
        run={props.run}
      />
      {props.previews === undefined || props.previews.length === 0 ? null : (
        <ReviewTry previews={props.previews} />
      )}
      {receipt === undefined ? null : (
        <ReviewSection aside={String(receipt.parts.length)} title="Parts">
          <ul className="rv-check-list">
            {receipt.parts.map((part) => (
              <li key={part.setup}>
                {part.setup} · {part.preview} · {part.words}
              </li>
            ))}
          </ul>
        </ReviewSection>
      )}
      <ReviewSection
        aside={
          size === undefined ? undefined : (
            <>
              {read?.files.length} changed ·{" "}
              <ReviewSize additions={size.additions} deletions={size.deletions} />
            </>
          )
        }
        fold={files}
        title="Files"
      >
        <ReviewFiles
          diffOf={diffOf}
          fileAt={
            filesAt === undefined ? undefined : (path) => gitFileLink(filesAt, filesAt.sha, path)
          }
          failed={readout.kind === "failed" ? readout.reason : undefined}
          files={read?.files}
          initiallyOpen={props.initiallyOpen}
          notRecorded={
            read !== undefined && !read.filesKnown ? { onShow: props.showFiles } : undefined
          }
          onOpen={laterDiffs?.ask ?? props.readDiffs}
          onRetry={props.onRetry}
        />
      </ReviewSection>
      {pipeline === undefined ||
      (pipeline.checks.length === 0 && pipeline.why === undefined) ? null : (
        <ReviewSection
          aside={pipeline.checks.length === 0 ? undefined : String(pipeline.checks.length)}
          fold={checks}
          title="Checks"
        >
          {pipeline.why === undefined ? null : <p className="rv-words">{pipeline.why}</p>}
          {pipeline.checks.length === 0 ? null : (
            <ul className="rv-check-list">
              {pipeline.checks.map((check) => (
                <li key={check.id}>
                  {check.name} ·{" "}
                  {check.requirement === "required"
                    ? "Required by repository"
                    : check.requirement === "advisory"
                      ? "Advisory"
                      : "Requirement unknown"}{" "}
                  ·{" "}
                  {check.state === "passed"
                    ? "Passed"
                    : check.state === "failed"
                      ? "Failed"
                      : check.state === "running"
                        ? "Running"
                        : "Status unknown"}
                </li>
              ))}
            </ul>
          )}
        </ReviewSection>
      )}
      <div className="contents" ref={talkAt}>
        <ReviewConversation
          asker={
            mine === undefined ? undefined : { name: mine.name, tint: mine.tint, shape: mine.shape }
          }
          commentable={props.offers?.comment === true}
          comments={props.comments}
          count={pull.commentCount}
          draftKey={`${pull.url ?? pull.repository}#${String(pull.number)}`}
          fold={props.frame === "page" ? undefined : talk}
          frame={props.frame ?? "dialog"}
          now={props.now}
          onAsk={props.onAsk}
          remarks={props.remarks}
        />
      </div>
      <ReviewCommits
        at={repo}
        commits={commits}
        cut={read?.commitsCut === true}
        notRecorded={
          read !== undefined && !read.commitsKnown && props.commits === undefined
            ? { onShow: props.showCommits }
            : undefined
        }
        fold={props.frame === "page" ? undefined : history}
        now={props.now}
        onRetry={props.onRetry}
      />
    </ZeropsReviewSurface>
  );
}

/**
 * The one question after an application's first merge: where the code should run, with an equal
 * button for each environment the person may add, and *Not now*, which only closes it — the
 * application's page keeps the slots. Its buttons stand in the foot's, its words in its line.
 */
function ReviewQuestionAnswers({
  question,
  onAnswer,
  onDismiss,
}: {
  readonly question: ReviewQuestion;
  readonly onAnswer: (tier: GroupEnvironmentTier) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <span aria-label={question.text} className="contents" role="group">
      {question.options.map((option) => (
        <Button
          key={option.tier}
          onClick={() => {
            onAnswer(option.tier);
          }}
          variant="secondary"
        >
          {option.label}
        </Button>
      ))}
      <Button onClick={onDismiss} variant="ghost">
        {question.dismiss}
      </Button>
    </span>
  );
}
