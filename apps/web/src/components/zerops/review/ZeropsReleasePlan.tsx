/**
 * "What happens in production": a release's steps in one card, in the order HQ runs them
 * (`releaseSheetSteps`). Before the press they are the plan — a creation says what it is, that it
 * is billed, and shows its import on request; after it the same rows tick in place: the busy mark
 * and its clock on the step under way, how long each took once done, the words of whatever
 * stopped it on the step that stopped. Props only: the review hands every read in.
 */
import type { DeployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import { CheckIcon, XIcon } from "lucide-react";
import { MOTION } from "@t3tools/shared/brand";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { InlineButton } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { servicePlanImportYaml } from "~/zerops/releaseImport.logic";

import { DeployLogDetails } from "../ZeropsDeployLog";
import type { ReleaseSheetStep, Words } from "./releaseSheet.logic";

/** Words drawn, the names in them in code type. */
export function WordsOf({ words }: { readonly words: Words }) {
  return (
    <>
      {keyedWords(words).map(({ key, word }) =>
        typeof word === "string" ? (
          <Fragment key={key}>{word}</Fragment>
        ) : (
          <span className="rv-code" key={key}>
            {word.code}
          </span>
        ),
      )}
    </>
  );
}

/** Each part keyed by where it starts in the sentence: the same name said twice is two parts. */
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

/**
 * What grows in place: when what it holds gets taller — the plan bringing a step the places did
 * not hold, a step opening its import — it eases there, so what stands under it goes down and
 * never jumps. Getting shorter is not eased. Reduced motion cuts.
 */
export function GrowsInPlace({ children }: { readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const stood = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const node = box.current;
    if (node === null) return;
    // Its laid-out height: the sheet's entrance scales what a client rect would say.
    const now = node.offsetHeight;
    const before = stood.current;
    stood.current = now;
    if (before === undefined || now - before < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.animate(
      [
        { height: `${String(before)}px`, overflow: "clip" },
        { height: `${String(now)}px`, overflow: "clip" },
      ],
      { duration: MOTION.duration.base, easing: MOTION.easing.out },
    );
  });
  return <div ref={box}>{children}</div>;
}

/** A deploy's log, where Zerops holds it: the project it ran in and the job to read. */
export interface ReleaseStepLog {
  readonly projectId: string;
  readonly target: DeployLogTarget;
}

export interface ReleasePlanProps {
  readonly steps: ReadonlyArray<ReleaseSheetStep>;
  /** The early path: creates what production lacks now, with the person's own access. */
  readonly onCreate?: (() => void) | undefined;
  /** Renews production's deploy key, on the step HQ stopped at for it; `renewing` while it runs. */
  readonly onRenew?: (() => void) | undefined;
  readonly renewing?: boolean | undefined;
  /** A service's deploy log, once its job has one. */
  readonly logOf?: ((service: string) => ReleaseStepLog | undefined) | undefined;
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
  onCreate,
  onRenew,
  renewing = false,
  logOf,
  live,
}: ReleasePlanProps) {
  const creations = steps.filter((step) => step.kind === "create").length;
  return (
    <ol className="rv-plan" data-zerops-surface="release-plan">
      {steps.map((step, index) => (
        <PlanStep
          createWords={creations > 1 ? "Create them now" : "Create it now"}
          index={index}
          key={step.key}
          live={step.kind === "live" && step.mark === "done" ? live : undefined}
          log={
            step.kind === "deploy" && step.service !== undefined ? logOf?.(step.service) : undefined
          }
          onCreate={onCreate}
          onRenew={onRenew}
          renewing={renewing}
          step={step}
        />
      ))}
    </ol>
  );
}

