/**
 * A crew task's review: the same surface, with *Add to Fen's code* as its button (R7).
 *
 * What the crewmate reported, what the task asked, how its check went, and what adding it does —
 * one commit in the Mate's code, nothing shipped until the Mate ships it. A clash or a failing
 * check is the crewmate's to fix, and the verdict hands it over with the crew's own ask.
 *
 * `CrewTaskReviewView` takes every read handed in, so the harness shows each state. A viewer
 * who may not run the task's crewmate (D6) reads it all, and its foot says why nothing is
 * offered — no *Add to Fen's code*, no ask to fix.
 */
import { crewTaskReview, type ReviewPress } from "@t3tools/client-runtime/zerops";
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewLockWords } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCommand, CrewTask, EnvironmentId } from "@t3tools/contracts";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { useState } from "react";

import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";
import type { ReviewTarget } from "~/zerops/review";
import { useZeropsMate } from "~/zerops/useZeropsMates";

import { crewmateFace } from "../crew/CrewLeadPlan.logic";
import { MateFace, StatusDot } from "../primitives";
import { crewLandCommand, reviewKindLine } from "./ZeropsReview.logic";
import { ReviewSection, ReviewSize, ZeropsReviewSurface } from "./ZeropsReviewSurface";

const KIND = "crew-task" as const;

/** What a check's state reads as beside its dot. */
const CHECK_WORD = { passed: "Passed", failed: "Failed", running: "Running" } as const;
const CHECK_TONE = { passed: "ok", failed: "failed", running: "busy" } as const;

export function ZeropsCrewTaskReview({
  target,
  titleId,
  onClose,
}: {
  readonly target: Extract<ReviewTarget, { readonly kind: "crew-task" }>;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  const { snapshot, view } = useCrew(target.environmentId);
  const access = useCrewAccess(target.environmentId, snapshot);
  const mate = useZeropsMate(target.environmentId);
  const row = view?.tasks.find((candidate) => candidate.task.id === target.taskId);
  if (snapshot === null || view === null || row === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing goes in from here until the crew is read."
        kind={KIND}
        kindLabel={reviewKindLine(KIND)}
        onClose={onClose}
        title="Crew task"
        titleId={titleId}
        verdict={{
          state: "landing",
          tone: "busy",
          title: "Reading the crew",
          why: "Its board and what each crewmate is on",
          fix: undefined,
        }}
      />
    );
  }
  const { task, owner } = row;
  const paths = snapshot.attention
    .filter((entry) => entry.kind === "conflict" && entry.taskId === task.id)
    .flatMap((entry) => entry.paths);
  const laneConflicts =
    owner?.crewmate.openTaskId === task.id && owner.crewmate.lane?.state === "conflicts";
  return (
    <CrewTaskData
      conflicts={paths.length > 0 ? paths : laneConflicts ? ["the files it changed"] : []}
      environmentId={target.environmentId}
      face={crewmateFace(task.owner, owner)}
      // What adds the work or hands it back reaches its crewmate's login.
      lock={access.reach({ kind: "tasks", taskIds: [task.id] })}
      mateName={mate.kind === "mate" ? mate.mate.name : "the Mate"}
      onClose={onClose}
      task={task}
      titleId={titleId}
    />
  );
}

/** Where the review's own presses are placed, so their refusal reads back here. */
const REVIEW_ORIGIN = "review";

function CrewTaskData({
  environmentId,
  ...props
}: Omit<CrewTaskReviewViewProps, "press" | "pressedAt" | "onLand" | "onAsk"> & {
  readonly environmentId: EnvironmentId;
}) {
  const crewCommand = useCrewCommand(environmentId);
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The task's state when Land was pressed: the engine answers before the snapshot moves.
  const [pressedAt, setPressedAt] = useState<string | undefined>(undefined);
  // A refusal's sentence is the engine's own, and shows once its answer has been read.
  const refusal = crewCommand.errorAt(REVIEW_ORIGIN);
  if (press.kind === "refused" && press.reason.length === 0 && refusal !== null) {
    setPress({ kind: "refused", reason: refusal });
  }
  const land = async () => {
    setPressedAt(props.task.state);
    setPress({ kind: "running" });
    const result = await crewCommand.send(crewLandCommand(props.task), REVIEW_ORIGIN);
    setPress(result === null ? { kind: "refused", reason: "" } : { kind: "done" });
  };
  return (
    <CrewTaskReviewView
      {...props}
      onAsk={(command) => {
        void crewCommand.send(command, REVIEW_ORIGIN).then((result) => {
          if (result !== null) props.onClose();
        });
      }}
      onLand={() => {
        void land();
      }}
      press={
        press.kind === "refused" && press.reason.length === 0
          ? { kind: "refused", reason: "The crew didn't add it." }
          : press
      }
      pressedAt={pressedAt}
    />
  );
}

