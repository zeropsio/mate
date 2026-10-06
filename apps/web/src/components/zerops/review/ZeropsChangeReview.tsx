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
 * Merge the review stays: it says what happened, and where production waits for a code change,
 * its button opens the release's review in place. A recipe change is never released: its review
 * says, from the files it changed, what its merge does to the environments made from it.
 *
 * `ChangeReviewView` is the picture with every read handed in, so the harness shows each state.
 */
import {
  changeAskPrompt,
  changeRemarks,
  changeReview,
  historyAge,
  recipeReach,
  releaseContentsCommits,
  waitingForProduction,
  type ChangeReadout,
  type ChangeReviewInput,
  type ReviewClose,
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
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import {
  useZeropsProjectFlowOptional,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import { useAddEnvironment, useEnvironmentQuestionFacts } from "~/zerops/useAddEnvironment";
import { type ZeropsChangeOffers, useChangeOffers } from "~/zerops/useChangeOffers";
import {
  mergedMain,
  useZeropsChangeDetail,
  type ReadoutPart,
} from "~/zerops/useZeropsChangeDetail";
import {
  useZeropsChangeComments,
  type ZeropsChangeComments,
} from "~/zerops/useZeropsChangeComments";
import { useZeropsChangeRun } from "~/zerops/useZeropsChangeRun";
import { useHqPictureSource, type ChangePictureSource } from "~/zerops/useChangePicture";
import { useZeropsLandedChange } from "~/zerops/useZeropsLandedChange";
import { useNowMs } from "~/zerops/useNowMs";
import { useFixMates } from "~/zerops/fixMates";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";
import { useZeropsMemberNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { MateFace } from "../primitives";
import { answeredDeploys } from "../ZeropsDeployAnswer";
import {
  changeReadVerdict,
  reviewKindLine,
  sizeWords,
  type ReviewFrame,
  type ReviewKind,
} from "./ZeropsReview.logic";
import { ReviewCommits } from "./ReviewCommits";
import { ReviewConversation } from "./ReviewConversation";
import { ReviewDescription } from "./ReviewDescription";
import {
  ReviewFiles,
  ReviewSection,
  ReviewWhere,
  ReviewSize,
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
  const router = useRouter();
  const flowValue = useZeropsProjectFlowOptional();
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
  const flow = flowValue?.flows.get(target.groupId);
  const matches = (pull: FlowPullRequest) =>
    pull.repository === target.repository && pull.number === target.number;
  const open = flow?.pullRequests.find(matches);
  const merged = flow?.merged.find(matches);
  // A change the flow does not hold — landed before the flow was read, or a flow not read yet —
  // is read on its own.
  const landed = useZeropsLandedChange(
    open !== undefined || merged !== undefined
      ? null
      : { appId: target.groupId, repo: target.repository, number: target.number },
  );
  const current = open ?? merged ?? (landed.kind === "read" ? landed.pull : undefined);
  // A change just merged leaves the open ones a read before the landed ones have it: the review
  // keeps the change it was showing.
  const [held, setHeld] = useState(current);
  if (current !== undefined && current !== held) setHeld(current);
  const pull = current ?? held;

  if (flowValue === null || pull === undefined) {
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
          landed.readAgain === undefined
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
          read: landed.kind === "read" ? { kind: "reading" } : landed,
          provided: flowValue !== null,
          failure: flowValue?.readFailure,
          projectKnown:
            flowValue?.groupsRead === true ? flowValue.knownGroups?.has(target.groupId) : undefined,
        })}
      />
    );
  }
  return (
    <ChangeReviewData
      reviewOffers={reviewOffers}
      flow={flow}
      flowValue={flowValue}
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
  flowValue,
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
  /** The account's flow, which holds this one. */
  readonly flowValue: ZeropsProjectFlowValue;
  readonly frame: ReviewFrame;
  readonly onOpenPage: (() => void) | undefined;
  readonly back: ReviewButton | undefined;
  readonly pull: FlowPullRequest;
  readonly target: ChangeTarget;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const now = useNowMs();
  const askMate = useAskMate();
  const askMateToFix = useAskMateToFix();
  const mates = useZeropsReviewMates(target.groupId);
  const pictures = useHqPictureSource();
  const addEnvironment = useAddEnvironment();
  const question = useEnvironmentQuestionFacts(target.groupId, flow);
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  const [closing, setClosing] = useState<ReviewClose>({ kind: "idle" });
  const change = { repository: pull.repository, number: pull.number };
  const merge = async () => {
    setPress({ kind: "running" });
    // The head the review shows: its files were read for it, and one pushed since HQ refuses.
    const outcome = await flowValue.merge(target.groupId, change, pull.headSha);
    setPress(
      outcome.ok
        ? { kind: "done", deploys: outcome.deploys }
        : { kind: "refused", reason: outcome.reason },
    );
  };
  const close = async () => {
    setClosing({ kind: "running" });
    const outcome = await flowValue.close(target.groupId, change);
    setClosing(outcome.ok ? { kind: "done" } : { kind: "refused", reason: outcome.reason });
  };

  const mate = mates.get(pull.mateProjectId);
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
  const run = useZeropsChangeRun({
    mateProjectId: pull.mateProjectId,
    appId: target.groupId,
    repository: pull.repository,
    number: pull.number,
  });
  const comments = useZeropsChangeComments({
    appId: target.groupId,
    repo: pull.repository,
    number: pull.number,
  });
  // Who said it, as the organization's members name them; the reader's own words marked.
  const session = useZeropsSessionOptional();
  const nameOf = useZeropsMemberNames({
    clientId: session?.activeOrganization?.id,
    enabled: comments.state.kind === "read" && comments.state.comments.length > 0,
  });
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

  return (
    <ChangeReviewView
      environments={flow?.environmentInputs ?? NO_ENVIRONMENTS}
      productionHeld={question.productionHeld}
      addable={question.addable}
      onAddEnvironment={(tier) => {
        addEnvironment(target.groupId, tier);
        onClose();
      }}
      frame={frame}
      hqAddress={flowValue.hqAddress}
      back={back}
      onOpenPage={onOpenPage}
      live={flow?.releases.find((entry) => entry.standing === "live")?.tag}
      release={flow?.release.gate}
      mate={
        mate === undefined
          ? {
              name: flowValue.mateNames.get(pull.mateProjectId) ?? "the Mate",
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
        askMate(
          pull.mateProjectId,
          changeAskPrompt({
            number: pull.number,
            repository: pull.repository,
            title: pull.title,
            said,
          }),
        );
        if (refusal === null) onClose();
      }}
      onClose={onClose}
      onRetry={detail.retry}
      onFix={(problem) => {
        askMateToFix(pull.mateProjectId, problem);
        onClose();
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
      waitingForProduction={
        flow === undefined
          ? 0
          : flow.releasesKnown
            ? waitingForProduction({
                listed: releaseContentsCommits(flow.release.contents),
                change: pull,
                liveSince: flow.releases.find((entry) => entry.standing === "live")?.taggedAt,
              })
            : releaseContentsCommits(flow.release.contents).length
      }
    />
  );
}

/** No environments known: the project's flow is not read yet. */
const NO_ENVIRONMENTS: ReadonlyArray<{ readonly tier: GroupEnvironmentTier }> = [];

/** Nothing said: the state before the conversation is read. */
const NO_REMARKS: ReadonlyArray<ChangeRemark> = [];

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
  readonly comments: ZeropsChangeComments;
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
  /** How many changes wait for production, as the flow last read it. */
  readonly waitingForProduction: number;
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
  readonly now: number;
  readonly titleId?: string | undefined;
  /** Files whose diff stands open from the start — the harness's. */
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
  readonly onFix: (problem: FixProblem) => void;
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
    commits: read?.commits.length,
    conflict:
      read === undefined || read.mergeability !== "conflicting"
        ? undefined
        : { files: read.conflict, by: undefined },
    downstream,
    productionHeld: props.productionHeld,
    addable: props.addable,
    waiting: {
      // Until HQ's stream brings it merged, the change just merged is not among what waits yet.
      count:
        press.kind === "done" && !pull.merged
          ? props.waitingForProduction + 1
          : props.waitingForProduction,
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
    now: props.now,
  });
  const size = sizeWords({
    files: read?.files.length,
    additions: read?.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: read?.files.reduce((sum, file) => sum + file.deletions, 0),
  });
  // A file missing from what HQ read lies past where its read stopped.
  const diffOf = (path: string): ReviewDiffState =>
    readout.kind === "read"
      ? { kind: "read", file: readout.value.diff.get(path), cut: readout.value.filesCut }
      : readout.kind === "failed"
        ? { kind: "failed", reason: readout.reason }
        : { kind: "reading" };
  const commits: ReadoutPart<ReadonlyArray<ChangeReadoutCommit>> =
    readout.kind === "read" ? { kind: "read", value: readout.value.commits } : readout;
  const mine = mate.mine ? mate : undefined;
  const [questionClosed, setQuestionClosed] = useState(false);
  const answer = answeredDeploys(press);
  const fix = model.verdict.fix;
  // Asked to close it: the button closes it, and the quiet word keeps it open.
  const asked =
    closing.kind === "asked" || closing.kind === "running" || closing.kind === "refused";
  // Merged or closed: nothing more to ask of it here.
  const over = model.verdict.state === "merged" || model.verdict.state === "closed";
  // Read from the release or roll back that lists it: merged already, and that is the next review.
  const fromRelease = props.back !== undefined;
  const primary = fromRelease ? undefined : model.primary;
  const secondary = model.secondary;
  return (
    <ZeropsReviewSurface
      back={props.back}
      consequence={
        props.offers?.merge === false && props.offers.why.merge !== undefined
          ? props.offers.why.merge
          : model.consequence
      }
      dismiss={over && !fromRelease ? "Close" : undefined}
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
      kindLabel={reviewKindLine(KIND, pull.kind)}
      meta={
        <ChangeMeta
          age={historyAge(pull.updatedAt, props.now)}
          base={pull.baseBranch}
          face={mate.tint}
          faceShape={mate.shape}
          number={pull.number}
          repository={pull.repository}
          who={mate.name}
        />
      }
      onOpenPage={props.onOpenPage}
      onClose={props.onClose}
      primary={
        primary === undefined
          ? undefined
          : {
              ...primary,
              busy: press.kind === "running" || closing.kind === "running",
              label:
                press.kind === "running"
                  ? "Merging"
                  : closing.kind === "running"
                    ? "Closing"
                    : primary.label,
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
      title={pull.title}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      {model.question === undefined || questionClosed ? null : (
        <ReviewQuestionBlock
          onAnswer={(tier) => {
            props.onAddEnvironment?.(tier);
          }}
          onDismiss={() => {
            setQuestionClosed(true);
          }}
          question={model.question}
        />
      )}
      {answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere answer={answer} />
        </ReviewSection>
      )}
      <ReviewDescription
        description={pull.description}
        hqAddress={props.hqAddress}
        onOpenRun={props.onOpenRun}
        pictures={props.pictures}
        run={props.run}
      />
      <ReviewSection
        aside={
          size === undefined ? undefined : (
            <>
              {size.files} · <ReviewSize additions={size.additions} deletions={size.deletions} />
            </>
          )
        }
        title="Changes"
      >
        <ReviewFiles
          diffOf={diffOf}
          failed={readout.kind === "failed" ? readout.reason : undefined}
          files={read?.files}
          initiallyOpen={props.initiallyOpen}
          onRetry={props.onRetry}
        />
      </ReviewSection>
      <ReviewConversation
        asker={
          mine === undefined ? undefined : { name: mine.name, tint: mine.tint, shape: mine.shape }
        }
        commentable={props.offers?.comment === true}
        comments={props.comments}
        count={pull.commentCount}
        draftKey={`${pull.url ?? pull.repository}#${String(pull.number)}`}
        frame={props.frame ?? "dialog"}
        now={props.now}
        onAsk={props.onAsk}
        remarks={props.remarks}
      />
      <ReviewCommits commits={commits} now={props.now} onRetry={props.onRetry} />
    </ZeropsReviewSurface>
  );
}

/**
 * The one question after an application's first merge: where the code should run, with an equal
 * button for each environment the person may add, and *Not now*, which only closes it — the
 * application's page keeps the slots.
 */
export function ReviewQuestionBlock({
  question,
  onAnswer,
  onDismiss,
}: {
  readonly question: ReviewQuestion;
  readonly onAnswer: (tier: GroupEnvironmentTier) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={question.text}>
      <p className="mr-2 text-sm text-foreground">{question.text}</p>
      {question.options.map((option) => (
        <Button
          key={option.tier}
          onClick={() => {
            onAnswer(option.tier);
          }}
          size="sm"
          variant="outline"
        >
          {option.label}
        </Button>
      ))}
      <button className="rv-textbtn" onClick={onDismiss} type="button">
        {question.dismiss}
      </button>
    </div>
  );
}

/**
 * The one line under a change's title: whose it is, where it goes, which it is and when it last
 * moved — `(face) Nova · appdev → main · #2 · 1d`. Its size is the Changes heading's.
 */
function ChangeMeta({
  who,
  face,
  faceShape,
  repository,
  base,
  number,
  age,
}: {
  readonly who: string;
  readonly face: MateTintId | undefined;
  readonly faceShape: MateShapeId | undefined;
  readonly repository: string;
  readonly base: string;
  readonly number: number;
  readonly age: string | undefined;
}) {
  const parts: Array<{ readonly key: string; readonly node: ReactNode }> = [
    {
      key: "who",
      node: (
        <span className="rv-meta-who">
          {face === undefined ? null : (
            <MateFace className="size-4" shape={faceShape} size="dot" state="idle" tint={face} />
          )}
          {who}
        </span>
      ),
    },
  ];
  parts.push({ key: "where", node: <span>{`${repository} → ${base}`}</span> });
  parts.push({ key: "number", node: <span>#{number}</span> });
  if (age !== undefined) parts.push({ key: "age", node: <span>{age}</span> });
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index === 0 ? null : <span aria-hidden="true">·</span>}
          {part.node}
        </Fragment>
      ))}
    </>
  );
}
