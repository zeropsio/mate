/**
 * A change's review: a pull request, read before it is merged (R2–R6).
 *
 * Its row comes from the flow the moment it opens, with the change's description; what the flow
 * does not carry is HQ's detail of it, read as it opens (`useZeropsChangeDetail`): its files with
 * their diffs, the commits it squashes, how it merges and whether `main` moved on under it. The run
 * that made it is its Mate's newest answer linking it: what it said stands in for a description
 * nobody wrote.
 *
 * It offers no Merge: a Mate's change merges in HQ (T8). Once merged it says what happened, and
 * where production waits for a code change, its button opens the release's review in place. A
 * recipe change is never released: its review says, from the files it changed, what its merge
 * does to the environments made from it.
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
  REVIEW_RELEASE_LABEL,
  type ChangeReadout,
  type ChangeReadoutCommit,
  type ChangeRemark,
  type FlowPullRequest,
  type GroupEnvironmentTier,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { buildThreadRouteParams } from "~/threadRoutes";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import {
  useZeropsProjectFlowOptional,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import { useChangeOffers } from "~/zerops/useChangeOffers";
import { useZeropsChangeDetail, type ReadoutPart } from "~/zerops/useZeropsChangeDetail";
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
  ReviewSize,
  ZeropsReviewSurface,
  type ReviewDiffState,
} from "./ZeropsReviewSurface";

const KIND: ReviewKind = "change";
/** The way back from a change read in its release. */
const RELEASE_BACK = "Release";
/** How long a change with no description holds the room of its run's words for them. */
const RUN_WORDS_WAIT_MS = 3_000;

type ChangeTarget = Extract<ReviewTarget, { readonly kind: "change" }>;

export function ZeropsChangeReview({
  frame = "dialog",
  target,
  titleId,
  onClose,
  onReplace,
  onBack,
}: {
  /** In a dialog over the conversation, or as the change's own page. */
  readonly frame?: ReviewFrame;
  readonly target: ChangeTarget;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  /**
   * Read from the release that carries it: already merged, it offers no button, and "← Release"
   * goes back.
   */
  readonly onBack?: (() => void) | undefined;
  /** Opens another review in this one's place — the release, once this merged. */
  readonly onReplace: (target: ReviewTarget) => void;
}) {
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
        back={onBack === undefined ? undefined : { label: RELEASE_BACK, onPress: onBack }}
        consequence="Nothing is merged from here until the change is read."
        frame={frame}
        kind={KIND}
        kindLabel={reviewKindLine(KIND)}
        onClose={onClose}
        onOpenPage={onOpenPage}
        title={`#${String(target.number)}`}
        titleId={titleId}
        verdict={changeReadVerdict({
          repository: target.repository,
          number: target.number,
          read: landed.kind === "read" ? { kind: "reading" } : landed,
          provided: flowValue !== null,
        })}
      />
    );
  }
  return (
    <ChangeReviewData
      flow={flow}
      flowValue={flowValue}
      frame={frame}
      onBack={onBack}
      onOpenPage={onOpenPage}
      onClose={onClose}
      onReplace={onReplace}
      pull={pull}
      target={target}
      titleId={titleId}
    />
  );
}

