import { CheckIcon } from "lucide-react";
import { use, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { afterLayout } from "~/lib/afterLayout";
import { Mark, HelperFace } from "./RunMarks";
import { TypingDots } from "./RunTypingDots";
import { CallGroup } from "./RunCallRow";
import { THOUGHT_MARK, itemLine, ChatRow } from "./RunItemLine";
import { placeSlot } from "./runSlotGeometry";
import { MateFace } from "../zerops/primitives";
import { Spinner } from "../ui/spinner";
import { useCalmLine } from "./useCalmLine";
import { SLOT_MAX_ROWS, slotRunningPast, type LiveSlot as LiveSlotState } from "./liveSlot.logic";
import { easeRooms, type Rooms } from "./runRoom";
import { slotOpenDeployLine } from "./operationBar.logic";
import { type RecordItem, type RunStatus, type TurnHeaderActivity } from "./MessagesTimeline.logic";
import { nowLineOf, nowLineWords, slotWords, type SlotFiller } from "./runCard.logic";
import { useEngineLiveNow } from "./useEngineLiveMessage";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineContext";
import { stepOf } from "~/zerops/runSteps/steps";
import {
  ChatLineContext,
  ChatShownContext,
  InSlotContext,
  SlotStandsOpenContext,
} from "./runCardContext";
import {
  type ChatEntry,
  type ChatLine,
  EASED_BOXES,
  gatherCalls,
  type RunMotion,
} from "./runChatLine";

/**
 * The slot's rows, a card of calls keyed by the first call it ever held: one
 * whose first call leaves first stays the same card, its rows never mounted
 * again (B4), and a new batch's card is a new card, and rises in (E5).
 * `cards` says which card each call last stood in; the next one comes back.
 */
function slotEntries(
  lines: ReadonlyArray<ChatLine>,
  cards: ReadonlyMap<string, string>,
): { readonly entries: ReadonlyArray<ChatEntry>; readonly cards: ReadonlyMap<string, string> } {
  const next = new Map<string, string>();
  const taken = new Set<string>();
  const entries = gatherCalls(lines).map((entry) => {
    if (!("calls" in entry)) return entry;
    const kept = entry.calls
      .map((line) => cards.get(line.key))
      .find((key) => key !== undefined && !taken.has(key));
    const key = kept ?? `calls#${entry.calls[0]?.key ?? entry.key}`;
    taken.add(key);
    for (const line of entry.calls) next.set(line.key, key);
    return { ...entry, key };
  });
  return { entries, cards: next };
}

/** Whether two cards-by-call maps say the same. */
function sameCards(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  return left.size === right.size && [...left].every(([call, card]) => right.get(call) === card);
}

const NO_CARDS: ReadonlyMap<string, string> = new Map();

/**
 * A line the slot drew live that ended with no line of its own in the record:
 * said over, never still running — a step in its settled words.
 */
function endedLine(item: RecordItem): RecordItem {
  if (item.kind !== "step" || item.step.state !== "running") return item;
  const last = item.step.entries.at(-1);
  if (last === undefined) return item;
  const over = stepOf({ ...last, toolLifecycleStatus: "completed" }, undefined, false);
  return { ...item, step: { ...over, key: item.step.key } };
}

/**
 * What the slot says when no item stands in it: "Thinking", muted, from its
 * first frame — a word fading in late left the Mate's face alone on the line
 * for half a second (run 5, E +0:23.6); a quick gap between two steps is
 * bridged by the step standing its minimum — its words on their way, a wait
 * on the person, the context condensing. It stands as the row that takes its
 * place does: its mark in the Mate's column, its words on the items' text
 * edge, so what comes next replaces it where it stands (2026-11-10: a bare
 * word 12 px left of every item, no mark beside it).
 */
function SlotFillerWords({ filler }: { readonly filler: SlotFiller }) {
  switch (filler.kind) {
    case "thinking":
      return <span className="run-slot-word">Thinking</span>;
    case "writing":
      return (
        <>
          <span className="run-slot-word">Writing</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "condensing":
      return (
        <>
          <span className="run-slot-word">Condensing the context</span>
          <TypingDots className="run-now-dots" />
        </>
      );
    case "waiting":
      return (
        <span className="run-slot-word">{nowLineWords({ kind: "waiting", on: filler.on })}</span>
      );
    case "away":
      return <span className="run-slot-word">{filler.words}</span>;
    case "paused":
      return <span className="run-slot-word">{slotWords(null, filler)}</span>;
    case "after":
    case "starting":
      return (
        <>
          <span className="run-slot-word">{nowLineWords(filler)}</span>
          <TypingDots className="run-now-dots" />
        </>
      );
  }
}

/**
 * The working row, the card's foot while the run goes on (pass 35; the board,
 * 2026-11-10): the one panel inside the card, holding what the Mate is doing
 * this moment with its body — its face at work, its words in ink, a
 * command's code, a spinner while a call runs — and nothing to open: it
 * shows the thing up to its cap, and lands in the log as its row. Several at
 * once are a row each, three at most, then "+N more running". In a burst it
 * is one compact line of one height. Nothing standing in it, it says what
 * the Mate does between things: "Thinking", "Writing", a wait.
 */
const NO_ITEMS: ReadonlyMap<string, RecordItem> = new Map();

/** A wait the card's head says, never the slot. */
function headSays(filler: SlotFiller): boolean {
  return (
    filler.kind === "waiting" ||
    filler.kind === "after" ||
    filler.kind === "starting" ||
    filler.kind === "paused"
  );
}

/** What the empty slot says, as a key: the same words are no change. */
function fillerKey(filler: SlotFiller): string {
  return filler.kind === "waiting" ? `${filler.kind}:${filler.on}` : filler.kind;
}

export function LiveSlot({
  ref,
  folded,
  burst,
  slot,
  live,
  items,
  filler,
  now: recordedNow,
  answering,
  status,
  undone,
  motionRef,
}: {
  readonly ref: Ref<HTMLDivElement>;
  readonly folded: boolean;
  /** The burst it is in (`slotBurst`): which of how many passes through it. */
  readonly burst: { readonly at: number; readonly of: number } | null;
  readonly slot: LiveSlotState;
  /** What is live now, as the items they become. */
  readonly live: ReadonlyArray<RecordItem>;
  /** The record: what an item that ended and stands its minimum is drawn from. */
  readonly items: ReadonlyArray<RecordItem>;
  readonly filler: SlotFiller;
  readonly now: TurnHeaderActivity | null;
  readonly answering: boolean;
  readonly status: RunStatus;
  readonly undone: ReadonlySet<string>;
  /** Its card's motion: the history reads the slot's ease from it. */
  readonly motionRef: { readonly current: RunMotion };
}) {
  const now = useEngineLiveNow(recordedNow);
  const ctx = use(TimelineRowCtx);
  const { isCompacting, isStopping } = use(TimelineRowActivityCtx);
  // What the face and a screen reader say stands its dwell, as the slot's
  // items do: a call of 180 ms between two thoughts never flips them.
  const doing = nowLineOf({
    status,
    now,
    answering,
    compacting: isCompacting,
    speaker: ctx.speaker.name,
    effort: null,
    stopping: isStopping === true,
  });
  const latest = useCalmLine(doing, nowLineWords(doing), !status.live);
  // "Thinking", "Writing": what the empty slot says stands its dwell too. A wait is the head's to
  // say, at once: the slot leaves with the turn's last words, never saying "Writing" a second more.
  const said = useCalmLine(filler, fillerKey(filler), !status.live || headSays(filler));
  // What each entry last showed live: one that ended with no line of its own
  // in the record yet stands its minimum as it last showed, never a gap.
  const [lastLive, setLastLive] = useState<ReadonlyMap<string, RecordItem>>(NO_ITEMS);
  if (live.some((item) => lastLive.get(item.key) !== item)) {
    const standing = new Set(slot.entries.map((entry) => entry.key));
    setLastLive(
      new Map([
        ...[...lastLive].filter(([key]) => standing.has(key)),
        ...live.map((item) => [item.key, item] as const),
      ]),
    );
  }
  const byKey = new Map<string, RecordItem>();
  for (const [key, item] of lastLive) {
    // A check the record drew into the row of the one before it is drawn there.
    if (item.kind !== "strip") byKey.set(key, live.includes(item) ? item : endedLine(item));
  }
  for (const item of items) {
    // A call the record folded into the line before it is drawn as it ended
    // while it stands here (`parts`).
    if (item.kind === "step") {
      for (const part of item.parts ?? []) byKey.set(part.key, part);
    }
    byKey.set(item.key, item);
  }
  for (const item of live) byKey.set(item.key, item);
  const shown = slot.entries.flatMap((entry) => {
    // One the record drew into another line (a check joining the row of the
    // one before it) is drawn there already.
    const item = byKey.get(entry.key);
    if (item === undefined) return [];
    // A question's answer rises in under it, and the pair plops as one.
    const said =
      item.kind === "question" && entry.answer !== undefined ? byKey.get(entry.answer) : undefined;
    const answer = said?.kind === "person" ? [{ entry, item: said }] : [];
    return [{ entry, item }, ...answer];
  });
  const drawn = shown.slice(0, SLOT_MAX_ROWS);
  const more = slotRunningPast(shown);
  // The deploy line standing open keeps standing until it plops.
  const [heldOpen, setHeldOpen] = useState<string | null>(null);
  const standsOpen = slotOpenDeployLine(
    drawn.flatMap(({ item }) =>
      item.kind === "operation" && item.noResult === undefined
        ? [{ key: item.key, operation: item.operation }]
        : [],
    ),
    heldOpen,
  );
  if (standsOpen !== heldOpen) setHeldOpen(standsOpen);
  const lines = drawn
    .map(({ item }) => itemLine(item, undone))
    .map((line, index, all) =>
      line.theirs === true && all[index - 1]?.asks === true ? { ...line, pairs: true } : line,
    );
  const firstDrawn = lines.length === 0 ? undefined : drawn[0];
  // A wait with nothing standing in the slot is the card's head's to say: never twice.
  const saysHead = lines.length === 0 && headSays(said);
  // Which card each call stands in, kept from draw to draw (`slotEntries`).
  const [cards, setCards] = useState<ReadonlyMap<string, string>>(NO_CARDS);
  const slotted = slotEntries(lines, cards);
  if (!sameCards(cards, slotted.cards)) setCards(slotted.cards);
  const listRef = useRef<HTMLOListElement>(null);
  // What enters after the slot's first draw arrived while the person watched.
  const shownRef = useRef(false);
  useLayoutEffect(() => {
    shownRef.current = true;
  }, []);
  // Its room eases as rows come and go (`easeRooms`), uncovering a row that
  // joins at its foot; nothing eases on a resync.
  const syncingRef = useRef(ctx.syncing);
  const slotRoomsRef = useRef<Rooms | null>(null);
  useLayoutEffect(() => {
    syncingRef.current = ctx.syncing;
  }, [ctx.syncing]);
  useLayoutEffect(() => {
    const list = listRef.current;
    const slotBox = list?.parentElement;
    if (list === null || slotBox === null || slotBox === undefined) return;
    const motion = motionRef.current;
    const rooms = easeRooms({
      root: slotBox,
      selector: EASED_BOXES,
      eases: () => shownRef.current && !syncingRef.current,
      rootClips: true,
      // The working row grows as it shrinks: a thought gaining lines, a
      // command's body arriving, the next thing taller than the last.
      grows: () => true,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
    });
    slotRoomsRef.current = rooms;
    motion.slot = rooms;
    return () => {
      rooms.stop();
      slotRoomsRef.current = null;
      if (motion.slot === rooms) motion.slot = null;
    };
  }, [motionRef]);
  // Every commit, before the list's row measures it in its own.
  useLayoutEffect(() => slotRoomsRef.current?.flush());
  // The face and the clock stand on the first line, whatever bubble it is in.
  // Read once its room holds the height it showed: a slot read at its new
  // height first lowered the card's cap at once, and the card bounced back
  // the next frame as the slot eased (a phone's card, run 9).
  // Read once the page is laid out, before it paints: in the draw itself it
  // laid the page out early, on every word streamed into the slot.
  useLayoutEffect(() => {
    afterLayout(() => placeSlot(listRef.current));
    // Read when what it shows changed, never on every draw.
  }, [slot, live, items, said, lines.length]);
  // A row opened or shut in place, or the page resized: the room it takes
  // changes with no change of what it shows.
  useEffect(() => {
    const slotBox = listRef.current?.parentElement;
    if (slotBox === null || slotBox === undefined || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => placeSlot(listRef.current));
    observer.observe(slotBox);
    return () => observer.disconnect();
  }, []);
  // Folded, the card is its head alone: the working row is the hidden work's
  // too, and the head says what it shows under its line (`underHeadWords`).
  // What waits on the person stays in sight: a question it asked, their
  // answer under it.
  const asksPerson = drawn.some(({ item }) => item.kind === "question" || item.kind === "person");
  const shut = (folded && !asksPerson) || saysHead;
  return (
    <div
      ref={ref}
      className="run-slot"
      hidden={shut}
      style={shut ? { display: "none" } : undefined}
      data-run-now={lines.length === 0 ? said.kind : "items"}
      data-run-status={latest.kind === "waiting" ? "waiting" : "working"}
      data-slot-compact={burst === null ? undefined : ""}
      data-work-line={status.face}
    >
      <InSlotContext value>
        <SlotStandsOpenContext value={standsOpen}>
          <ChatShownContext value={shownRef}>
            <ol ref={listRef} className="run-slot-list">
              {burst !== null ? (
                // A burst: one line of one height, whatever passes through it — what it is,
                // and which of how many (the board, 2026-11-10).
                <li key="compact" className="run-slot-compact">
                  <Mark line="call">
                    {ctx.speaker.helper ? (
                      <HelperFace />
                    ) : (
                      <MateFace
                        shape={ctx.speaker.shape}
                        size={20}
                        state="working"
                        tint={ctx.speaker.tint}
                      />
                    )}
                  </Mark>
                  <span className="run-slot-compact-words">
                    {slotWords(firstDrawn?.item ?? null, said)}
                  </span>
                  <span className="run-slot-compact-count">{`${burst.at} of ${burst.of}`}</span>
                  <span className="run-slot-compact-mark">
                    {burst.at === burst.of && firstDrawn?.entry.endedAt != null ? (
                      <CheckIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    ) : (
                      <Spinner aria-hidden="true" role="presentation" size="xs" tone="muted" />
                    )}
                  </span>
                </li>
              ) : lines.length === 0 ? (
                <li
                  key={`filler:${said.kind}`}
                  className="run-slot-filler"
                  data-slot-filler={said.kind}
                >
                  {/* "Thinking" wears the thought's mark: the thought that follows
                      keeps it where it is. The card's head has the one face. */}
                  <Mark line={said.kind === "thinking" ? "thought" : "call"}>
                    {said.kind === "thinking" ? THOUGHT_MARK : null}
                  </Mark>
                  <span className="run-now-words">
                    <SlotFillerWords filler={said} />
                  </span>
                </li>
              ) : (
                slotted.entries.map((entry) =>
                  "calls" in entry ? (
                    <ChatRow key={entry.key} across={false} lineKey={entry.key} theirs={false}>
                      <CallGroup>
                        {entry.calls.map((line) => (
                          <ChatLineContext key={line.key} value={line.key}>
                            {line.bubble}
                          </ChatLineContext>
                        ))}
                      </CallGroup>
                    </ChatRow>
                  ) : (
                    <ChatRow
                      key={entry.key}
                      across={entry.across === true}
                      lineKey={entry.key}
                      mark={entry.mark}
                      markLine={entry.markLine}
                      pairs={entry.pairs === true}
                      said={entry.said === true}
                      theirs={entry.theirs === true}
                    >
                      {entry.bubble}
                    </ChatRow>
                  ),
                )
              )}
              {more > 0 && burst === null ? (
                <li className="run-slot-more">{`+${more} more running`}</li>
              ) : null}
            </ol>
          </ChatShownContext>
        </SlotStandsOpenContext>
      </InSlotContext>
      {/* What a screen reader hears: what the slot shows, as it changes. */}
      <span className="sr-only" role="status">
        {slotWords(firstDrawn?.item ?? null, said)}
      </span>
    </div>
  );
}
