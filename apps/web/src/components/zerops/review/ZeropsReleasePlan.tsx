/**
 * "What happens in production": a release's steps in one card, in the order HQ runs them
 * (`releaseSheetSteps`). Before the press they are the plan — a creation says what it is, that it
 * is billed, and shows its import on request; after it the same rows tick in place: the busy mark
 * and its clock on the step under way, how long each took once done, the words of whatever
 * stopped it on the step that stopped. Props only: the review hands every read in.
 */
import type { DeployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import { DicesIcon } from "lucide-react";
import type { RunningLine as Running } from "@t3tools/client-runtime/zerops/activity/runningNow";
import { MOTION } from "@t3tools/shared/brand";
import { Fragment, useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { Button, InlineButton } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { StepNumber, type StepNumberState } from "~/components/ui/step-number";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { servicePlanImportYaml } from "~/zerops/releaseImport.logic";

import { DeployLogDetails } from "../ZeropsDeployLog";
import { RunningLine } from "../system";
import { generateVaultValue } from "../vault/vault.logic";
import {
  valueStepWords,
  type ReleaseSheetStep,
  type ReleaseStepMark,
  type ReleaseValueStep,
  type Words,
} from "./releaseSheet.logic";

/** Words drawn, the names in them in code type. */
export function WordsOf({ words }: { readonly words: Words }) {
  return (
    <>
      {keyedWords(words).map(({ key, word }) =>
        typeof word === "string" ? (
          <Fragment key={key}>{word}</Fragment>
        ) : (
          <span className="font-mono" key={key}>
            {word.code}
          </span>
        ),
      )}
    </>
  );
}

/** Each part keyed by where it starts in the sentence: the same name said twice is two parts. */
/**
 * What happens in production: one card, the steps in HQ's order — a mark, a title and one line
 * each, joined down their marks; the hairline between two steps starts at their words. Before
 * the press they are the plan; after it they tick in place.
 */
const PLAN = "grid rounded-card border border-border bg-foreground/2 py-1.5";
const STEP =
  "relative grid min-h-16 grid-cols-[24px_minmax(0,1fr)_auto] content-start items-start gap-x-3.75 pt-3.25 ps-4.25 pe-4 pb-3.75 not-first:before:absolute not-first:before:top-0 not-first:before:right-4 not-first:before:left-14 not-first:before:h-px not-first:before:bg-border not-last:after:absolute not-last:after:top-11.5 not-last:after:-bottom-4.5 not-last:after:left-7 not-last:after:w-0.5 not-last:after:rounded-full not-last:after:bg-foreground/12";
/** A step's mark, beside both its lines. */
const MARK = "col-start-1 row-span-2 row-start-1 mt-2";
const TITLE = "col-start-2 row-start-1 truncate text-body font-medium";
/** Its one line, the line's first words in the step's tone; beside a clock it leaves the clock its column. */
const LINE =
  "col-span-2 col-start-2 row-start-2 flex flex-wrap gap-x-1.5 text-caption text-muted-foreground wrap-anywhere";
const LINE_BY_CLOCK =
  "col-start-2 row-start-2 flex flex-wrap gap-x-1.5 text-caption text-muted-foreground wrap-anywhere";
const LINE_TONE: Record<ReleaseSheetStep["tone"], string> = {
  quiet: "",
  busy: "*:first:text-status-busy-text",
  failed: "*:first:text-status-failed-text",
  attention: "*:first:text-status-attention-text",
};
/** At the step's end: how long it has run or took — at its middle — or its own quiet press. */
const ASIDE =
  "col-start-3 row-start-1 self-center text-caption whitespace-nowrap text-muted-foreground tabular-nums";
const CLOCK =
  "col-start-3 row-span-2 row-start-1 self-center text-caption whitespace-nowrap text-muted-foreground tabular-nums";
/** What a step opens under its line: its import, its deploy's log, a value's field. */
const MORE =
  "col-span-2 col-start-2 row-start-3 mt-2.5 grid min-w-0 gap-2 *:[p]:text-caption *:[p]:text-muted-foreground";

function keyedWords(words: Words) {
  const keyed: Array<{ readonly key: string; readonly word: Words[number] }> = [];
  let at = 0;
  for (const word of words) {
    const text = typeof word === "string" ? word : word.code;
    keyed.push({ key: `${String(at)}:${text}`, word });
    at += text.length;
  }
  return keyed;
}

/** A deploy's log, where Zerops holds it: the project it ran in and the job to read. */
export interface ReleaseStepLog {
  readonly projectId: string;
  readonly target: DeployLogTarget;
}

/** The values the release reads that production's vault lacks, each a step before the deploys. */
export interface ReleasePlanValues {
  readonly steps: ReadonlyArray<ReleaseValueStep>;
  /** Writes one, hidden, into production's vault; none where it is not the person's to write now. */
  readonly onSave: ((id: string, value: string) => void) | undefined;
  /** The id the release button's hold is read by: the first lacking value's title. */
  readonly heldBy?: string | undefined;
  /**
   * Production's vault is still read and the release names something only it can say: a value
   * step's place is held, so one that comes moves nothing painted under it.
   */
  readonly room?: boolean | undefined;
}

interface ReleasePlanProps {
  readonly steps: ReadonlyArray<ReleaseSheetStep>;
  readonly values?: ReleasePlanValues | undefined;
  /**
   * HQ has not said what happens to each service: a deploy keeps its name, its mark and its
   * place, and its line is still being `reading`, or `unsaid` where nothing reads it now.
   */
  readonly unread?: "reading" | "unsaid" | undefined;
  /** The early path: creates what production lacks now, with the person's own access. */
  readonly onCreate?: (() => void) | undefined;
  /** Renews production's deploy key, on the step HQ stopped at for it; `renewing` while it runs. */
  readonly onRenew?: (() => void) | undefined;
  readonly renewing?: boolean | undefined;
  /** The renew button's word, by what a stopped renewal waits on. */
  readonly renewWord?: string | undefined;
  /** A service's deploy log, once its job has one. */
  readonly logOf?: ((service: string) => ReleaseStepLog | undefined) | undefined;
  /** The platform's process a busy step is, by the step's key: where its build stands. */
  readonly running?: ReadonlyMap<string, Running> | undefined;
  /** Once live: the way in, and a domain of its own where production has none. */
  readonly live?:
    | {
        readonly open: { readonly url: string; readonly host: string } | undefined;
        readonly onAddDomain: (() => void) | undefined;
      }
    | undefined;
}

export function ReleasePlan({
  steps,
  values,
  unread,
  onCreate,
  onRenew,
  renewing = false,
  renewWord = "Renew the key",
  logOf,
  running,
  live,
}: ReleasePlanProps) {
  const creations = steps.filter((step) => step.kind === "create").length;
  const list = useRef<HTMLOListElement | null>(null);
  // A value production lacks is added before anything deploys that reads it.
  const at = steps.findIndex((step) => step.kind === "deploy" || step.kind === "live");
  const before = at === -1 ? steps.length : at;
  const items: ReadonlyArray<
    | { readonly kind: "step"; readonly key: string; readonly step: ReleaseSheetStep }
    | { readonly kind: "value"; readonly key: string; readonly value: ReleaseValueStep }
    | { readonly kind: "room"; readonly key: string }
  > = [
    ...steps.slice(0, before).map((step) => ({ kind: "step" as const, key: step.key, step })),
    // Placed by their order: a value coming where its place was held is no step brought in.
    ...(values?.steps ?? []).map((value, index) => ({
      kind: "value" as const,
      key: `value ${String(index)}`,
      value,
    })),
    ...(values?.room === true && values.steps.length === 0
      ? [{ kind: "room" as const, key: "value 0" }]
      : []),
    ...steps.slice(before).map((step) => ({ kind: "step" as const, key: step.key, step })),
  ];
  const firstLacking = values?.steps.find((value) => value.write.kind !== "saved")?.id;
  const keys = items.map((item) => item.key).join("\n");
  const stood = useRef<ReadonlySet<string> | undefined>(undefined);
  // A step the plan brings among those already standing (what production lacks is created first)
  // comes in, and the steps after it go down to their places from where they stood: none is cut
  // to another's. The first draw places them, and reduced motion cuts.
  useLayoutEffect(() => {
    const before = stood.current;
    const now = keys.split("\n");
    stood.current = new Set(now);
    const node = list.current;
    if (before === undefined || node === null) return;
    if (prefersReducedMotion()) return;
    const timing = { duration: MOTION.duration.base, easing: MOTION.easing.out };
    let pushed = 0;
    for (const [index, row] of Array.from(node.children).entries()) {
      if (!(row instanceof HTMLElement)) continue;
      if (!before.has(now[index] ?? "")) {
        pushed += row.offsetHeight;
        // It shows once the steps over its place have left it: two steps' words never cross.
        row.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], {
          duration: MOTION.duration.base,
        });
      } else if (pushed > 0) {
        row.animate(
          [{ transform: `translateY(${String(-pushed)}px)` }, { transform: "none" }],
          timing,
        );
      }
    }
  }, [keys]);
  return (
    <ol
      aria-busy={unread === "reading" ? true : undefined}
      className={PLAN}
      data-zerops-surface="release-plan"
      ref={list}
    >
      {items.map((item, index) => {
        if (item.kind === "room") return <ValueStepRoom key="value-room" />;
        if (item.kind === "value")
          return (
            <ValueStep
              index={index}
              key={item.value.id}
              onSave={values?.onSave}
              step={item.value}
              titleId={item.value.id === firstLacking ? values?.heldBy : undefined}
            />
          );
        const { step } = item;
        return (
          <PlanStep
            createWords={creations > 1 ? "Create them now" : "Create it now"}
            index={index}
            key={step.key}
            // What a deploy does to its service is the plan's to say; the rest is known without it.
            unread={step.kind === "deploy" ? unread : undefined}
            live={step.kind === "live" && step.mark === "done" ? live : undefined}
            log={
              step.kind === "deploy" && step.service !== undefined
                ? logOf?.(step.service)
                : undefined
            }
            onCreate={onCreate}
            onRenew={onRenew}
            renewing={renewing}
            renewWord={renewWord}
            // A deploy under way says where its build stands; a creation's title and clock say all.
            running={
              step.kind === "deploy" && step.mark === "busy" ? running?.get(step.key) : undefined
            }
            step={step}
          />
        );
      })}
    </ol>
  );
}