function PlanStep({
  step,
  index,
  createWords,
  onCreate,
  onRenew,
  renewing,
  log,
  live,
}: {
  readonly step: ReleaseSheetStep;
  readonly index: number;
  readonly createWords: string;
  readonly onCreate: (() => void) | undefined;
  readonly onRenew: (() => void) | undefined;
  readonly renewing: boolean;
  readonly log: ReleaseStepLog | undefined;
  readonly live: ReleasePlanProps["live"];
}) {
  const [open, setOpen] = useState<"import" | "log" | undefined>(undefined);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const yaml =
    step.creates === undefined
      ? undefined
      : servicePlanImportYaml({ hash: "", operations: [step.creates] });
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
    <li className="rv-pstep" data-release-step={step.kind} data-step-mark={step.mark}>
      <span className="rv-pmark" data-mark={step.mark}>
        {step.mark === "done" ? (
          <CheckIcon aria-label="Done" strokeWidth={2.5} />
        ) : step.mark === "busy" ? (
          <Spinner aria-label="Under way" />
        ) : step.mark === "failed" ? (
          <XIcon aria-label="Failed" strokeWidth={2.5} />
        ) : step.mark === "attention" ? (
          "!"
        ) : (
          index + 1
        )}
      </span>
      <p className="rv-pstep-t">
        <WordsOf words={step.title} />
      </p>
      {step.aside !== undefined ? (
        <span className="rv-pstep-aside" data-clock="">
          {step.aside}
        </span>
      ) : step.action === "renew-key" ? (
        onRenew === undefined ? null : (
          // Its words change while it runs; its place does not.
          <span className="rv-pstep-aside">
            <InlineButton data-release-renew="" disabled={renewing} onClick={onRenew}>
              {renewing ? "Renewing…" : "Renew the key"}
            </InlineButton>
          </span>
        )
      ) : step.action !== undefined && onCreate !== undefined ? (
        // The step's own press stands at its title's end; its line keeps the step's width.
        <span className="rv-pstep-aside">
          <InlineButton data-release-create="" onClick={onCreate}>
            {step.action === "create-again" ? "Try again" : createWords}
          </InlineButton>
        </span>
      ) : null}
      <p className="rv-pstep-l" data-tone={step.tone}>
        <span>
          <WordsOf words={step.line} />
        </span>
        {acts.map((act) => (
          <Fragment key={act.key}>
            <span aria-hidden="true">·</span>
            {act}
          </Fragment>
        ))}
      </p>
      {/* Live, its ways in stand on a line of their own under the way back. */}
      {live === undefined || (live.open === undefined && live.onAddDomain === undefined) ? null : (
        <p className="rv-pstep-l rv-pstep-ways">
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
        <div className="rv-pstep-more" data-zerops-surface="release-import">
          {step.creates.cost.trim() === "" ? null : <p>{step.creates.cost}</p>}
          <pre className="rv-pstep-yaml">{yaml}</pre>
          <p>
            <InlineButton onClick={() => copyToClipboard(yaml)}>
              {isCopied ? "Copied" : "Copy"}
            </InlineButton>
          </p>
        </div>
      ) : null}
      {open === "log" && log !== undefined && step.service !== undefined ? (
        <div className="rv-pstep-more">
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

/**
 * The plan while HQ has not said it: a step's place per service the release puts something on, and
 * production answering — the ready plan's size wherever it creates nothing.
 */
export function ReleasePlanSkeleton({ steps }: { readonly steps: number }) {
  return (
    <ol aria-busy="true" className="rv-plan" data-zerops-surface="release-plan">
      {Array.from({ length: Math.max(2, steps) }, (_, index) => index % 3).map((index, at) => (
        // oxlint-disable-next-line react/no-array-index-key -- Places, alike and never reordered.
        <li className="rv-pstep" key={at}>
          <span className="rv-pmark" data-mark="skeleton" />
          <span aria-hidden="true" className="rv-pstep-t">
            <span className={`rv-pskel my-1.25 ${["w-36", "w-44", "w-52"][index]!}`} />
          </span>
          <span aria-hidden="true" className="rv-pstep-l">
            <span className={`rv-pskel ${["w-60", "w-56", "w-48"][index]!}`} data-line="" />
          </span>
        </li>
      ))}
    </ol>
  );
}
