import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  SearchIcon,
  SquareStackIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { use, useState, type ReactNode } from "react";

import { AssetImage } from "~/assets/AssetImage";
import { cn } from "~/lib/utils";
import { META, rises } from "./RunBubble";
import { DidMark, StepMark, RunsNow, type Failure, FailedMark } from "./RunMarks";
import { CappedBox } from "./RunCappedBox";
import { DisclosureButton, Headline, OutputBlock, useDisclosure, WELL } from "./RunDisclosure";
import { CallRow } from "./RunCallRow";
import { CommandScript } from "./CommandScript";
import { FileWriteDetail } from "./FileWriteDetail";
import { stepWriteCalls } from "./fileWrites.logic";
import { useAssetUrlState } from "../../assets/assetUrls";
import { formatWorkDuration } from "./conversation.logic";
import { quickCallsSpanMs, quickCallsWords } from "./quickCalls.logic";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { useRunsPast } from "./useRunsPast";
import { opensOnto, stepOutput } from "./opens.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { TimelineRowCtx } from "./timelineContext";
import { stepNowWords } from "~/zerops/runSteps/nowWords";
import { stepOf, type StepKind, type StepPhrase, type WorkStep } from "~/zerops/runSteps/steps";
import { stepTime } from "./runStepTime";
import {
  ChatLineContext,
  InSlotContext,
  ListedContext,
  ResultPicturesContext,
} from "./runCardContext";
import { type ChatLine } from "./runChatLine";
import { PictureFrame } from "~/components/ui/picture-frame";
import { Button } from "~/components/ui/button";
import { Loading } from "~/components/ui/loading";
import { Skeleton } from "~/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Its calls
// ---------------------------------------------------------------------------

/**
 * A call said plainly: the verb and the names it took in the row's ink — the
 * names in mono where the code knows them, a file by its name alone, never
 * in a chip.
 */
function PhraseWords({ phrase }: { readonly phrase: StepPhrase }) {
  const name = (target: string) => (
    <span className={cn("min-w-0 break-words", phrase.code && "font-mono text-line")}>
      {target}
    </span>
  );
  const parts: ReactNode[] = [];
  const seen = new Map<string, number>();
  phrase.targets.forEach((target, index) => {
    const occurrence = seen.get(target) ?? 0;
    seen.set(target, occurrence + 1);
    const last = index === phrase.targets.length - 1;
    parts.push(
      <span key={`${target}#${occurrence}`}>
        {index > 0 ? <span>{last && phrase.more === 0 ? " and " : ", "}</span> : null}
        {name(target)}
      </span>,
    );
  });
  return (
    <span>
      <span>{phrase.verb}</span>
      {phrase.targets.length > 0 ? " " : null}
      {parts}
      {phrase.more > 0 ? <span> and {phrase.more} more</span> : null}
    </span>
  );
}

/** The pictures a step looked at, as themselves: small, each one opening the picture viewer. */
function StepPictures({ step }: { readonly step: WorkStep }) {
  const inResult = use(ResultPicturesContext);
  const { threadRef, onImageExpand } = use(TimelineRowCtx);
  const shown = step.entries.flatMap((entry) =>
    stepOf(entry, undefined, false)
      .images.filter((path) => !inResult.has(path))
      .map((path) => ({ key: `picture:${entry.id}:${path}`, path })),
  );
  if (shown.length === 0 || threadRef === null) return null;
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5 pt-2">
      {shown.map(({ key, path }) => (
        <StepPicture key={key} onOpen={onImageExpand} path={path} threadRef={threadRef} />
      ))}
    </span>
  );
}

function StepPicture({
  path,
  threadRef,
  onOpen,
}: {
  readonly path: string;
  readonly threadRef: ScopedThreadRef;
  readonly onOpen: (preview: ExpandedImagePreview) => void;
}) {
  const asset = useAssetUrlState(threadRef.environmentId, {
    _tag: "workspace-file",
    threadId: threadRef.threadId,
    path,
  });
  const name = path.split("/").pop() || path;
  if (asset._tag === "Loading") {
    return (
      <Loading label={name}>
        <Skeleton className="h-20 w-32" surface="card" />
      </Loading>
    );
  }
  if (asset._tag !== "Success") {
    return <span className={cn(META, "text-muted-foreground")}>{name} is not there any more</span>;
  }
  return (
    <Button
      aria-label={`Open ${name}`}
      className="block h-20 w-32 cursor-zoom-in"
      onClick={() => onOpen({ images: [{ src: asset.url, name }], index: 0 })}
      variant="bare"
    >
      <PictureFrame className="size-full" size="control">
        <AssetImage
          loading="lazy"
          decoding="async"
          alt={name}
          className="block size-full object-cover object-top"
          src={asset.url}
        />
      </PictureFrame>
    </Button>
  );
}