/** A value step's place while production's vault is read: its title, line and field, unsaid. */
function ValueStepRoom() {
  return (
    <li aria-hidden="true" className={STEP} data-release-step="value-room">
      <MarkRoom />
      <span className={TITLE}>
        <Skeleton className="my-1.25 h-2.5 w-36" shape="pill" surface="card" />
      </span>
      <span className={LINE}>
        <Skeleton className="my-1 h-2 w-56" shape="pill" surface="card" />
      </span>
      <span className={MORE}>
        <Skeleton className="h-7" surface="card" />
      </span>
    </li>
  );
}

/** A step's mark, still being read: its round, in the mark's place and size. */
function MarkRoom() {
  return (
    <span aria-hidden="true" className={`${MARK} flex size-6`}>
      <Skeleton className="size-full" shape="pill" surface="card" />
    </span>
  );
}

/** A step's mark: its number to do, or how it stands. */
function StepMark({ mark, index }: { readonly mark: ReleaseStepMark; readonly index: number }) {
  const said = MARK_WORDS[mark];
  return (
    <>
      <StepNumber className={MARK} n={index + 1} state={MARK_STATE[mark]} />
      {said === undefined ? null : <span className="sr-only">{said}</span>}
    </>
  );
}

const MARK_STATE: Record<ReleaseStepMark, StepNumberState> = {
  pending: "todo",
  busy: "busy",
  done: "done",
  failed: "failed",
  attention: "attention",
};
const MARK_WORDS: Record<ReleaseStepMark, string | undefined> = {
  pending: undefined,
  busy: "Under way",
  done: "Done",
  failed: "Failed",
  attention: undefined,
};

