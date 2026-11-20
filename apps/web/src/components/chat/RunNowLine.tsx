import { ChevronDownIcon } from "lucide-react";
import {
  Fragment,
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import { HelperFace } from "./RunMarks";
import { keyedByOccurrence } from "./keyedByOccurrence";
import { RunShimmer } from "./RunShimmer";
import { TypingDots } from "./RunTypingDots";
import { MateFace } from "../zerops/primitives";
import { useChangedSinceShown } from "~/hooks/useChangedSinceShown";
import { type BrokeOff, type OutcomeModel } from "./conversation.logic";
import { Button } from "../ui/button";
import { restartWords } from "../../zerops/restartWords";
import { calmClockMs } from "./nowLineCalm.logic";
import { useCalmLine } from "./useCalmLine";
import { useRunEffort } from "./runResultFacts";
import { LimitContinue } from "./ConversationRows";
import { type RunStatus, type TurnHeaderActivity } from "./MessagesTimeline.logic";
import {
  formatClock,
  nowLineFace,
  nowLineOf,
  nowLineWords,
  pausedHeadWords,
  severalCallsWords,
  type NowLine as NowLineModel,
  cardHeadLine,
  thoughtOpening,
  underHeadWords,
  runClockMs,
} from "./runCard.logic";
import { useEngineLiveNow } from "./useEngineLiveMessage";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { operationNowWords, stepNowWords } from "~/zerops/runSteps/nowWords";
import { type WorkStep } from "~/zerops/runSteps/steps";
import { mateFailureWords } from "../../zerops/noticeWords";

// ---------------------------------------------------------------------------
// The now line
// ---------------------------------------------------------------------------

/**
 * The run's clock, m:ss, counting while the run goes on — the Mate's own
 * time: it stands still while a question waits on the person. Its text node
 * updates, the line never re-renders.
 */
function RunTicker({ status }: { readonly status: RunStatus }) {
  const ref = useRef<HTMLSpanElement>(null);
  // What it last showed: it never counts back (`calmClockMs`).
  const last = useRef<{ readonly run: string; readonly ms: number } | null>(null);
  const { startedAt, waitingSince, waitedMs, ran } = status;
  const elapsed = () => runClockMs(status, Date.now());
  const read = () => {
    const ms = calmClockMs(last.current, startedAt, elapsed());
    last.current = { run: startedAt, ms };
    return formatClock(ms);
  };
  // A steady clock: each second turns on the run's own second, however often
  // the card draws — a draw never restarts the count, so no second is ever
  // skipped or held twice.
  const paint = useEffectEvent((): number => {
    if (ref.current) ref.current.textContent = read();
    const into = elapsed() % 1000;
    return Number.isFinite(into) && into >= 0 ? into : 0;
  });
  useEffect(() => {
    if (waitingSince !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = setTimeout(tick, 1000 - paint() + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt, waitingSince, waitedMs, ran?.ms, ran?.since, ran?.personMs]);
  return (
    <span ref={ref} className="run-now-clock" data-work-line-clock>
      {read()}
    </span>
  );
}

/**
 * A step as the now line says it, sweeping while it runs: its own words and a
 * command's code after them, a command that said nothing of itself as its
 * code, a call said plainly with the names it took in mono.
 */
function StepNowWords({
  step,
  sweeps = true,
  codeAfter = true,
}: {
  readonly step: WorkStep;
  /** The one step on the line sweeps; a line each of several at once stands still. */
  readonly sweeps?: boolean;
  /** A command's first line after its words — not where its whole stands under them. */
  readonly codeAfter?: boolean;
}) {
  if (step.kind === "command" && step.words === null) {
    return (
      <RunShimmer className="run-now-verb run-now-mono" inline sweeps={sweeps}>
        {step.code}
      </RunShimmer>
    );
  }
  if (step.kind !== "command" && step.phrase !== null) {
    return (
      <RunShimmer className="run-now-verb" inline sweeps={sweeps}>
        {step.phrase.verb}
        {keyedByOccurrence(step.phrase.targets).map(({ key, value }, index, all) => (
          <Fragment key={key}>
            {index === 0 ? " " : index === all.length - 1 ? " and " : ", "}
            <span className="run-now-mono">{value}</span>
          </Fragment>
        ))}
        {step.phrase.more > 0 ? ` and ${step.phrase.more} more` : null}
      </RunShimmer>
    );
  }
  return (
    <>
      <RunShimmer className="run-now-verb" inline sweeps={sweeps}>
        {stepNowWords(step)}
      </RunShimmer>
      {codeAfter && step.kind === "command" && step.code !== null ? (
        <span className="run-now-code">{step.code}</span>
      ) : null}
    </>
  );
}

/** The now line's words, by what the run is doing. */
function NowWords({ line }: { readonly line: NowLineModel }) {
  switch (line.kind) {
    case "thinking":
      return (
        <>
          <span className="run-now-verb">Thinking</span>
          {line.thought === null ? null : <span className="run-now-thought">{line.thought}</span>}
        </>
      );
    case "step":
      return <StepNowWords step={line.step} />;
    case "operation":
      return (
        <>
          <RunShimmer className="run-now-verb" inline sweeps>
            {operationNowWords(line.operation)}
          </RunShimmer>
        </>
      );
    case "several":
      return <span className="run-now-verb">{severalCallsWords(line.calls)}</span>;
    case "waiting":
    case "stopping":
      return <span className="run-now-verb">{nowLineWords(line)}</span>;
    // Out of reach: what the notice says, held, never a sign of work going on.
    case "away":
      return <span className="run-now-verb">{line.words}</span>;
    // Waiting for the usage limit to reset: whose limit; the head's meta says when it goes on.
    case "paused":
      return <span className="run-now-verb">{nowLineWords(line)}</span>;
    case "after":
    case "starting":
      return (
        <>
          <span className="run-now-verb">{nowLineWords(line)}</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "writing":
      return (
        <>
          <span className="run-now-verb">Writing</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "condensing":
      return (
        <>
          <span className="run-now-verb">Condensing the context</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "working":
      return <span className="run-now-verb">Working</span>;
    // What it came to stands beside it, in its facts (`NowLine`).
    case "worked":
      return <span className="run-now-worked">{line.words}</span>;
  }
}

/** How long the words a line leaves take to go: their fade, and a frame to spare. */
const LINE_LEAVES_MS = 160;

/**
 * The words the now line just left, as it last drew them, while they fade
 * where they stood (`.run-now-leaving`); null once gone, and on a first paint.
 */
function useLeavingLine(
  line: NowLineModel,
  words: string,
): { readonly line: NowLineModel; readonly words: string } | null {
  const drawn = useRef({ line, words });
  const [swap, setSwap] = useState<{
    readonly words: string;
    readonly leaving: { readonly line: NowLineModel; readonly words: string } | null;
  }>({ words, leaving: null });
  if (swap.words !== words) setSwap({ words, leaving: drawn.current });
  useLayoutEffect(() => {
    drawn.current = { line, words };
  });
  const leaving = swap.leaving;
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(
      () => setSwap((current) => ({ ...current, leaving: null })),
      LINE_LEAVES_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

/**
 * The card's foot, the now line (K10): the Mate's face, what it is doing this
 * moment in words — the step itself while it runs, which lands in the chat
 * above once it ends — and the run's one clock (K3), in ink (S3). The
 * present stands in one place and only its words change, rising into it; the
 * past piles up above it. Once the run is over it is the worked line: who,
 * how long, and what the effort came to.
 */
export function NowLine({
  status,
  now: recordedNow,
  answering,
  outcome,
  end = null,
  settledHere = false,
  head,
}: {
  readonly status: RunStatus;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  /** What the run came to: its effort, on the worked line (`useRunEffort`). */
  readonly outcome: OutcomeModel | null;
  /**
   * The card's head (the owner, 2026-10-11): one line at the card's top in every state, the same
   * line live and settled with its words changed in place, and the whole of it the work's toggle.
   */
  readonly head?: {
    /** How many things the run's chat holds: said on the line while it works. */
    readonly steps: number;
    /** What woke a run nobody wrote to: the card's title, its line under it. */
    readonly title?: string;
    readonly toggle: {
      readonly open: boolean;
      readonly onToggle: () => void;
      /** The person is about to press it: what it opens is read. */
      readonly onIntent?: () => void;
    } | null;
  };
  /** Its right column: what the person can do with the run, and while it is live its clock. */
  readonly end?: ReactNode;
  /**
   * The person watched the run end here: its worked line takes the working
   * row's place rising into it, as the line's words change in place — never a
   * swap in one frame (run 11).
   */
  readonly settledHere?: boolean;
}) {
  const now = useEngineLiveNow(recordedNow);
  const ctx = use(TimelineRowCtx);
  const { isCompacting, isStopping } = use(TimelineRowActivityCtx);
  const worked = useRunEffort(outcome);
  const effort = worked.words;
  const baseLine = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort,
    stopping: isStopping === true,
  });
  const latest =
    !status.live && status.interruption !== undefined
      ? {
          kind: "worked" as const,
          words:
            status.interruption.continuation === "automatic"
              ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continuation scheduled`
              : status.interruption.continuation === "requested"
                ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continuation requested`
                : status.interruption.continuation === "continued"
                  ? `${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)} · continued automatically`
                  : `Interrupted — ${restartWords(ctx.speaker.name, status.interruption, ctx.timestampFormat)}`,
          effort: null,
        }
      : baseLine;
  // A line once shown stands a moment, and a burst shows its latest only
  // (`nowLineCalm.logic`); the run's end shows at once. As the card's head it says the run, never
  // its step: the card shows that under it.
  const said = head === undefined ? latest : cardHeadLine(latest);
  const line = useCalmLine(said, nowLineWords(said), !status.live);
  // Its face says what the Mate does this moment, whatever the head's words say.
  const settledFace = nowLineFace(head === undefined ? line : latest, status);
  const restartPending =
    !status.live &&
    status.interruption?.continuation === "manual" &&
    ctx.interruption != null &&
    ctx.interruption.turnId === status.interruption.turnId &&
    ctx.interruption.messageId === status.interruption.messageId;
  const face = restartPending ? { ...settledFace, state: "needs" as const } : settledFace;
  const words = nowLineWords(line);
  // The line's words change in place as the run goes: the old ones leave
  // where they stood as the new ones rise into it, so a change reads as the
  // same line saying something new.
  const wordsChanged = useChangedSinceShown(words);
  const [risesIn] = useState(settledHere);
  const leaving = useLeavingLine(line, words);
  // Out of sight or under reduced motion its words are simply there.
  const moves =
    !prefersReducedMotion() &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");
  const headWords = (
    <span
      key={words}
      className="run-now-head"
      data-run-now-change={(wordsChanged || risesIn) && moves ? "" : undefined}
    >
      <NowWords line={line} />
    </span>
  );
  const toggle = head?.toggle ?? null;
  // Its log hidden while it works, the head says what happens now under its
  // line (the board, 2026-11-10): the working row is the hidden work's too.
  const under = useCalmLine(latest, nowLineWords(latest), !status.live);
  const sub =
    head === undefined || !status.live || toggle === null || toggle.open
      ? null
      : underHeadWords(
          under,
          now?.kind === "thinking"
            ? thoughtOpening(now.messages.map((message) => message.text).join("\n\n"))
            : null,
        );
  // Its work opened, the counts its closed line leaves out stand under it, with its steps.
  const rest =
    line.kind !== "worked" || line.effort === null || head === undefined || toggle?.open !== true
      ? []
      : [
          ...worked.rest,
          ...(head.steps > 0 ? [`${head.steps} ${head.steps === 1 ? "step" : "steps"}`] : []),
        ];
  const restWords = rest.length === 0 ? null : rest.join(" · ");
  return (
    <div
      className="run-now"
      data-run-now={line.kind}
      data-run-sub={sub === null && restWords === null ? undefined : ""}
      data-run-head={head === undefined ? undefined : ""}
      data-run-titled={head?.title === undefined ? undefined : ""}
      data-run-status={
        line.kind === "worked" ? status.face : line.kind === "waiting" ? "waiting" : "working"
      }
    >
      {/* The whole line is the work's toggle: its words say what it opens. */}
      {toggle === null ? null : (
        <button
          aria-expanded={toggle.open}
          className="run-now-fold"
          onClick={toggle.onToggle}
          onFocus={toggle.onIntent}
          onPointerEnter={toggle.onIntent}
          type="button"
        >
          {toggle.open ? "Hide work" : "Show work"}
        </button>
      )}
      {ctx.speaker.helper ? (
        <HelperFace />
      ) : (
        <MateFace
          gaze={face.gaze}
          greets
          known={ctx.arrivedAfter !== null && !ctx.syncing}
          shape={ctx.speaker.shape}
          size={20}
          state={face.state}
          tint={ctx.speaker.tint}
        />
      )}
      <div className="run-now-words" data-work-line={status.face}>
        {head?.title === undefined ? null : <span className="run-now-title">{head.title}</span>}
        {leaving === null ? null : (
          <span aria-hidden="true" className="run-now-head run-now-leaving" key={leaving.words}>
            <NowWords line={leaving.line} />
          </span>
        )}
        {headWords}
        {head !== undefined && status.live ? (
          <span className="run-now-meta">
            {" · "}
            {/* Waiting for the reset, it says when it goes on where its clock stood (B5). */}
            {status.paused === undefined ? (
              <RunTicker status={status} />
            ) : (
              pausedHeadWords({
                provider: status.paused.provider,
                resetsAt: status.paused.resetsAt,
                // The Mate's engine goes on by itself at the reset; elsewhere, the server's switch.
                automatic: ctx.usageContinueTries === true || ctx.usagePause?.autoResume === true,
                timestampFormat: ctx.timestampFormat,
              }).meta
            )}
            {head.steps > 0 ? ` · ${head.steps} ${head.steps === 1 ? "step" : "steps"}` : null}
          </span>
        ) : null}
        {/* Over: at most two facts of what it came to beside its time — what changed for the
            person first — and, its work opened, the other counts under its line. */}
        {line.kind !== "worked" || line.effort === null
          ? null
          : worked.facts.map((fact) => (
              <Fragment key={fact}>
                <span className="sr-only">{" · "}</span>
                <span className="run-now-fact">{fact}</span>
              </Fragment>
            ))}
        {restWords === null ? null : (
          <span className="run-now-sub" data-run-now-rest>
            {restWords}
          </span>
        )}
        {sub === null ? null : (
          <span className="run-now-sub" data-run-now-sub>
            {sub}
          </span>
        )}
        {/* What a screen reader hears: the line's words as they change —
            never the thought's latest words or a step's ticking time. */}
        {status.live && (head === undefined || head.toggle?.open === false) ? (
          <span className="sr-only" role="status">
            {words}
          </span>
        ) : null}
      </div>
      {head !== undefined ? (
        // The head's right edge: what it does when pressed, its chevron turning over; a run that
        // waits on a Continue offers that too.
        <span className="run-now-end">
          {status.paused !== undefined ? (
            <LimitContinue
              pause={status.paused}
              speaker={ctx.speaker}
              limit={ctx.limit}
              onContinue={ctx.onUsageContinue ?? null}
              triesBeforeReset={ctx.usageContinueTries === true}
              blockedByAnswer={ctx.queueBlockedByAnswer === true}
              timestampFormat={ctx.timestampFormat}
            />
          ) : null}
          {restartPending ? (
            ctx.queueBlockedByAnswer ? (
              <span>Answer the pending question to continue.</span>
            ) : (
              <Button
                className="relative z-1"
                variant="ghost"
                size="sm"
                disabled={ctx.onRestartContinue == null}
                onClick={() => ctx.onRestartContinue?.(status.interruption!)}
              >
                Continue
              </Button>
            )
          ) : null}
          {/* Over, its press is named in sight too; its button says it to a screen reader. */}
          {toggle === null || line.kind !== "worked" ? null : (
            <span aria-hidden="true" className="run-head-toggle-words">
              {toggle.open ? "Hide work" : "Show work"}
            </span>
          )}
          {toggle === null ? null : (
            <ChevronDownIcon
              aria-hidden="true"
              className="run-head-chevron"
              data-open={toggle.open ? "" : undefined}
            />
          )}
        </span>
      ) : status.live ? (
        (end ?? (
          <span className="run-now-end">
            <RunTicker status={status} />
          </span>
        ))
      ) : restartPending && ctx.queueBlockedByAnswer ? (
        <span className="flex items-center gap-2">
          <span>Answer the pending question to continue.</span>
          {end}
        </span>
      ) : restartPending ? (
        <span className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={ctx.onRestartContinue == null}
            onClick={() => ctx.onRestartContinue?.(status.interruption!)}
          >
            Continue
          </Button>
          {end}
        </span>
      ) : (
        (end ?? <span />)
      )}
      {/* A run that broke off ends on why, under its line, in the words the
          server gave it: never a stack. Watched as it ends, its room opens
          as the line settles — never a jump of the card. */}
      {!status.live && status.brokeOff !== undefined ? (
        <BrokeOffLine brokeOff={status.brokeOff} rises={risesIn} />
      ) : null}
    </div>
  );
}

/**
 * Why a run broke off, under its line, and on the latest run what to do
 * next. When a later run begins, what to do next leaves; its words keep their
 * room, unseen, while the line stays on screen — a wrapped line never shrinks
 * the card under the person's eyes. Drawn anew, the line is its reason alone.
 */
function BrokeOffLine({
  brokeOff,
  rises,
}: {
  readonly brokeOff: BrokeOff;
  /** Watched as the run ends: its room opens as the line settles. */
  readonly rises: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const [heldNext, setHeldNext] = useState(brokeOff.next);
  if (brokeOff.next !== null && brokeOff.next !== heldNext) setHeldNext(brokeOff.next);
  // A usage limit or a refused sign-in in the voice the Mate's other surfaces use; a refused
  // attempt is a quiet record in its own words.
  const reason =
    brokeOff.quiet === true
      ? brokeOff.reason
      : mateFailureWords(brokeOff.reason, ctx.driver, ctx.speaker.name);
  return (
    <div
      className={cn("grid min-w-0 [grid-column:2/-1]", rises && "motion-safe:animate-room-open")}
      data-run-broke-off
    >
      <p
        className={cn(
          "min-h-0 min-w-0 overflow-hidden pt-0.5 text-sm leading-5",
          brokeOff.quiet === true ? "text-muted-foreground" : "text-status-failed-text",
        )}
      >
        {reason}
        {heldNext === null ? null : (
          <span
            aria-hidden={brokeOff.next === null ? true : undefined}
            className={brokeOff.next === null ? "invisible" : undefined}
          >
            {` ${heldNext}`}
          </span>
        )}
      </p>
    </div>
  );
}