function ChangeReviewData({
  flow,
  flowValue,
  frame,
  onOpenPage,
  onBack,
  pull,
  target,
  titleId,
  onClose,
  onReplace,
}: {
  /** The project's flow; `undefined` while it waits its turn to be read. */
  readonly flow: ZeropsProjectFlow | undefined;
  /** The account's flow, which holds this one. */
  readonly flowValue: ZeropsProjectFlowValue;
  readonly frame: ReviewFrame;
  readonly onOpenPage: (() => void) | undefined;
  readonly onBack: (() => void) | undefined;
  readonly pull: FlowPullRequest;
  readonly target: ChangeTarget;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onReplace: (target: ReviewTarget) => void;
}) {
  const router = useRouter();
  const now = useNowMs();
  const askMate = useAskMate();
  const askMateToFix = useAskMateToFix();
  const mates = useZeropsReviewMates(target.groupId);
  const pictures = useHqPictureSource();
  const changeOffersOf = useChangeOffers();

  const mate = pull.mateProjectId === undefined ? undefined : mates.get(pull.mateProjectId);
  // Only the Mate that wrote it can push to its branch: the fix goes to it, if it is the
  // person's own (S6, the one rule `fixMates.ts` keeps for every surface).
  const fixers = useFixMates(
    pull.mateProjectId === undefined
      ? undefined
      : { projectId: pull.mateProjectId, groupId: target.groupId },
  );
  const mine = fixers.some((option) => option.mateProjectId === pull.mateProjectId);
  const detail = useZeropsChangeDetail({
    link: { appId: target.groupId, repo: pull.repository, number: pull.number },
    head: pull.headSha,
    // `main` moves only by HQ's merge, which lands a change: the newest one's commit says where.
    main: flow?.merged[0]?.mergeCommitSha,
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
  const remarks = useMemo(
    () =>
      comments.state.kind === "read"
        ? changeRemarks({ comments: comments.state.comments, nameOf, me })
        : NO_REMARKS,
    [comments.state, me, nameOf],
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
      frame={frame}
      hqAddress={flowValue.hqAddress}
      onBack={onBack}
      onOpenPage={onOpenPage}
      live={flow?.releases.find((entry) => entry.standing === "live")?.tag}
      mate={
        mate === undefined
          ? pull.mateProjectId === undefined
            ? undefined
            : {
                name: flowValue.mateNames.get(pull.mateProjectId) ?? "the Mate",
                tint: undefined,
                mine,
              }
          : { name: mate.name, tint: mate.tint, shape: mate.shape, mine }
      }
      now={now}
      comments={comments}
      remarks={remarks}
      commentable={changeOffersOf(target.groupId)?.comment === true}
      onAsk={async (said) => {
        // The change keeps the record of what was asked; the Mate gets the words to act on.
        const refusal = await comments.say(said);
        if (pull.mateProjectId === undefined) return;
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
        if (pull.mateProjectId === undefined) return;
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
      onReviewRelease={() => {
        onReplace({ kind: "release", groupId: target.groupId });
      }}
      pictures={pictures}
      pull={pull}
      readout={detail.readout}
      run={{ words: run.words, reading: run.reading && !runGaveUp }}
      titleId={titleId}
      waitingForProduction={
        flow === undefined ? 0 : releaseContentsCommits(flow.release.contents).length
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
  readonly mate:
    | {
        readonly name: string;
        readonly tint: MateTintId | undefined;
        readonly shape?: MateShapeId | undefined;
        readonly mine: boolean;
      }
    | undefined;
  /** HQ's detail of it: its files and diffs, its commits, how it merges. */
  readonly readout: ReadoutPart<ChangeReadout>;
  /** What was said on it, and the way to say something back. */
  readonly comments: ZeropsChangeComments;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  /** HQ's rule lets the person say something on it (`comment_change`): the box is offered. */
  readonly commentable: boolean;
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
  readonly onReviewRelease: () => void;
  /** The dialog's way to this review as the change's own page. */
  readonly onOpenPage?: (() => void) | undefined;
  /** Read from the release that carries it: "Merged" in the button's place, and the way back. */
  readonly onBack?: (() => void) | undefined;
  readonly onClose: () => void;
}

export function ChangeReviewView(props: ChangeReviewViewProps) {
  const { pull, readout, mate } = props;
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
    mateName: mate?.name,
    readout: readout.kind === "read" ? "read" : readout.kind === "failed" ? "failed" : "reading",
    commits: read?.commits.length,
    conflict:
      read === undefined || read.mergeability !== "conflicting"
        ? undefined
        : { files: read.conflict, by: undefined },
    downstream,
    waiting: { count: props.waitingForProduction, live: props.live },
    releaseOffered: downstream.production,
    recipe:
      pull.kind === "recipe" && read !== undefined
        ? recipeReach({
            files: read.files.map((file) => ({ filename: file.path })),
            environments: props.environments,
          })
        : undefined,
    offered: undefined,
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
  const mine = mate?.mine === true ? mate : undefined;
  const fix = model.verdict.fix;
  // Its one button is the release's review once it is merged; Merge is not offered here (T8).
  const next = model.primary?.label === REVIEW_RELEASE_LABEL;
  // Merged or closed: nothing more to ask of it here.
  const over = model.verdict.state === "merged" || model.verdict.state === "closed";
  // Read from its release: merged already, and the release is the next review.
  const fromRelease = props.onBack !== undefined;
  const primary = fromRelease || !next ? undefined : model.primary;
  return (
    <ZeropsReviewSurface
      back={props.onBack === undefined ? undefined : { label: RELEASE_BACK, onPress: props.onBack }}
      consequence={model.consequence}
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
          face={mate?.tint}
          faceShape={mate?.shape}
          number={pull.number}
          repository={pull.repository}
          who={mate?.name}
        />
      }
      onOpenPage={props.onOpenPage}
      onClose={props.onClose}
      primary={
        primary === undefined
          ? undefined
          : { ...primary, icon: "tag", onPress: props.onReviewRelease }
      }
      settled={fromRelease ? "Merged" : undefined}
      title={pull.title}
      titleId={props.titleId}
      verdict={model.verdict}
    >
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
        commentable={props.commentable}
        comments={props.comments}
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
  readonly who: string | undefined;
  readonly face: MateTintId | undefined;
  readonly faceShape: MateShapeId | undefined;
  readonly repository: string;
  readonly base: string;
  readonly number: number;
  readonly age: string | undefined;
}) {
  const parts: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (who !== undefined) {
    parts.push({
      key: "who",
      node: (
        <span className="rv-meta-who">
          {face === undefined ? null : (
            <MateFace className="size-4" shape={faceShape} size="dot" state="idle" tint={face} />
          )}
          {who}
        </span>
      ),
    });
  }
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