/**
 * A value production lacks, added in place: a field nobody reads back, a generated value or the
 * person's own pasted, written hidden into production's vault with the person's own Zerops access
 * — never through a Mate or HQ. Written before the release, the deploy starts with it.
 */
function ValueStep({
  step,
  index,
  onSave,
  titleId,
}: {
  readonly step: ReleaseValueStep;
  readonly index: number;
  readonly onSave: ReleasePlanValues["onSave"];
  readonly titleId: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const words = valueStepWords(step);
  const saving = step.write.kind === "saving";
  const save = () => {
    if (onSave === undefined || draft === "" || saving) return;
    onSave(step.id, draft);
  };
  return (
    <li className={STEP} data-release-step="value" data-step-mark={words.mark}>
      <StepMark index={index} mark={words.mark} />
      <p className={TITLE} id={titleId}>
        <WordsOf words={words.title} />
      </p>
      <p className={`${LINE} ${LINE_TONE[words.tone]}`}>
        <span>{words.line}</span>
      </p>
      {step.write.kind === "saved" || onSave === undefined ? null : (
        // A value production lacks, added in place: its field, Generate and Save on one row.
        <div
          className={`${MORE} grid-cols-[minmax(0,1fr)_auto_auto] items-center`}
          data-zerops-surface="release-value"
        >
          <Input
            aria-label={`${step.key}'s value`}
            autoComplete="off"
            disabled={saving}
            font="mono"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
            placeholder="Paste a value"
            size="sm"
            spellCheck={false}
            type="password"
            value={draft}
          />
          <Button
            disabled={saving}
            onClick={() => setDraft(generateVaultValue())}
            size="sm"
            variant="ghost"
          >
            <DicesIcon aria-hidden="true" />
            Generate
          </Button>
          <Button disabled={draft === "" || saving} onClick={save} size="sm" variant="secondary">
            {saving ? <Spinner size="xs" /> : null}
            {step.write.kind === "failed" ? "Try again" : "Save"}
          </Button>
        </div>
      )}
    </li>
  );
}

function PlanStep({
  step,
  index,
  unread,
  createWords,
  onCreate,
  onRenew,
  renewing,
  renewWord,
  log,
  running,
  live,
}: {
  readonly step: ReleaseSheetStep;
  readonly index: number;
  readonly unread: ReleasePlanProps["unread"];
  readonly createWords: string;
  readonly onCreate: (() => void) | undefined;
  readonly onRenew: (() => void) | undefined;
  readonly renewing: boolean;
  readonly renewWord: string;
  readonly log: ReleaseStepLog | undefined;
  readonly running: Running | undefined;
  readonly live: ReleasePlanProps["live"];
}) {
  const [open, setOpen] = useState<"import" | "log" | undefined>(undefined);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const yaml =
    step.creates === undefined ? undefined : servicePlanImportYaml({ operations: [step.creates] });
  const acts: Array<ReactElement> = [];
  if (yaml !== undefined)
    acts.push(
      <InlineButton
        aria-expanded={open === "import"}
        key="import"
        onClick={() => setOpen(open === "import" ? undefined : "import")}
      >
        {open === "import" ? "Hide the import" : "Show the import"}
      </InlineButton>,
    );
  if (log !== undefined && step.service !== undefined)
    acts.push(
      <InlineButton
        aria-expanded={open === "log"}
        key="log"
        onClick={() => setOpen(open === "log" ? undefined : "log")}
      >
        {open === "log" ? "Hide the build log" : "See the build log"}
      </InlineButton>,
    );
  return (
    <li
      className={STEP}
      data-release-step={step.kind}
      data-step-mark={step.mark}
      data-unread={unread}
    >
      <StepMark index={index} mark={step.mark} />
      <p className={TITLE}>
        <WordsOf words={step.title} />
      </p>
      {step.aside !== undefined ? (
        <span className={CLOCK}>{step.aside}</span>
      ) : step.action === "renew-key" ? (
        onRenew === undefined ? null : (
          // Its words change while it runs; its place does not.
          <span className={ASIDE}>
            <InlineButton data-release-renew="" disabled={renewing} onClick={onRenew}>
              {renewing ? "Renewing…" : renewWord}
            </InlineButton>
          </span>
        )
      ) : step.action !== undefined && onCreate !== undefined ? (
        // The step's own press stands at its title's end; its line keeps the step's width.
        <span className={ASIDE}>
          <InlineButton data-release-create="" onClick={onCreate}>
            {step.action === "create-again" ? "Try again" : createWords}
          </InlineButton>
        </span>
      ) : null}
      {unread === "unsaid" ? null : unread === "reading" ? (
        // The line it will say, in its place and height.
        <p aria-hidden="true" className={step.aside === undefined ? LINE : LINE_BY_CLOCK}>
          <Skeleton className="my-1 h-2 w-28" shape="pill" surface="card" />
        </p>
      ) : (
        <PlanStepLine
          acts={acts}
          className={step.aside === undefined ? LINE : LINE_BY_CLOCK}
          running={running}
          step={step}
        />
      )}
      {/* Live, its ways in stand on a line of their own under the way back. */}
      {live === undefined || (live.open === undefined && live.onAddDomain === undefined) ? null : (
        <p className="col-span-2 col-start-2 row-start-3 mt-1 flex flex-wrap gap-x-1.5 text-caption text-muted-foreground wrap-anywhere">
          {live.open === undefined ? null : (
            <InlineButton render={<a href={live.open.url} rel="noreferrer" target="_blank" />}>
              Open {live.open.host}
            </InlineButton>
          )}
          {live.open === undefined || live.onAddDomain === undefined ? null : (
            <span aria-hidden="true">·</span>
          )}
          {live.onAddDomain === undefined ? null : (
            <InlineButton onClick={live.onAddDomain}>Put it on your domain</InlineButton>
          )}
        </p>
      )}
      {open === "import" && yaml !== undefined && step.creates !== undefined ? (
        <div className={MORE} data-zerops-surface="release-import">
          {step.creates.cost.trim() === "" ? null : <p>{step.creates.cost}</p>}
          {/* Its import, as YAML, scrolling inside its own box. */}
          <pre className="max-h-60 overflow-auto rounded-control bg-muted px-3 py-2.5 font-mono text-caption whitespace-pre">
            {yaml}
          </pre>
          <p>
            <InlineButton onClick={() => copyToClipboard(yaml)}>
              {isCopied ? "Copied" : "Copy"}
            </InlineButton>
          </p>
        </div>
      ) : null}
      {open === "log" && log !== undefined && step.service !== undefined ? (
        <div className={MORE}>
          <DeployLogDetails
            key={log.target.jobId}
            projectId={log.projectId}
            service={step.service}
            target={log.target}
          />
        </div>
      ) : null}
    </li>
  );
}

/** A step's one line: what it does, or where the platform's work on it stands, and its presses. */
function PlanStepLine({
  step,
  running,
  acts,
  className,
}: {
  readonly step: ReleaseSheetStep;
  readonly running: Running | undefined;
  readonly acts: ReadonlyArray<ReactElement>;
  /** Its place in the step, beside a clock or not. */
  readonly className: string;
}) {
  return (
    <p className={`${className} ${LINE_TONE[running === undefined ? step.tone : "quiet"]}`}>
      {running === undefined ? (
        <span>
          <WordsOf words={step.line} />
        </span>
      ) : (
        // The step names the service and counts the time: the line is what the platform does.
        <>
          <RunningLine line={running} within="step" />
          {step.late === true ? (
            <>
              <span aria-hidden="true">·</span>
              <span>taking longer than usual</span>
            </>
          ) : null}
        </>
      )}
      {acts.map((act) => (
        <Fragment key={act.key}>
          <span aria-hidden="true">·</span>
          {act}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The plan before the project itself is read, when not even what the release lists is known: the
 * least it holds, a service and production answering. Once the project is read its steps stand by
 * name (`ReleasePlan`'s `unread`).
 */
export function ReleasePlanSkeleton({ steps }: { readonly steps: number }) {
  return (
    <ol aria-busy="true" className={PLAN} data-zerops-surface="release-plan">
      {Array.from({ length: Math.max(2, steps) }, (_, index) => index % 3).map((index, at) => (
        // oxlint-disable-next-line react/no-array-index-key -- Places, alike and never reordered.
        <li className={STEP} key={at}>
          <MarkRoom />
          <span aria-hidden="true" className={TITLE}>
            <Skeleton
              className={
                index === 0
                  ? "my-1.25 h-2.5 w-36"
                  : index === 1
                    ? "my-1.25 h-2.5 w-44"
                    : "my-1.25 h-2.5 w-52"
              }
              shape="pill"
              surface="card"
            />
          </span>
          <span aria-hidden="true" className={LINE}>
            <Skeleton
              className={
                index === 0 ? "my-1 h-2 w-60" : index === 1 ? "my-1 h-2 w-56" : "my-1 h-2 w-48"
              }
              shape="pill"
              surface="card"
            />
          </span>
        </li>
      ))}
    </ol>
  );
}