/** Each kind of call's mark, leading its box. */
const STEP_GLYPH: Record<StepKind, LucideIcon> = {
  command: SquareTerminalIcon,
  read: FileTextIcon,
  search: SearchIcon,
  edit: FilePenLineIcon,
  web: GlobeIcon,
  look: ImageIcon,
  tool: WrenchIcon,
};

/**
 * A command's code, in mono, in its item's box — a script never prints whole
 * into the chat unasked (the owner, 2026-09-28: "I see 100s of LoC printed
 * directly"). In the working row, six lines of it, following the code as it
 * streams in. In the log its first line under what the command was for,
 * muted — its title already says what it does, and three commands of four
 * lines each filled the card (the board, 2026-11-10); opened, all of it in a
 * well, nothing scrolling in it. Its grammar tints its ink without raising
 * it (`CommandScript`). `onCut` says whether lines run past the one shown,
 * `watch` measures whether that line itself is cut.
 */
function CommandCode({
  script,
  follows,
  open,
  onCut,
  watch,
}: {
  readonly script: string;
  readonly follows: boolean;
  readonly open: boolean;
  readonly onCut: (cut: boolean) => void;
  readonly watch: (element: HTMLElement | null) => void;
}) {
  const inSlot = use(InSlotContext);
  const whole = !inSlot && open;
  return (
    <CappedBox
      follows={follows}
      lines="code"
      onCut={onCut}
      open={open}
      {...(whole ? { className: cn(WELL, "px-3 py-3") } : {})}
    >
      <code
        ref={inSlot || whole ? undefined : watch}
        className={cn(
          "block font-mono",
          META,
          inSlot || whole
            ? "whitespace-pre-wrap break-words text-foreground/80"
            : "overflow-hidden text-ellipsis whitespace-pre text-muted-foreground/80",
          whole && "select-text",
        )}
      >
        <CommandScript script={script} />
      </code>
    </CappedBox>
  );
}

/**
 * A call the Mate made, as its row of the ledger: led by what kind of call it
 * was, its time and a chevron on the card's right edge. A command says what
 * it was for, then one line of its code; pressed, the row opens its code
 * whole in place, and what it printed under it. In the working row it stands
 * with its body — its code, six lines of it — and a spinner at its line's
 * end; the run's one clock stays the head's (K3).
 */
