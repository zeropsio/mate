import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  browserCheckCaption,
  browserPageWords,
  operationLineWords,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";
import { ActivityIcon, AppWindowIcon } from "lucide-react";
import { use, useMemo } from "react";
import { cn } from "~/lib/utils";
import { useMateBrowserCallFrames } from "../../zerops/browserStreamLinks";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import { FixAction } from "./FixAction";
import { useMateOfEnvironment } from "../../zerops/accountEnvironments";
import { Bubble, ROW, rises } from "./RunBubble";
import { DidMark, type Failure, FailedMark } from "./RunMarks";
import { RunShimmer } from "./RunShimmer";
import { DisclosureButton, Headline, useDisclosure } from "./RunDisclosure";
import { CallRow } from "./RunCallRow";
import { KindGlyph, readsPipeline, ZeropsOperationCard } from "../zerops/ZeropsOperationCard";
import {
  devServerUrlFor,
  useOperationCard,
  type OperationCardRegions,
} from "../zerops/operation/useOperationCard";
import { standInOf } from "@t3tools/client-runtime/zerops/serviceMap";
import { useZeropsLifecycle, useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { BrowserStrip, BrowserTakes } from "./BrowserStrip";
import {
  browserTakeState,
  checksVerdict,
  formatWorkDuration,
  operationUnreturnedWords,
  type BrowserStripModel,
  incidentToneNow,
  servicesWithStandIns,
  type IncidentModel,
} from "./conversation.logic";
import { useRunsPast } from "./useRunsPast";
import { StatusBar } from "./StatusBar";
import { versionText } from "../zerops/operation/version";
import { ImportDetail } from "./ImportDetail";
import { useStandupReading } from "../../zerops/activity/useStandupReading";
import {
  detailLines,
  batchProgressWord,
  liveOperationBar,
  observedLinesOf,
  settledOperationBar,
  showsCardInSlot,
} from "./operationBar.logic";
import { standupBar, type StandupBarModel } from "./standupBar.logic";
import { opensOnto } from "./opens.logic";
import { StandupDetail } from "./StandupDetail";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { NO_RESULT, operationTime, STILL_RUNNING } from "./runStepTime";
import {
  ChatLineContext,
  InSlotContext,
  SlotStandsOpenContext,
  useCarried,
} from "./runCardContext";

/** An operation whose call returned while it runs on: the band under the chat draws it. */
function runsOnInBand(operation: ZeropsOperation): boolean {
  return (
    operation.kind !== "standup" &&
    operation.phase === "running" &&
    operation.returnedAt !== undefined &&
    operation.openedAt === undefined
  );
}

// ---------------------------------------------------------------------------
// The platform's work
// ---------------------------------------------------------------------------

/** A deploy's pipeline and build log, whole: the card, under what opened it. */
export function OperationDetail({
  operation,
  environmentId,
  threadRef,
  turnRuns,
  regions,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  /** Its turn runs: a stand-up's builds that ran on are read as they stand. */
  readonly turnRuns: boolean;
  /** What its line already read of the platform: the card draws it, never reading it twice. */
  readonly regions?: OperationCardRegions;
}) {
  if (operation.kind === "standup") {
    return (
      <StandupDetail environmentId={environmentId} operation={operation} turnRuns={turnRuns} />
    );
  }
  if (operation.kind === "import") {
    return <ImportDetail environmentId={environmentId} operation={operation} />;
  }
  if (regions !== undefined) {
    return (
      <ZeropsOperationCard headless operation={operation} threadRef={threadRef} {...regions} />
    );
  }
  return (
    <ZeropsOperationDetail
      environmentId={environmentId}
      operation={operation}
      threadRef={threadRef}
    />
  );
}

function ZeropsOperationDetail({
  operation,
  environmentId,
  threadRef,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // The whole log's dialog is the line's: one opened in the live slot stays open as it lands.
  const regions = useOperationCard(
    operation,
    environmentId,
    useCarried("log", () => false),
    true,
    threadRef?.threadId ?? null,
  );
  return <ZeropsOperationCard headless operation={operation} threadRef={threadRef} {...regions} />;
}

/**
 * A platform operation as its bubble — a deploy, a subdomain, a restart:
 * what it did in a sentence, its pipeline as a bar, and its time; while it
 * runs, what the Mate waits on beside its face (the bar under the chat has
 * its clock). Its card — the pipeline, the build log — opens under it.
 */
/** Whether the turn an operation ran in still runs: what it started may still be read live. */
function useTurnRuns(operation: ZeropsOperation): boolean {
  const activity = use(TimelineRowActivityCtx);
  return activity.isWorking && activity.latestTurnId === operation.turnId;
}

/** A stand-up's row: it opens to its services' lines only when there are any. */
export function StandupBubble({
  operation,
  undone,
}: {
  readonly operation: ZeropsOperation;
  readonly undone: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const reading = useStandupReading(
    operation,
    ctx.activeThreadEnvironmentId,
    useTurnRuns(operation),
  );
  return (
    <OperationBubble
      lines={detailLines(operation, reading?.rows.length ?? null)}
      operation={operation}
      standing={reading === null || reading.rows.length === 0 ? undefined : standupBar(reading)}
      undone={undone}
    />
  );
}

/** What an operation's line takes: the operation, how it ended, how much it opens to. */
interface OperationLineProps {
  readonly operation: ZeropsOperation;
  /** It failed, and a later one on the same service went through: quiet (K9). */
  readonly undone?: boolean;
  /**
   * Its call never returned: what was asked, never "Running" — "stale" while
   * the run goes on, "closed" ("No result") once it is over.
   */
  readonly noResult?: "stale" | "closed" | undefined;
  /** How much it opens to: its services' lines, its card's parts (`detailLines`). */
  readonly lines?: number;
  /**
   * A stand-up's own instrument while its call runs: a segment a service, what they do and how
   * many are up (`standupBar`), the same reading the band under the card draws once its call
   * returned. None for any other operation, or before any service is read.
   */
  readonly standing?: StandupBarModel | undefined;
}

/**
 * An operation's line. In the live slot, a deploy — the one kind whose card
 * draws a pipeline and a build log — reads the platform there, from its start
 * to its plop: its bar follows its pipeline, and the newest running one stands
 * open on its card (the pipeline's steps, the build's newest lines, the way to
 * the whole log) once the store has read any of it (pass 36: "the running
 * builds, their logs ... seem to be completely gone"). A batch deploy is one
 * line like any call: its bar a segment per service, its card the service the
 * platform says is building.
 */
export function OperationBubble(props: OperationLineProps) {
  const inSlot = use(InSlotContext);
  if (!inSlot || props.noResult !== undefined || props.operation.kind !== "deploy") {
    return <OperationLine {...props} regions={null} />;
  }
  return <WatchedOperationBubble {...props} />;
}

/** An operation in the live slot, with what its card reads of the platform. */
function WatchedOperationBubble(props: OperationLineProps) {
  const ctx = use(TimelineRowCtx);
  const line = use(ChatLineContext);
  const standsOpen = use(SlotStandsOpenContext);
  // The whole log's dialog is the line's: one opened here stays open as it
  // lands. A line that stands closed reads no build log.
  const regions = useOperationCard(
    props.operation,
    ctx.activeThreadEnvironmentId,
    useCarried("log", () => false),
    line !== null && line === standsOpen,
    ctx.threadRef?.threadId ?? null,
  );
  return <OperationLine {...props} regions={regions} />;
}

/**
 * A line's words with the service they name in the mono face: a hostname is a real thing's own
 * name, never a label (`.real-name`). Only where it stands as a word of its own.
 */
function ServiceNamed({
  words,
  name,
}: {
  readonly words: string;
  readonly name: string | undefined;
}) {
  const at = name === undefined || name === "" ? -1 : words.indexOf(name);
  if (name === undefined || at === -1) return words;
  const end = at + name.length;
  const inWord = /[\w-]/u;
  if ((at > 0 && inWord.test(words[at - 1]!)) || (end < words.length && inWord.test(words[end]!)))
    return words;
  return (
    <>
      {words.slice(0, at)}
      <span className="real-name">{name}</span>
      {words.slice(end)}
    </>
  );
}

function OperationLine({
  operation,
  undone = false,
  noResult,
  lines: given,
  standing,
  regions,
}: OperationLineProps & {
  /** What its card read of the platform: null where nothing reads it here. */
  readonly regions: OperationCardRegions | null;
}) {
  const observed = observedLinesOf(regions?.observed);
  const inSlot = use(InSlotContext);
  const line = use(ChatLineContext);
  const standsOpen = use(SlotStandsOpenContext);
  const ctx = use(TimelineRowCtx);
  const turnRuns = useTurnRuns(operation);
  // Its call returned while it runs on: the band under the chat draws it, so
  // its line here lands closed and opens onto nothing until it ends.
  const inBand = !inSlot && turnRuns && runsOnInBand(operation);
  // A dev server's card draws the way to its address, where the topology knows it.
  const topology = useZeropsTopology(ctx.activeThreadEnvironmentId);
  const devServerUrl = devServerUrlFor(operation, topology);
  const lines = inBand ? 0 : (given ?? detailLines(operation, null, observed, devServerUrl));
  // In the slot the newest running deploy stands open on what its card read, and lands so. A
  // stand-up stands open on its services the same way: each one's state is its progress, and a
  // line with a bar alone said nothing of it for the minutes its builds take.
  const disclosure = useDisclosure(
    inSlot &&
      line !== null &&
      line === standsOpen &&
      (operation.kind === "standup" ? lines > 0 : showsCardInSlot(observed)),
    "open",
    true,
    inBand,
  );
  const failed = operation.phase === "failed";
  const failure: Failure | null = !failed ? null : undone ? "undone" : "broken";
  const running = noResult === undefined && operation.phase === "running";
  // Live in the slot, its pipeline as it goes and the step it is on. A batch's rows carry each
  // service's state: its line says how many are out, and its words' sweep is its one running mark.
  const batch = operation.kind === "deploy" && operation.batch === true;
  const live =
    running && inSlot
      ? batch
        ? { segments: [], word: batchProgressWord(regions?.observed?.services) }
        : standing !== undefined
          ? {
              segments: standing.segments,
              word:
                standing.figure === null
                  ? standing.words
                  : `${standing.words} · ${standing.figure}`,
            }
          : liveOperationBar(
              operation,
              operation.batch === true ? undefined : regions?.observed?.pipeline,
            )
      : null;
  // Settled, a bar only where it says what the line does not (`settledOperationBar`).
  const settled = batch ? [] : settledOperationBar(operation, undone, inSlot ? "slot" : "log");
  const words =
    noResult === undefined ? operationLineWords(operation) : operationUnreturnedWords(operation);
  // A deploy's steps are its progress, under its name: the line holds its
  // name and its time alone — no bar, no step word, no reason (the owner,
  // 2026-10-05: "it should be steps, but they should be visible").
  const stepped = noResult === undefined && readsPipeline(operation);
  const reason =
    failed && !stepped ? (operation.explanation?.reason ?? operation.closing ?? null) : null;
  const detail =
    reason ??
    (operation.kind === "deploy" && !stepped
      ? (versionText(operation.version?.name) ?? null)
      : null);
  // Its reason cut short on its one line is a way to the whole of it.
  // Opened, it stands whole in place, wrapped: no longer cut, still the
  // way back to its one line.
  const [cut, watchDetail] = useRunsPast(false, true);
  const reasonCut = reason !== null && (cut || disclosure.open);
  // Nothing to add: no chevron, and it does not press.
  const opens = opensOnto({ control: "operation", lines, reasonCut });
  const head = (
    <Headline
      column
      opens={opens}
      time={
        noResult === undefined ? operationTime(operation) : noResult === "closed" ? NO_RESULT : null
      }
      timeTone={failure === "broken" ? "failed" : "muted"}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <RunShimmer
          className={stepped ? "text-foreground" : "text-foreground/75"}
          // A deploy's running step pulses: its name stands still in the ink.
          sweeps={live !== null && !stepped}
        >
          <ServiceNamed name={operation.target?.hostname} words={words} />
        </RunShimmer>
        {stepped ? null : live !== null ? (
          <>
            {live.segments.length === 0 ? null : (
              <StatusBar className="w-12" segments={live.segments} />
            )}
            {live.word === null ? null : <span className="text-muted-foreground">{live.word}</span>}
          </>
        ) : running || noResult !== undefined || settled.length === 0 ? null : (
          <StatusBar className="w-12" segments={settled} />
        )}
        {detail !== null ? (
          <span
            ref={watchDetail}
            className={cn(
              "min-w-0 font-mono text-muted-foreground",
              reason !== null && disclosure.open ? "whitespace-pre-wrap break-words" : "truncate",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failure}
      kind={`operation:${operation.kind}`}
      mark={
        failure === null ? <KindGlyph kind={operation.kind} /> : <FailedMark failure={failure} />
      }
    >
      {opens ? (
        <DisclosureButton
          label={`${words}. ${disclosure.open ? "Hide" : "Show"} it`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div>{head}</div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn(
            "pt-2",
            // In the log its times end where the line's own does, the chevron's seat held.
            !inSlot && "run-line-detail",
            // Only an open the person made moves; a carried or a landing one is simply there.
            rises(disclosure.made),
          )}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          {lines !== 0 ? (
            <OperationDetail
              environmentId={ctx.activeThreadEnvironmentId}
              operation={operation}
              threadRef={ctx.threadRef}
              turnRuns={turnRuns}
              {...(regions === null ? {} : { regions })}
            />
          ) : null}
          {failed && !undone ? (
            <OperationFixAction
              environmentId={ctx.activeThreadEnvironmentId}
              operation={operation}
            />
          ) : null}
        </div>
      ) : null}
    </CallRow>
  );
}

function OperationFixAction({
  environmentId,
  operation,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly operation: ZeropsOperation;
}) {
  const mate = useMateOfEnvironment(environmentId);
  return (
    <FixAction
      mate={mate === undefined ? undefined : { projectId: mate.projectId, groupId: undefined }}
      problem={{
        what: operationLineWords(operation),
        at: operation.settledAt ?? operation.anchorAt,
        error: operation.explanation?.reason ?? operation.closing,
        logLines: operation.explanation?.logTail,
        ask: "Find out why, fix it, and try again.",
      }}
    />
  );
}

/** The host a check's address names, its port included: what tells two sites' pages apart. */
function checkHost(subject: string): string {
  return subject.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "").split(/[/?#]/u)[0] ?? subject;
}

/**
 * The pages it checked in the browser, as their row of the chat from the
 * first check's start: what it checks, and each take in its device's shape
 * as it comes back — the one it is taking now a live frame of the page, in
 * the frame its picture will stand in, so the row never changes height when
 * the picture comes. The stage with every take opens under it.
 */
export function ChecksBubble({ strip: recorded }: { readonly strip: BrowserStripModel }) {
  const ctx = use(TimelineRowCtx);
  const calls = useMemo(
    () =>
      recorded.checks.map((check) => ({
        callId: check.callIds.length === 1 ? check.callIds[0]! : null,
        turnId: check.turnId,
      })),
    [recorded.checks],
  );
  const activity = use(TimelineRowActivityCtx);
  const frames = useMateBrowserCallFrames(
    ctx.activeThreadEnvironmentId,
    ctx.threadRef?.threadId ?? null,
    calls,
    activity.isWorking,
  );
  const strip = useMemo(
    () => ({
      ...recorded,
      checks: recorded.checks.map((check, index): ZeropsOperation => {
        const read = frames[index];
        if (read === undefined || read.kind === "unknown") return check;
        const { screenshot: _recorded, ...withoutPicture } = check;
        return read.frame === null
          ? withoutPicture
          : {
              ...check,
              screenshot: {
                src: frameImageSrc(read.frame),
                width: read.frame.width,
                height: read.frame.height,
              },
            };
      }),
    }),
    [recorded, frames],
  );
  const disclosure = useDisclosure();
  const latest = strip.checks.at(-1)!;
  const running = latest.phase === "running";
  // Two pages of one host by name, as one is; more by their count, and so
  // are pages of two hosts, whose paths do not say which is which ("/" on
  // another port is not the app's front page).
  const pages = [...new Set(strip.checks.map(browserCheckCaption))];
  const hosts = new Set(strip.checks.map((check) => checkHost(check.subject)));
  // As the now line said it while it ran: "Checking /status in the browser".
  const words = `${
    running
      ? `Checking ${browserPageWords(browserCheckCaption(latest))}`
      : strip.views === 1
        ? `Checked ${browserPageWords(browserCheckCaption(latest))}`
        : strip.views === 2 && pages.length === 2 && hosts.size === 1
          ? `Checked ${browserPageWords(pages[0]!)} and ${browserPageWords(pages[1]!)}`
          : `Checked ${strip.views} pages`
  } in the browser`;
  const verdict = checksVerdict(strip);
  const startedMs = Date.parse(strip.checks[0]!.anchorAt);
  const endedMs = Date.parse(latest.settledAt ?? latest.anchorAt);
  const tookMs = endedMs - startedMs;
  // How long the row took, from its first check; one still being taken says
  // so — its time ticks on the now line alone.
  const time = running
    ? STILL_RUNNING
    : Number.isFinite(tookMs) && tookMs >= 1000
      ? formatWorkDuration(tookMs)
      : null;
  const failed = strip.failures > 0;
  const takes = strip.checks.some(
    (check) =>
      check.screenshot ||
      check.phase === "running" ||
      browserTakeState(check, strip.checks) === "failed",
  );
  // One take with no picture and nothing read opens onto the same check.
  const opens = opensOnto({
    control: "checks",
    checks: strip.checks.length,
    shown: strip.checks.filter(
      (check) =>
        check.screenshot !== undefined ||
        check.browserRead !== undefined ||
        check.explanation !== undefined,
    ).length,
  });
  const head = (
    <Headline column opens={opens} time={time} timeTone={failed ? "failed" : "muted"}>
      <span>
        <span className="text-foreground/75">{words}</span>
        {verdict === null ? null : (
          <span className={failed ? "text-status-failed-text" : "text-muted-foreground"}>
            {` · ${verdict}`}
          </span>
        )}
      </span>
    </Headline>
  );
  return (
    <CallRow
      failure={failed ? "broken" : null}
      kind="checks"
      mark={failed ? <FailedMark failure="broken" /> : <DidMark icon={AppWindowIcon} />}
    >
      {opens ? (
        <DisclosureButton
          label={`${words}${verdict === null ? "" : `, ${verdict}`}. ${disclosure.open ? "Hide" : "Show"} the checks`}
          onToggle={disclosure.toggle}
          open={disclosure.open}
        >
          {head}
        </DisclosureButton>
      ) : (
        <div>{head}</div>
      )}
      {disclosure.open || !takes ? null : (
        <div className="pt-2">
          <BrowserTakes
            threadRef={ctx.threadRef}
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            takes={strip.checks}
          />
        </div>
      )}
      {opens && disclosure.open ? (
        <div
          className={cn("pt-2", rises(disclosure.made))}
          data-chat-detail
          data-chat-detail-rises={disclosure.made ? "" : undefined}
        >
          <BrowserStrip
            bare
            environmentId={ctx.activeThreadEnvironmentId}
            onOpenImage={ctx.onImageExpand}
            strip={strip}
            threadRef={ctx.threadRef}
          />
        </div>
      ) : null}
    </CallRow>
  );
}

/** A service's trouble, in its colour: red while broken, amber while it needs the person. */
export function IncidentMark({ incident }: { readonly incident: IncidentModel }) {
  const ctx = use(TimelineRowCtx);
  const topology = useZeropsTopology(ctx.activeThreadEnvironmentId);
  const lifecycle = useZeropsLifecycle(
    ctx.activeThreadEnvironmentId,
    ctx.threadRef?.threadId ?? null,
  );
  const tone = incidentToneNow(
    incident,
    servicesWithStandIns(topology?.services, (hostname) => standInOf(hostname, lifecycle)),
  ).tone;
  return (
    <ActivityIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        tone === "failed"
          ? "text-status-failed-text"
          : tone === "attention"
            ? "text-status-attention-text"
            : "text-muted-foreground",
      )}
    />
  );
}

/** A service that stopped answering, and what became of it: its phases in order. */
export function IncidentBubble({ incident }: { readonly incident: IncidentModel }) {
  return (
    <Bubble kind="incident" size={ROW} tone="tool">
      <span className="font-medium">{incident.hostname}</span>
      <span className="text-muted-foreground">{` ${incident.phases.join(" → ")}`}</span>
    </Bubble>
  );
}