export interface CrewTaskReviewViewProps {
  readonly task: CrewTask;
  /** The crewmate whose work it is. */
  readonly face: {
    readonly name: string;
    readonly tint: MateTintId | null;
    readonly face: MateMarkState;
  };
  /** The paths its copy conflicts on. */
  readonly conflicts: ReadonlyArray<string>;
  /** The Mate whose code the work goes into. */
  readonly mateName: string;
  readonly press: ReviewPress;
  /** The task's state when *Add to Fen's code* was pressed. */
  readonly pressedAt?: string | undefined;
  /** The task's crewmate is not this viewer's to run (D6): nothing is offered, and the foot says why. */
  readonly lock?: CrewLock | null;
  readonly titleId?: string | undefined;
  readonly onLand: () => void;
  /** Hands the conflict or the failed check back to the crewmate. */
  readonly onAsk: (command: CrewCommand) => void;
  readonly onClose: () => void;
}

export function CrewTaskReviewView(props: CrewTaskReviewViewProps) {
  const { task, face, press } = props;
  const model = crewTaskReview({
    ownerName: face.name,
    mateName: props.mateName,
    state: task.state,
    check: task.check,
    diffStat: task.diffStat,
    conflicts: props.conflicts,
    waitingOn: task.waitingOn,
    landedCommit: task.landedCommit,
    reason: task.reason,
    press,
    pressedAt: props.pressedAt,
  });
  const lock = props.lock ?? null;
  const fix = lock === null ? model.verdict.fix : undefined;
  const primary = lock === null ? model.primary : undefined;
  // Work that went in offers nothing to anybody: its foot says so in its own words.
  const withheld =
    lock !== null && (model.primary !== undefined || model.verdict.fix !== undefined);
  const ask: CrewCommand | undefined =
    fix === undefined
      ? undefined
      : model.verdict.state === "land-conflict"
        ? { _tag: "askResolve", taskId: task.id }
        : { _tag: "askFix", taskId: task.id };
  return (
    <ZeropsReviewSurface
      consequence={withheld ? crewLockWords(lock.ownership) : model.consequence}
      dismiss={primary === undefined ? "Close" : "Cancel"}
      fix={
        fix === undefined || ask === undefined
          ? undefined
          : {
              label: `Ask ${face.name} to ${fix.verb}`,
              onPress: () => {
                props.onAsk(ask);
              },
            }
      }
      kind={KIND}
      kindLabel={reviewKindLine(KIND)}
      meta={
        <>
          <span className="inline-flex items-center gap-1.5">
            {face.tint === null ? null : (
              <MateFace className="size-4" size="dot" state={face.face} tint={face.tint} />
            )}
            {face.name}
          </span>
          {task.diffStat === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <ReviewSize
                additions={`+${String(task.diffStat.insertions)}`}
                deletions={`−${String(task.diffStat.deletions)}`}
              />
            </>
          )}
        </>
      }
      onClose={props.onClose}
      primary={
        primary === undefined
          ? undefined
          : {
              ...primary,
              busy: press.kind === "running",
              label: primary.label,
              onPress: props.onLand,
            }
      }
      title={task.title}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      {task.report === null || task.report.trim().length === 0 ? null : (
        <ReviewSection title="What it did">
          <p className="rv-words">{task.report.trim()}</p>
        </ReviewSection>
      )}
      <ReviewSection title="The task">
        <p className="rv-words">{task.brief}</p>
        {task.doneWhen.length === 0 ? null : (
          <p className="rv-words text-muted-foreground">Done when: {task.doneWhen}</p>
        )}
      </ReviewSection>
      {task.check === null ? null : (
        <ReviewSection title="Check">
          <StatusDot
            label={CHECK_WORD[task.check.state]}
            sentence
            tone={CHECK_TONE[task.check.state]}
          />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}
