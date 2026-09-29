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
 * After Merge the review stays: it says what happened, and where production waits, its button
 * opens the release's review in place.
 *
 * `ChangeReviewView` is the picture with every read handed in, so the harness shows each state.
 */
import {
  branchLabel,
  changeReview,
  releaseContentsCommits,
  type FlowPullRequest,
  type GiteaChangedFile,
  type GiteaCommit,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import type { MateTintId } from "@t3tools/shared/brand";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { buildThreadRouteParams } from "~/threadRoutes";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useZeropsProjectFlowOptional, type ZeropsProjectFlow } from "~/zerops/projectFlowContext";
import type { ReviewTarget } from "~/zerops/review";
import { useAskMate } from "~/zerops/useAskMate";
import {
  useZeropsChangeReadout,
  type ChangeDiffRead,
  type ReadoutPart,
} from "~/zerops/useZeropsChangeReadout";
import { useZeropsChangeRun } from "~/zerops/useZeropsChangeRun";
import { useGiteaPictureSource, type GiteaPictureSource } from "~/zerops/useGiteaPicture";
import { useZeropsLandedChange } from "~/zerops/useZeropsLandedChange";
import { useNowMs } from "~/zerops/useNowMs";
import { useFixMates } from "~/zerops/fixMates";
import { useZeropsReviewMates } from "~/zerops/useZeropsReviewMates";