export function StepBubble({
  step,
  undone = false,
}: {
  readonly step: WorkStep;
  /** It failed, and a later step undid it or its run ended well: quiet, not red (K9). */
  readonly undone?: boolean;
}) {
  const inSlot = use(InSlotContext);
  const script = step.kind === "command" ? (step.script ?? step.code) : null;
  // A command that said nothing of itself is its own title (K4): its first
  // line, in mono, and the whole of it under it when it runs on.
  const bare = script !== null && step.words === null;
  const disclosure = useDisclosure(false, "open");
  const outputs = stepOutput(step);
  const writeCalls = stepWriteCalls(step);
  const failure: Failure | null = step.state !== "failed" ? null : undone ? "undone" : "broken";
  const running = step.state === "running";
  const time = stepTime(step);
  const showsCode = script !== null && (!bare || step.codeLines > 1);
  // In the log its code is one line: a script of several, or a line that runs
  // past the row, opens onto the whole of it.
  const [linesPast, setLinesPast] = useState(false);
  const [linePast, watchLine] = useRunsPast(false, true);
  // In a folded row's list it is its words alone: its code is all behind its press.
  const listed = use(ListedContext);
  const codeCut = !inSlot && showsCode && (listed || linesPast || linePast);
  const opens = opensOnto({ control: "step", step, codeCut });
  const title = step.words ?? step.code ?? "A command";
  const headline = (
    <Headline
      column
      now={running ? <RunsNow /> : null}
      opens={opens}
      running={running}
      time={failure !== null ? "Failed" : step.state === "stopped" ? "Stopped" : time}
      timeTone={failure === "broken" ? "failed" : "muted"}
    >
      {step.kind === "command" ? (
        step.words === null && step.code === null ? (
          // Its input not streamed in yet: what it does, never an empty row (run 5).
          <span>{running ? stepNowWords(step) : title}</span>
        ) : step.words === null ? (
          <span className="font-mono text-line">{step.code}</span>
        ) : (
          <span>{step.words}</span>
        )
      ) : step.phrase !== null ? (
        <PhraseWords phrase={step.phrase} />
      ) : (
        <span>{title}</span>
      )}
      {step.kind === "edit" && step.entries.length > 1 ? (
        <span className="text-muted-foreground">{` · ${step.entries.length} edits`}</span>
      ) : null}
    </Headline>
  );
  // Its code stands under its line: in a folded row's list only once it is opened.
  const code = showsCode && (!listed || disclosure.open);
  return (
    <CallRow
      failure={failure}
      kind={`step:${step.kind}`}
      mark={
        failure !== null ? (
          <FailedMark failure={failure} />
        ) : (
          <StepMark icon={STEP_GLYPH[step.kind]} running={running} />
        )
      }
    >
      {opens ? (
        <DisclosureButton
          // Closed, the whole row is its press: its line and the code under it.
          {...(disclosure.open
            ? {}
            : { className: "after:absolute after:inset-0 after:content-['']" })}
          label={`${title}. ${disclosure.open ? "Hide" : "Show"} ${outputs.length > 0 ? "what it returned" : writeCalls.length > 0 ? "what it wrote" : "all of its code"}`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {headline}
        </DisclosureButton>
      ) : (
        <div>{headline}</div>
      )}
      {code ? (
        <div className={inSlot || disclosure.open ? "pt-2" : undefined}>
          <CommandCode
            follows={inSlot && running}
            onCut={setLinesPast}
            open={disclosure.open && codeCut}
            script={script}
            watch={watchLine}
          />
        </div>
      ) : null}
      <StepPictures step={step} />
      {disclosure.open && outputs.length > 0 ? (
        <div
          className={cn("grid gap-2 pt-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          {outputs.map((output) => (
            <OutputBlock
              key={output.key}
              label={output.label}
              part={`detail-end:${output.key}`}
              text={output.text}
            />
          ))}
        </div>
      ) : null}
      {disclosure.open && writeCalls.length > 0 ? (
        <div className={cn("pt-2", rises(disclosure.made))} data-chat-detail>
          <FileWriteDetail
            box={(part, text) => (
              <CappedBox className={WELL} detail part={part}>
                {text}
              </CappedBox>
            )}
            callIds={writeCalls}
          />
        </div>
      ) : null}
    </CallRow>
  );
}

/**
 * Quick calls in a row as one row of the ledger (`quickCalls.logic`): what
 * they were and how many, their time together on the card's right edge, and
 * a chevron — pressed, it opens in place onto each of them, a line apiece.
 * While its burst goes on (`ticks`) its count stands in a chip that turns:
 * the count is the one thing in the log that changes then, and the words
 * beside it never shift for it.
 */
export function QuickCallsBubble({
  lines,
  steps,
  ticks,
}: {
  /** Each of its calls, as the line it is on its own. */
  readonly lines: ReadonlyArray<ChatLine>;
  readonly steps: ReadonlyArray<WorkStep>;
  readonly ticks: boolean;
}) {
  const disclosure = useDisclosure(false, "quick");
  const { verb, count, noun } = quickCallsWords(steps);
  const span = quickCallsSpanMs(steps);
  return (
    <CallRow kind="quick" mark={<DidMark icon={SquareStackIcon} />}>
      <DisclosureButton
        label={`${verb} ${count} ${noun}. ${disclosure.open ? "Hide" : "Show"} each one`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <Headline
          column
          opens
          time={span !== null && span >= 1000 ? formatWorkDuration(span) : null}
        >
          {verb}{" "}
          {/* While its burst goes on, the count turns in a pill of one width, so the words beside
              it never shift as it ticks; then it is a number in the line's ink. */}
          {ticks ? (
            <Badge className="mx-0.5 align-top" data-quick-count="">
              <Spinner aria-hidden="true" role="presentation" size="xs" tone="muted" />
              <span className="min-w-[2ch] text-center tabular-nums">{count}</span>
            </Badge>
          ) : (
            <span className="tabular-nums" data-quick-count="">
              {count}
            </span>
          )}{" "}
          {noun}
        </Headline>
      </DisclosureButton>
      {disclosure.open ? (
        <div
          // Opened in place: each of its calls a line of a tight list, under a rule in the Mate's
          // column.
          className={cn(
            "relative grid min-w-0 gap-1 pt-2.5 before:absolute before:top-1.5 before:bottom-0 before:-left-5.75 before:w-px before:bg-foreground/10",
            rises(disclosure.made),
          )}
          data-chat-detail
          data-quick-list
        >
          <ListedContext value>
            {lines.map((line) => (
              <ChatLineContext key={line.key} value={line.key}>
                {line.bubble}
              </ChatLineContext>
            ))}
          </ListedContext>
        </div>
      ) : null}
    </CallRow>
  );
}
