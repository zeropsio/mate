/**
 * A change's review: a pull request, read before it is merged (R2–R6).
 *
 * The verdict and the button come from the flow the moment it opens — the flow already knows
 * whether the change merges and how its checks went, and carries the change's description — and
 * what the flow does not carry is read as it opens (`useZeropsChangeReadout`): its files, the
 * commits it squashes, and what `main` changed under it; its diff once a file is opened. The run
 * that made it is its Mate's newest answer linking it: what it said stands in for a description
 * nobody wrote.
 *
 * After Merge the review stays: it says what happened, and where production waits for a code
 * change, its button opens the release's review in place. A recipe change is never released: its
 * review says, from the files it changed, what its merge does to the environments made from it.
 *
 * `ChangeReviewView` is the picture with every read handed in, so the harness shows each state.
 */
import {
  changeAskPrompt,
  changeAuthorName,
  changeRemarks,
  changeReview,
  historyAge,
  recipeReach,
  releaseContentsCommits,
  REVIEW_RELEASE_LABEL,
  type ChangeRemark,
  type FlowPullRequest,
  type GiteaChangedFile,
  type GiteaCommit,
  type GroupEnvironmentTier,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { buildThreadRouteParams } from "~/threadRoutes";
import { giteaSessionLogin } from "~/zerops/accountGiteaSessions";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import {
  useZeropsProjectFlowOptional,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import {
  useZeropsChangeReadout,
  type ChangeDiffRead,
  type ReadoutPart,
} from "~/zerops/useZeropsChangeReadout";
import {
  useZeropsChangeComments,
  type ZeropsChangeComments,
} from "~/zerops/useZeropsChangeComments";
import { useZeropsChangeRun } from "~/zerops/useZeropsChangeRun";
import { useGiteaPictureSource, type GiteaPictureSource } from "~/zerops/useGiteaPicture";
import { useZeropsLandedChange } from "~/zerops/useZeropsLandedChange";
import { useNowMs } from "~/zerops/useNowMs";
import { useFixMates } from "~/zerops/fixMates";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";

import { MateFace } from "../primitives";
import {
  changeConflict,
  giteaFileUrl,
  reviewKindLine,
  sizeWords,
  type ReviewFrame,
  type ReviewKind,
} from "./ZeropsReview.logic";
import { ReviewCommits } from "./ReviewCommits";
import { ReviewConversation, type MateFaceOf } from "./ReviewConversation";
import { ReviewDescription } from "./ReviewDescription";
import {
  ReviewChecks,
  ReviewFiles,
  ReviewSection,
  ReviewSize,
  ZeropsReviewSurface,
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
  onReplace,
}: {
  /** In a dialog over the conversation, or as the change's own page. */
  readonly frame?: ReviewFrame;
  readonly target: ChangeTarget;
  readonly titleId: string;
  readonly onClose: () => void;
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
  // A change the flow no longer carries — landed before the flow was read — is read on its own.
  const landed = useZeropsLandedChange(
    flow === undefined || open !== undefined || merged !== undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: flow.slug,
          repository: target.repository,
          number: target.number,
        },
  );
  const current = open ?? merged ?? (landed.kind === "read" ? landed.pull : undefined);
  // A change just merged leaves the open ones a read before the landed ones have it: the review
  // keeps the change it was showing.
  const [held, setHeld] = useState(current);
  if (current !== undefined && current !== held) setHeld(current);
  const pull = current ?? held;

  if (flowValue === null || flow === undefined || pull === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing is merged from here until the change is read."
        frame={frame}
        kind={KIND}
        kindLabel={reviewKindLine(KIND)}
        onClose={onClose}
        onOpenPage={onOpenPage}
        title={`#${String(target.number)}`}
        titleId={titleId}
        verdict={{
          state: "checking",
          tone: landed.kind === "failed" || landed.kind === "gone" ? "attention" : "busy",
          title:
            landed.kind === "gone"
              ? `${target.repository} has no change #${String(target.number)}`
              : landed.kind === "failed"
                ? "This change could not be read"
                : "Reading this change",
          why:
            landed.kind === "failed"
              ? landed.reason
              : `${target.repository} #${String(target.number)}`,
          fix: undefined,
        }}
      />
    );
  }
  return (
    <ChangeReviewData
      flow={flow}
      flowValue={flowValue}
      frame={frame}
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
  pull,
  target,
  titleId,
  onClose,
  onReplace,
}: {
  readonly flow: ZeropsProjectFlow;
  /** The account's flow, which holds this one. */
  readonly flowValue: ZeropsProjectFlowValue;
  readonly frame: ReviewFrame;
  readonly onOpenPage: (() => void) | undefined;
  readonly pull: FlowPullRequest;
  readonly target: ChangeTarget;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onReplace: (target: ReviewTarget) => void;
}) {
  const router = useRouter();
  const now = useNowMs();
  const askMate = useAskMate();
  const askMateToFix = useAskMateToFix();
  const mates = useZeropsReviewMates(target.groupId);
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  const [diffWanted, setDiffWanted] = useState(false);
  const pictures = useGiteaPictureSource(flowValue.giteaOrigin);

  const mate = pull.mateProjectId === undefined ? undefined : mates.get(pull.mateProjectId);
  // Only the Mate that wrote it can push to its branch: the fix goes to it, if it is the
  // person's own (S6, the one rule `fixMates.ts` keeps for every surface).
  const fixers = useFixMates(
    pull.mateProjectId === undefined
      ? undefined
      : { projectId: pull.mateProjectId, groupId: target.groupId },
  );
  const mine = fixers.some((option) => option.mateProjectId === pull.mateProjectId);
  const readout = useZeropsChangeReadout({
    giteaOrigin: flowValue.giteaOrigin,
    owner: flow.slug,
    repository: pull.repository,
    number: pull.number,
    headSha: pull.headSha,
    baseBranch: pull.baseBranch,
    mergeBase: pull.mergeBase,
    baseSha: pull.baseSha,
    diff: diffWanted,
  });
  const run = useZeropsChangeRun({
    mateProjectId: pull.mateProjectId,
    owner: flow.slug,
    repository: pull.repository,
    number: pull.number,
  });
  const comments = useZeropsChangeComments({
    giteaOrigin: flowValue.giteaOrigin,
    owner: flow.slug,
    repo: pull.repository,
    number: pull.number,
  });
  const giteaOrigin = flowValue.giteaOrigin;
  const mateNames = flowValue.mateNames;
  const remarks = useMemo(
    () =>
      comments.state.kind === "read"
        ? changeRemarks({
            comments: comments.state.comments,
            mateNames,
            me: giteaOrigin === undefined ? undefined : giteaSessionLogin(giteaOrigin),
          })
        : NO_REMARKS,
    [comments.state, giteaOrigin, mateNames],
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
  const merge = async () => {
    setPress({ kind: "running" });
    // The head whose change was shown: one pushed since is Gitea's to refuse, never merged unseen.
    const outcome = await flowValue.mergePullRequest(flow.slug, { ...pull, headSha: readout.head });
    setPress(outcome.ok ? { kind: "done" } : { kind: "refused", reason: outcome.reason });
  };
  const runRef = run.threadRef;

  return (
    <ChangeReviewView
      environments={flow.environmentInputs}
      frame={frame}
      giteaOrigin={flowValue.giteaOrigin}
      onOpenPage={onOpenPage}
      live={flow.releases.find((entry) => entry.standing === "live")?.tag}
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
      mateFaces={mates}
      now={now}
      comments={comments}
      remarks={remarks}
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
      onRetry={readout.retry}
      onFix={(problem) => {
        if (pull.mateProjectId === undefined) return;
        askMateToFix(pull.mateProjectId, problem);
        onClose();
      }}
      onMerge={() => {
        void merge();
      }}
      onOpenFile={() => {
        setDiffWanted(true);
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
      press={press}
      pull={pull}
      readout={readout}
      run={{ words: run.words, reading: run.reading && !runGaveUp }}
      titleId={titleId}
      waitingForProduction={releaseContentsCommits(flow.release.contents).length}
    />
  );
}

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
  /** The project's Mates by project, so a remark a Mate made wears its face. */
  readonly mateFaces?: ReadonlyMap<string, MateFaceOf> | undefined;
  readonly readout: {
    readonly files: ReadoutPart<ReadonlyArray<GiteaChangedFile>>;
    readonly diff: ReadoutPart<ChangeDiffRead>;
    readonly commits: ReadoutPart<ReadonlyArray<GiteaCommit>>;
    readonly mainSince: ReadoutPart<ReadonlyArray<GiteaCommit>>;
  };
  /** What was said on it, and the way to say something back. */
  readonly comments: ZeropsChangeComments;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  readonly run: { readonly words: string | undefined; readonly reading: boolean };
  /** The account's Gitea, which its description's pictures and links are on. */
  readonly giteaOrigin: string | undefined;
  /** Where its description's pictures are read from, as the person. */
  readonly pictures: GiteaPictureSource | undefined;
  /**
   * The environments `environments.yaml` declares: where `main` goes next, and what a recipe
   * change's merge reaches.
   */
  readonly environments: ReadonlyArray<{ readonly tier: GroupEnvironmentTier }>;
  /** How many changes wait for production, as the flow last read it. */
  readonly waitingForProduction: number;
  /** The release production runs. */
  readonly live: string | undefined;
  readonly press: ReviewPress;
  readonly now: number;
  readonly titleId?: string | undefined;
  /** Files whose diff stands open from the start — the harness's. */
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
  readonly onMerge: () => void;
  /** A file was opened: its diff is wanted. */
  readonly onOpenFile?: (() => void) | undefined;
  readonly onFix: (problem: FixProblem) => void;
  /** Keeps the words on the change and hands them to its Mate, who changes the code. */
  readonly onAsk: (said: string) => Promise<void>;
  /** Reads again what could not be read. */
  readonly onRetry?: (() => void) | undefined;
  readonly onOpenRun: (() => void) | undefined;
  readonly onReviewRelease: () => void;
  /** The dialog's way to this review as the change's own page. */
  readonly onOpenPage?: (() => void) | undefined;
  readonly onClose: () => void;
}

export function ChangeReviewView(props: ChangeReviewViewProps) {
  const { pull, readout, press, mate } = props;
  const files = readout.files.kind === "read" ? readout.files.value : undefined;
  const mainSince = readout.mainSince.kind === "read" ? readout.mainSince.value : undefined;
  const downstream = {
    production: props.environments.some((entry) => entry.tier === "production"),
    stage: props.environments.some((entry) => entry.tier === "stage"),
  };
  const model = changeReview({
    pull,
    mateName: mate?.name,
    readout:
      readout.files.kind === "read"
        ? "read"
        : readout.files.kind === "failed"
          ? "failed"
          : "reading",
    commits: readout.commits.kind === "read" ? readout.commits.value.length : undefined,
    conflict: changeConflict({
      mergeability: pull.mergeability,
      files,
      mainSince,
      head: pull.baseSha,
    }),
    behindBy: mainSince?.length,
    downstream,
    waiting: {
      // Until the flow reads it again, the change just merged is not among what waits yet.
      count:
        press.kind === "done" && !pull.merged
          ? props.waitingForProduction + 1
          : props.waitingForProduction,
      live: props.live,
    },
    releaseOffered: downstream.production,
    recipe:
      pull.kind === "recipe" && files !== undefined
        ? recipeReach({ files, environments: props.environments })
        : undefined,
    press,
    now: props.now,
  });
  const size = sizeWords({
    files: pull.changedFiles ?? files?.length,
    additions: pull.additions ?? files?.reduce((sum, file) => sum + file.additions, 0),
    deletions: pull.deletions ?? files?.reduce((sum, file) => sum + file.deletions, 0),
  });
  const diffOf = (path: string): ReviewDiffState => {
    if (readout.diff.kind === "read") {
      return {
        kind: "read",
        file: readout.diff.value.files.get(path),
        cut: readout.diff.value.cut,
      };
    }
    if (readout.diff.kind === "failed") return { kind: "failed", reason: readout.diff.reason };
    return { kind: "reading" };
  };
  const checkRows = pull.checkRows ?? [];
  const mine = mate?.mine === true ? mate : undefined;
  const fix = model.verdict.fix;
  const next = model.primary?.label === REVIEW_RELEASE_LABEL;
  // Merged or closed: nothing more to ask of it here.
  const over = model.verdict.state === "merged" || model.verdict.state === "closed";
  return (
    <ZeropsReviewSurface
      consequence={model.consequence}
      dismiss={over ? "Close" : undefined}
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
          who={changeAuthorName(pull, mate?.name)}
        />
      }
      onOpenPage={props.onOpenPage}
      onClose={props.onClose}
      primary={
        model.primary === undefined
          ? undefined
          : {
              ...model.primary,
              busy: press.kind === "running",
              label: press.kind === "running" ? "Merging" : model.primary.label,
              icon: next ? "tag" : undefined,
              onPress: next ? props.onReviewRelease : props.onMerge,
            }
      }
      title={pull.title}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      <ReviewDescription
        description={pull.description}
        giteaOrigin={props.giteaOrigin}
        giteaPage={pull.url}
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
          failed={readout.files.kind === "failed" ? readout.files.reason : undefined}
          files={files?.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            previousPath: file.previousFilename,
          }))}
          giteaOf={(path) => giteaFileUrl(pull.url, path)}
          initiallyOpen={props.initiallyOpen}
          onOpen={props.onOpenFile}
          onRetry={props.onRetry}
          pending={pull.changedFiles ?? 1}
        />
      </ReviewSection>
      {checkRows.length === 0 ? null : (
        <ReviewSection title="Checks">
          <ReviewChecks rows={checkRows} />
        </ReviewSection>
      )}
      <ReviewConversation
        asker={
          mine === undefined ? undefined : { name: mine.name, tint: mine.tint, shape: mine.shape }
        }
        comments={props.comments}
        count={pull.commentCount}
        draftKey={`${pull.url ?? pull.repository}#${String(pull.number)}`}
        frame={props.frame ?? "dialog"}
        now={props.now}
        mateFaces={props.mateFaces}
        onAsk={props.onAsk}
        remarks={props.remarks}
      />
      <ReviewCommits commits={readout.commits} now={props.now} onRetry={props.onRetry} />
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