import { MateFace } from "../primitives";
import {
  changeConflict,
  changeRequestPrefill,
  giteaFileUrl,
  reviewKindLine,
  sizeWords,
  type ReviewKind,
} from "./ZeropsReview.logic";
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
  target,
  titleId,
  onClose,
  onReplace,
}: {
  readonly target: ChangeTarget;
  readonly titleId: string;
  readonly onClose: () => void;
  /** Opens another review in this one's place — the release, once this merged. */
  readonly onReplace: (target: ReviewTarget) => void;
}) {
  const flowValue = useZeropsProjectFlowOptional();
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

  if (flow === undefined || pull === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing is merged from here until the change is read."
        kind={KIND}
        kindLabel={reviewKindLine(KIND)}
        onClose={onClose}
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
  pull,
  target,
  titleId,
  onClose,
  onReplace,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly pull: FlowPullRequest;
  readonly target: ChangeTarget;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onReplace: (target: ReviewTarget) => void;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const router = useRouter();
  const now = useNowMs();
  const askMate = useAskMate();
  const askMateToFix = useAskMateToFix();
  const mates = useZeropsReviewMates(target.groupId);
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  const [diffWanted, setDiffWanted] = useState(false);
  const pictures = useGiteaPictureSource(flowValue?.giteaOrigin);

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
    giteaOrigin: flowValue?.giteaOrigin,
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
    if (flowValue === null) return;
    setPress({ kind: "running" });
    // The head whose change was shown: one pushed since is Gitea's to refuse, never merged unseen.
    const outcome = await flowValue.mergePullRequest(flow.slug, { ...pull, headSha: readout.head });
    setPress(outcome.ok ? { kind: "done" } : { kind: "refused", reason: outcome.reason });
  };
  const runRef = run.threadRef;

  return (
    <ChangeReviewView
      downstream={{
        production: flow.environmentInputs.some((entry) => entry.tier === "production"),
        stage: flow.environmentInputs.some((entry) => entry.tier === "stage"),
      }}
      giteaOrigin={flowValue?.giteaOrigin}
      live={flow.releases.find((entry) => entry.standing === "live")?.tag}
      mate={
        mate === undefined
          ? pull.mateProjectId === undefined
            ? undefined
            : {
                name: flowValue?.mateNames.get(pull.mateProjectId) ?? "the Mate",
                tint: undefined,
                mine,
              }
          : { name: mate.name, tint: mate.tint, mine }
      }
      now={now}
      onAskChanges={() => {
        if (pull.mateProjectId === undefined) return;
        askMate(pull.mateProjectId, changeRequestPrefill(pull), { send: false });
        onClose();
      }}
      onClose={onClose}
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

export interface ChangeReviewViewProps {
  readonly pull: FlowPullRequest;
  /** The Mate that wrote it — its name, its colour, and whether it is the person's own. */
  readonly mate:
    | { readonly name: string; readonly tint: MateTintId | undefined; readonly mine: boolean }
    | undefined;
  readonly readout: {
    readonly files: ReadoutPart<ReadonlyArray<GiteaChangedFile>>;
    readonly diff: ReadoutPart<ChangeDiffRead>;
    readonly commits: ReadoutPart<ReadonlyArray<GiteaCommit>>;
    readonly mainSince: ReadoutPart<ReadonlyArray<GiteaCommit>>;
  };
  readonly run: { readonly words: string | undefined; readonly reading: boolean };
  /** The account's Gitea, which its description's pictures and links are on. */
  readonly giteaOrigin: string | undefined;
  /** Where its description's pictures are read from, as the person. */
  readonly pictures: GiteaPictureSource | undefined;
  readonly downstream: { readonly production: boolean; readonly stage: boolean };
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
  readonly onAskChanges: () => void;
  readonly onOpenRun: (() => void) | undefined;
  readonly onReviewRelease: () => void;
  readonly onClose: () => void;
}

export function ChangeReviewView(props: ChangeReviewViewProps) {
  const { pull, readout, press, mate } = props;
  const files = readout.files.kind === "read" ? readout.files.value : undefined;
  const mainSince = readout.mainSince.kind === "read" ? readout.mainSince.value : undefined;
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
    downstream: props.downstream,
    waiting: {
      // Until the flow reads it again, the change just merged is not among what waits yet.
      count:
        press.kind === "done" && !pull.merged
          ? props.waitingForProduction + 1
          : props.waitingForProduction,
      live: props.live,
    },
    releaseOffered: props.downstream.production,
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
  const branch =
    pull.headBranch === undefined ? undefined : branchLabel(pull.headBranch, mate?.name);
  const mine = mate?.mine === true ? mate : undefined;
  const fix = model.verdict.fix;
  const next = model.primary?.label === "Review release";
  // Merged or closed: nothing more to ask of it here.
  const over = model.verdict.state === "merged" || model.verdict.state === "closed";
  return (
    <ZeropsReviewSurface
      consequence={model.consequence}
      dismiss={over ? "Close" : undefined}
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
        <>
          <span>#{pull.number}</span>
          {mate === undefined ? (
            pull.author === undefined ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{pull.author}</span>
              </>
            )
          ) : (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                {mate.tint === undefined ? null : (
                  <MateFace className="size-4" size="dot" state="idle" tint={mate.tint} />
                )}
                {mate.name}
              </span>
            </>
          )}
          {size === undefined ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{size.files}</span>
              <ReviewSize additions={size.additions} deletions={size.deletions} />
            </>
          )}
          {branch === undefined ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>from {branch === pull.headBranch ? <code>{branch}</code> : branch}</span>
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
              busy: press.kind === "running",
              label: press.kind === "running" ? "Merging" : model.primary.label,
              icon: next ? "tag" : undefined,
              onPress: next ? props.onReviewRelease : props.onMerge,
            }
      }
      secondary={
        mine === undefined || over
          ? undefined
          : {
              label: `Ask ${mine.name} for changes`,
              ...(mine.tint === undefined ? {} : { face: { tint: mine.tint } }),
              onPress: props.onAskChanges,
            }
      }
      title={pull.title}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      <ReviewDescription
        description={pull.description}
        giteaOrigin={props.giteaOrigin}
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
        {readout.files.kind === "failed" ? (
          <p className="rv-words">{readout.files.reason}</p>
        ) : (
          <ReviewFiles
            diffOf={diffOf}
            giteaOf={(path) => giteaFileUrl(pull.url, path)}
            onOpen={props.onOpenFile}
            files={files?.map((file) => ({
              path: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              previousPath: file.previousFilename,
            }))}
            initiallyOpen={props.initiallyOpen}
            pending={pull.changedFiles ?? 1}
          />
        )}
      </ReviewSection>
      {checkRows.length === 0 ? null : (
        <ReviewSection title="Checks">
          <ReviewChecks rows={checkRows} />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}
