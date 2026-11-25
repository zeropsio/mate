/**
 * A run's card, as a chat (the owner, 2026-09-27: "have the whole thing look
 * like a chat, treat it like my messages … different font style / bubble
 * color / special components depending on what kind of call it is").
 *
 * The card is a quiet tray with one grid (K1, K11): a 28 px column of marks,
 * the words one column in, times and actions on one right edge. Its foot is
 * the now line (K10): the Mate's face, what it is doing this moment in words
 * — the step itself while it runs — and the run's one clock (K3); once the
 * run is over, the worked line. Above it, everything the Mate said and did
 * stands in the order it happened, in five weights that cannot be mistaken
 * for one another (K14):
 * - what it said to the person, and what the person said: 14 px bubbles, its
 *   words in its tint (K13), theirs in their own neutral bubble, a question
 *   and its answer a pair;
 * - what it did: compact 13 px rows in a light outline, a run of calls one
 *   card with hairlines between, a command titled by its words or, with none,
 *   by the command itself (K4);
 * - what it thought: the quietest, 13 px faint italics, two lines of it.
 * What went wrong wears a red mark while it is still broken, and turns quiet
 * once a later step undid it, or once its run ended well — never a pink row
 * (K9); what merely happened (a context condensed, a change landed) a caption
 * between hairlines.
 *
 * Closed, the card is its summary line: who worked, for how long, what the
 * effort came to, and "Show work". Open — while the run goes on, and once
 * the person asks for the work — it is one scroll holding everything the run
 * said and did (the owner, 2026-09-29: "when open with scroll and all events
 * and when close just the summary -> expand open the scroll with
 * everything"). The scroll follows the newest line while it stands at its
 * foot, and stays where the person scrolled to once they leave it; a long
 * run's earlier lines are drawn as the person scrolls up to them. Inside it
 * nothing is cut without a way to the rest (D4): a command at four lines and
 * what it printed at twelve behind "Show all N lines", a thought behind a
 * click, a long message of the Mate's behind "Show full message" — each
 * opening in place, under the line the person clicked, which stays where it
 * is. Nothing opens a dialog.
 */
import { cn } from "~/lib/utils";
import {
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { afterLayout } from "~/lib/afterLayout";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { NowLine } from "./RunNowLine";
import { QuickCallsBubble } from "./RunCallBubbles";
import { itemLine } from "./RunItemLine";
import { LiveSlot } from "./RunLiveSlot";
import { RunScroll } from "./RunScroll";
import { easeFeedHeight, type FeedRoom, roomOf, shutFeed } from "./runFeedFold";
import { bubbleHeights, heightOf, lineTops, rowByKey, rowTops } from "./runSlotGeometry";
import { glideBy, glideLines, stopGliding, visibleTravel } from "./runGlide";
import { foldQuickCalls, quickCallsAtEnd } from "./quickCalls.logic";
import { AsPainted } from "./AsPainted";
import {
  headStood,
  headStoodJustNow,
  watchPainted,
  wordsCutUnder,
  wordsStoodUnder,
} from "./wordsLanding";
import { slotBurst, slotHoldsIn } from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";
import { useRunFold } from "./useRunFold";
import { foldWork } from "./foldWork";
import { usePace } from "./usePace";
import { KeptTimelineContext } from "./keptTimelineContext";
import { landingHosts, slotMoves } from "./slotMoves.logic";
import { resultPictures as allResultPictures, stripShowsFiles } from "./runResult.logic";
import { useStripFiles } from "./resultStripFiles";
import { backgroundLineOf, backgroundRowItems } from "./backgroundLine.logic";
import { useEngineCardPages } from "./useEngineCardPaging";
import { easeRooms, type Rooms } from "./runRoom";
import { createTravels } from "./runTravel";
import { sameRecordItem, type RecordItem, type RunStatus } from "./MessagesTimeline.logic";
import {
  recoveredFailures,
  runEndedWell,
  runCardShows,
  chooseLiveRunFold,
  setRunFold,
} from "./runCard.logic";
import { TimelineRowCtx } from "./timelineContext";
import { type WorkStep } from "~/zerops/runSteps/steps";
import {
  type Carried,
  CarriedOpenContext,
  NO_PATHS,
  ResultPicturesContext,
  useHoldReading,
} from "./runCardContext";
import { type ChatLine, type RecordRow, type RunMotion } from "./runChatLine";

// ---------------------------------------------------------------------------
// What the Mate is on now
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

/**
 * The line of a run with no chat to end on — one that only asked for a plan's
 * approval, or paused before it did anything: the now line alone.
 */
export function RunLine({ status }: { readonly status: RunStatus }) {
  return <NowLine answering={false} now={null} outcome={null} status={status} />;
}

const NO_KEYS: ReadonlyArray<string> = [];
const NO_TOPS: ReadonlyMap<string, number> = new Map();
const NO_HOLDS: ReadonlySet<string> = new Set();

/** Lines landing from the live slot: where each stood, and where the history's lines stood. */
interface Landing {
  /** Each line leaving the slot by its key, by where its row stood (NaN: it rode along unseen). */
  readonly from: ReadonlyMap<string, number>;
  /** The lines leaving that stood in the slot: they join the history at once (`usePace`). */
  readonly hosts: ReadonlySet<string>;
  /** Where the slot stood on screen. */
  readonly slot: number | null;
  /**
   * How far under the history's top its view ended, at the slot's top: a slot
   * that grew took room a line stood in.
   */
  readonly viewEnd: number | null;
  /** How tall the card's row stood: a list that follows its end moves it a frame late. */
  readonly card: number | null;
  /**
   * The history's lines by their key, by how far under the history's top each
   * stood: read against its own box, so the conversation scrolling the card
   * since — it follows a card that grows — is never a move of theirs (a card
   * of calls came down 35 px and went back up 70).
   */
  readonly rows: ReadonlyMap<string, number>;
  /**
   * Where the history's scroll stood as those were read. What it moved between
   * that read and the landing's draw the person saw happen — their own wheel
   * over a log that runs on — so it is no move of the landing's: read a few
   * frames before a landing, lines wheeled past since went back four rows and
   * glided down again (2026-11-10).
   */
  readonly scrollTop: number | null;
  /**
   * The slot's rows, by where each stood in it (from the slot's top): one that
   * stays keeps its place in the slot as a row above it leaves.
   */
  readonly staying: ReadonlyMap<string, number>;
  /** How tall each leaving line's bubble stood in the slot: it grows from there in the history. */
  readonly bubbles: ReadonlyMap<string, number>;
}

/**
 * A run's chat in its card: what the Mate said and did, in the order it
 * happened, in one scroll, and under it the Mate's status — the present said
 * once. As the run settles its work eases shut into the line, the summary
 * (the owner, 2026-09-29: "why didn't this autocollapse at the end?"), unless
 * the person is reading the work right then; a run they come back to is
 * closed to that line, and "Show work" opens the scroll under it.
 */
export function RunChat({ row }: { readonly row: RecordRow }) {
  // What the person opened, kept as a row lands from the slot in the history.
  const [carriedOpen] = useState(() => new Map<string, Carried>());
  // Its log's lines as last built: one that draws the same is the same line (`chatLines`).
  const [lineCache] = useState<LineCache>(() => new Map());
  const ctx = use(TimelineRowCtx);
  // An engine run too long to read whole: its effort from its summary, its lines a page at a time.
  const paging = row.paging;
  const pages = useEngineCardPages(paging);
  const outcome = row.outcome;
  const hold = useHoldReading();
  const rootRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  // How tall the card stood in its last draw while live: its settle's fold starts there.
  const liveHeightRef = useRef<number | null>(null);
  // Whether the person reads the work this moment — scrolled up in it, or
  // something in it opened: a run settling then stays open.
  const readingRef = useRef(false);
  // How the history's scroll keeps to its foot, for a line landing in it.
  const keepScrollRef = useRef<((lands?: boolean) => void) | null>(null);
  // How its boxes ease (`easeRooms`), for a line landing in it.
  const historyRoomsRef = useRef<Rooms | null>(null);
  // What its parts' motions share (`RunMotion`).
  const [travels] = useState(createTravels);
  const motionRef = useRef<RunMotion>({ slot: null, travels, keep: null });
  // What in it involves the person: a question it asked, their words in it.
  const personKeys = useMemo(
    () =>
      row.items.flatMap((item) =>
        item.kind === "question" || item.kind === "person" ? [item.key] : [],
      ),
    [row.items],
  );
  const cardRoomsRef = useRef<Rooms | null>(null);
  const { fold, foldNow, settling, motionAllowed, foldShutsRef } = useRunFold({
    conversation: ctx.routeThreadKey,
    run: row.turnKey,
    live: row.live,
    asks: row.now?.kind === "waiting",
    personKeys,
    readingRef,
    rootRef,
    aboveRef,
    liveHeightRef,
    roomsRef: cardRoomsRef,
    onFoldWork: ctx.onFoldWork ?? foldWork,
  });
  // The card's own height eases (`easeRooms`) as its parts come and go — the
  // history's scroll arriving with its first line — for a run watched live
  // here; what changes inside the history and the slot is theirs to ease. Its
  // turn over, the slot leaves at once: the answer lands under the card in the
  // frame its words leave it (engine-final, seg E: they stood in both for 1.1 s,
  // then the card eased shut and the page moved).
  const watchedRef = useRef(false);
  const cardEasesRef = useRef(false);
  const turnOver = !row.live || row.status?.waitingOnHelpers === true;
  // Unless nothing in the slot becomes the answer — it came with the run's end, the slot said
  // Thinking — then the card eases shut as anything else in it: the strip under it travels,
  // never a 124 px cut (recheck on 0.15.45, +4:14.0).
  const swapsRef = useRef(false);
  const endedRef = useRef(turnOver);
  useLayoutEffect(() => {
    if (row.live && !ctx.syncing) watchedRef.current = true;
    if (turnOver && !endedRef.current) {
      const root = rootRef.current;
      // Drawn outside a page (a test's renderer), it has no head to find.
      const head =
        typeof root?.querySelector === "function"
          ? root.querySelector<HTMLElement>(":scope > [data-run-head]")
          : null;
      swapsRef.current = head !== null && wordsStoodUnder(head);
    }
    endedRef.current = turnOver;
    cardEasesRef.current =
      watchedRef.current &&
      !ctx.syncing &&
      (!turnOver || !swapsRef.current) &&
      !foldShutsRef.current;
  });
  // Its turn ends under the person's eyes: the list holds its head where it stood as last painted,
  // from this commit — before anything under it moves (`onTurnLands`) — whatever its slot said
  // last (recheck on 0.15.41: a slot saying Thinking as the answer came with the end held
  // nothing, and the head travelled 120 px). Only words the slot's cap cut keep their last line
  // instead (`onAnswerLands`).
  const turnOverRef = useRef(turnOver);
  // How tall the card stood as last painted while its turn went on.
  const paintedHeightRef = useRef<number | null>(null);
  // Where its history's scroll stood as last painted, while the run goes on: a landing's lines
  // glide from where they stood then (`Landing.scrollTop`).
  const paintedScrollRef = useRef<number | null>(null);
  // Read as painted before each commit that draws the card or its conversation again
  // (`AsPainted`): never in every frame, which ran the page's main thread sixty times a second
  // for as long as a run went on.
  const live = row.live;
  useEffect(() => {
    const root = rootRef.current;
    // Drawn outside a page (a test's renderer), it has no head to find.
    if (!live || root === null || typeof root.querySelector !== "function") return;
    return watchPainted(root, () => {
      paintedScrollRef.current = scrollIn(aboveRef.current)?.scrollTop ?? null;
      // Its turn over while what it started runs on, the card stands at the height it showed then.
      if (turnOver) return;
      const head = root.querySelector<HTMLElement>(":scope > [data-run-head]");
      if (head !== null) headStood(head, head.getBoundingClientRect().top);
      paintedHeightRef.current = heightOf(root);
    });
  }, [live, turnOver]);
  // Its turn over while what it started runs on, the card stands at the height it showed without
  // its slot: its history never grows into the room the slot gave back, which pushed the answer
  // landing under it a slot's height down (recheck on 0.15.44, +15:38: 305 px).
  const [waitCap, setWaitCap] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!turnOver || !row.live) {
      if (waitCap !== null) setWaitCap(null);
      return;
    }
    if (waitCap === null && liveHeightRef.current !== null) setWaitCap(liveHeightRef.current);
  }, [turnOver, row.live, waitCap]);
  // Capped with nothing of its slot becoming the answer, the card travels to its new height from
  // the one it was last painted at (recheck on 0.15.45: the strip under it moved 124 px in a frame).
  useLayoutEffect(() => {
    const root = rootRef.current;
    const from = paintedHeightRef.current;
    if (waitCap === null || swapsRef.current || root === null || from === null) return;
    if (!motionAllowedNow() || typeof root.animate !== "function") return;
    const to = heightOf(root);
    if (to === null || from - to < 2) return;
    root.animate(
      [
        { height: `${from}px`, maxHeight: `${from}px`, overflow: "hidden" },
        { height: `${to}px`, maxHeight: `${to}px`, overflow: "hidden" },
      ],
      { duration: CARD_SHUT_MS, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [waitCap]);
  const { onTurnLands } = ctx;
  useLayoutEffect(() => {
    const was = turnOverRef.current;
    turnOverRef.current = turnOver;
    if (was || !turnOver || onTurnLands === undefined || !watchedRef.current || ctx.syncing) return;
    const head = rootRef.current?.querySelector<HTMLElement>(":scope > [data-run-head]") ?? null;
    const stood = head === null ? null : headStoodJustNow(head);
    if (head === null || stood === null) return;
    if (!wordsCutUnder(head)) onTurnLands(head, stood, !swapsRef.current);
  }, [turnOver, onTurnLands, ctx.syncing]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const motion = motionRef.current;
    const rooms = easeRooms({
      root,
      selector: ":not(*)",
      eases: () => cardEasesRef.current,
      rootClips: true,
      attributes: ["data-run-live"],
      // Its history arriving with its first line: the card's bottom edge
      // travels to uncover what stands under it, laid out where it will stand.
      grows: () => true,
      travels: motion.travels,
      afterStep: () => motion.keep?.(),
    });
    cardRoomsRef.current = rooms;
    return () => {
      rooms.stop();
      cardRoomsRef.current = null;
    };
  }, []);
  // A run the person comes back to (D3), or one that just settled: its
  // worked line alone — the summary — and "Show work" opens the whole run
  // under it (K12).
  const settled = row.status !== null && !row.live;
  // Watched live here, it ends under the person's eyes: its line rises in.
  const [watchedLive, setWatchedLive] = useState(row.live && !ctx.syncing);
  if (row.live && !ctx.syncing && !watchedLive) setWatchedLive(true);
  const shows = runCardShows(settled, fold, row.hasWork);
  const folded = shows.toggle === "show";
  const liveFolded = fold === "folded";
  // The work stands over the line while the run goes on, while it stays open
  // for a reader, and while it folds away into the line.
  const above = shows.work === "above";
  // The failures that stand quiet (K9) — what a later step undid, and, once the run ended well,
  // every command, call and background job of it that failed — read once per record, not once
  // per redraw. While it runs, and where it ended any other way, they stay red.
  const endedWell = runEndedWell(row.status);
  const undone = useMemo(() => recoveredFailures(row.items, endedWell), [row.items, endedWell]);
  // The live slot (pass 35): what the Mate is doing this moment, each thing
  // as the row it becomes; it plops into the history once it ended and
  // stood its minimum. Only the run's last record, while it runs, has one.
  const slotted = row.live && row.status !== null;
  const now = row.now;
  const model = row.slot;
  // A folded line's own calls are the record's too (`parts`).
  const recordKeys = useMemo(
    () =>
      model.record.flatMap((item) =>
        item.kind === "step" && item.parts !== undefined
          ? [item.key, ...item.parts.map((part) => part.key).filter((key) => key !== item.key)]
          : [item.key],
      ),
    [model.record],
  );
  const slotRef = useRef<HTMLDivElement>(null);
  // What goes live enters the slot one after another (`usePace`).
  const liveKeys = useMemo(() => model.live.map((item) => item.key), [model.live]);
  // Out of sight (a kept list), nobody watches: what arrives is simply there.
  const outOfSight = !(use(KeptTimelineContext)?.shown ?? true);
  const liveHeld = usePace({ keys: liveKeys, flush: !slotted || ctx.syncing || outOfSight });
  // When the quiet began, from the data: the record's newest line, else the
  // run's start — a reload or a catch-up never restarts "Thinking".
  const quietFrom = useMemo(() => {
    const ats = row.items.map((item) => Date.parse(item.at)).filter(Number.isFinite);
    const start = row.status === null ? Number.NaN : Date.parse(row.status.startedAt);
    return ats.length > 0 ? Math.max(...ats) : start;
  }, [row.items, row.status]);
  // Where each row leaving the slot stood, and each line of the history, read
  // before they move: the plop starts there, and the history glides from there.
  const [landing, setLanding] = useState<Landing | null>(null);
  const slot = useLiveSlot({
    live: slotted ? liveKeys.filter((key) => !liveHeld.has(key)) : NO_KEYS,
    // What waits its turn to go live is not the record's yet either: a
    // question waiting never rides into the history as ended.
    record: liveHeld.size === 0 ? recordKeys : recordKeys.filter((key) => !liveHeld.has(key)),
    final: !slotted,
    turnOver: row.status?.waitingOnHelpers === true,
    // Kept out of sight, nobody watches either: what arrives is history at once, so coming back
    // shows it, never a backlog still playing one line at a time.
    syncing: ctx.syncing || outOfSight,
    quietFrom,
    onChange: (from, to, redrawn) => {
      // Out of sight, nobody watches it land: what arrives is simply there.
      if (outOfSight) return;
      // What enters makes its room too: the history glides as the slot grows.
      const { leaving, entering } = slotMoves(from, to);
      if (leaving.length === 0 && !entering) return;
      // Where things stood as last painted: a change heard right after a draw
      // that already moved them (a check that ended as it was due, drawn as
      // it settled) starts from what the person saw, never from that draw.
      // On its own clock nothing was drawn since: what shows now, a glide in
      // flight included.
      const painted = (redrawn ? paintedRef.current : null) ?? paintedNow();
      const stood = new Map<string, number>();
      for (const key of leaving) {
        const top = painted.slotRows.get(key);
        stood.set(key, top === undefined || !slotted ? Number.NaN : top + (painted.slot ?? 0));
      }
      setLanding({
        from: stood,
        hosts: landingHosts(from, leaving, new Set(painted.slotRows.keys())),
        rows: slotted ? painted.rows : new Map(),
        scrollTop: slotted ? painted.scrollTop : null,
        slot: slotted ? painted.slot : null,
        viewEnd: slotted ? painted.viewEnd : null,
        card: painted.card,
        staying: slotted ? painted.slotRows : new Map(),
        bubbles: slotted ? painted.slotBubbles : new Map(),
      });
    },
  });
  /** Where the history's lines, the slot and its rows stand on screen now. */
  const paintedNow = () => {
    const slotTop = boxOf(slotRef.current)?.top ?? null;
    const scroll = scrollIn(aboveRef.current);
    const historyTop = boxOf(scroll)?.top ?? null;
    return {
      rows: historyTop === null ? NO_TOPS : lineTops(aboveRef.current, historyTop),
      scrollTop: scroll?.scrollTop ?? null,
      slot: slotTop,
      viewEnd: slotTop === null || historyTop === null ? null : slotTop - historyTop,
      slotRows: rowTops(slotRef.current, slotTop ?? 0),
      slotBubbles: bubbleHeights(slotRef.current),
      card: boxOf(cardRowOf(rootRef.current))?.height ?? null,
    };
  };
  const paintedRef = useRef<ReturnType<typeof paintedNow> | null>(null);
  // What left the slot lands, and everything it moves goes by one travel
  // (`runTravel`): the history makes its room at its foot as the slot gives
  // or takes its own, each by its height; the history's lines glide from
  // where they stood to where the landing put them, and the landed line comes
  // up with them from under the history's edge. Nothing else moves the slot:
  // it rides the history's edge, and a card that grows grows at its bottom.
  useLayoutEffect(() => {
    // Each landing once: it stays the last one heard until the next.
    if (landing === null) return;
    if (prefersReducedMotion()) return;
    const travel = motionRef.current.travels.current();
    // A history that follows its foot stands where the landed line ends, at
    // once: its lines glide there from where they stood, by the travel. A
    // move up the person made just before is read first, and stops it.
    keepScrollRef.current?.(true);
    const scroll = scrollIn(aboveRef.current);
    const list = scroll?.querySelector<HTMLElement>(":scope > ol") ?? null;
    const landed = new Set<HTMLElement>();
    for (const [key, from] of landing.from) {
      // One that rode along unseen rises in as it arrives (`useRisesIn`).
      if (!Number.isFinite(from)) continue;
      const line = rowByKey(list, key);
      if (line === null) continue;
      // A call that opened a card of its own lands with its card.
      const card = line.closest<HTMLElement>("[data-chat-calls]");
      const alone = card !== null && card.childElementCount === 1;
      landed.add(alone ? (card.closest<HTMLElement>("[data-chat-row]") ?? line) : line);
      // Its bubble grows from the height it showed in the slot (a thought
      // the slot showed four lines of, the history in full).
      const stoodHeight = landing.bubbles.get(key);
      const bubble = line.matches("[data-chat-bubble]")
        ? line
        : line.querySelector<HTMLElement>("[data-chat-bubble]");
      // One that lands shorter than it stood — a thought of five lines to its two, a
      // command's code to its one — is simply its row: easing it shut held its
      // words over an emptying box, and the log's edge went by both at once.
      if (
        stoodHeight !== undefined &&
        bubble !== null &&
        stoodHeight < bubble.getBoundingClientRect().height - 0.5
      ) {
        historyRoomsRef.current?.easeFrom(bubble, stoodHeight);
      }
    }
    if (scroll !== null && list !== null) {
      // The room the history still gives the slot as it glides: its lines go
      // by both, and the travel is timed for what they come to.
      const gives = Math.max(0, -(historyRoomsRef.current?.pending() ?? 0));
      // What its scroll moved from the read of its lines to this draw was seen as it happened.
      const painted = paintedScrollRef.current;
      const scrolled =
        landing.scrollTop === null || painted === null ? 0 : painted - landing.scrollTop;
      glideLines(scroll, list, landing.rows, scrolled, landed, landing.viewEnd, travel, gives);
    }
    const element = slotRef.current;
    if (landing.slot === null || landing.card === null || element === null) return;
    // A row that stays in the slot keeps its place in it as a row above it
    // leaves, and travels to its new one by the same travel: read from what
    // holds it — the slot, or its card of calls — so the slot's own move, the
    // history's edge or the list's, is never added to it.
    const rowSelector = "[data-chat-row][data-run-key]";
    for (const row of element.querySelectorAll<HTMLElement>(rowSelector)) {
      const stood = landing.staying.get(row.dataset.runKey!);
      if (stood === undefined) continue;
      const holder = row.parentElement?.closest<HTMLElement>(rowSelector) ?? null;
      const inHolder = holder !== null && element.contains(holder) ? holder : null;
      const holderStood = inHolder === null ? 0 : landing.staying.get(inHolder.dataset.runKey!);
      if (holderStood === undefined) continue;
      stopGliding(row);
      const base = (inHolder ?? element).getBoundingClientRect().top;
      glideBy(
        row,
        visibleTravel(row, stood - holderStood - (row.getBoundingClientRect().top - base)),
        travel,
      );
    }
  }, [landing]);
  // Read after each draw of a live run's card, once its landing glides
  // started — declared after the landing, so it runs after it: the next
  // change starts from what shows, never from the glides' destinations.
  // Read once the page is laid out, before it paints: what the frame shows.
  // Read in the draw, it laid the page out early on every word streamed, and
  // read every line of the history's box again; out of sight, never.
  const paintedDueRef = useRef({ due: false, wanted: false });
  useLayoutEffect(() => {
    const painted = paintedDueRef.current;
    painted.wanted = slotted && !outOfSight;
    if (!painted.wanted) {
      paintedRef.current = null;
      return;
    }
    if (painted.due) return;
    painted.due = true;
    afterLayout(() => {
      painted.due = false;
      if (painted.wanted) paintedRef.current = paintedNow();
    });
  });
  // The history arrives with its first line, where that line stood in the
  // slot: the slot takes its new place under it at once, and the card's own
  // edge uncovers it there (its flush, next) — a slot easing shut from the
  // height it showed stood past the card's edge all the way.
  const loggedRef = useRef(false);
  useLayoutEffect(() => {
    const logged = aboveRef.current !== null;
    if (logged && !loggedRef.current) motionRef.current.slot?.settle();
    loggedRef.current = logged;
  });
  // Every commit, before the list's row measures the card in its own.
  useLayoutEffect(() => cardRoomsRef.current?.flush());
  // While live, how tall the card stands without its slot, which leaves with the turn's last words
  // as the answer lands under the card: read after the room's flush, in each draw. Its history
  // folds from the height it showed, never first growing into the room the slot gave back.
  useLayoutEffect(() => {
    if (!row.live) return;
    const height = heightOf(rootRef.current);
    const slotBox = slotRef.current;
    liveHeightRef.current =
      height === null || slotBox === null || typeof getComputedStyle !== "function"
        ? height
        : height -
          slotBox.getBoundingClientRect().height -
          parseFloat(getComputedStyle(slotBox).marginTop || "0");
  });
  const holds = slotted ? slotHoldsIn(slot, recordKeys) : NO_HOLDS;
  // A folded line whose call the slot still holds stands unfolded, that call
  // left out: it folds in once the call lands.
  const history =
    holds.size === 0
      ? row.chatItems
      : row.chatItems.flatMap((selected): typeof row.chatItems => {
          const { item } = selected;
          if (holds.has(item.key)) return [];
          if (item.kind !== "step" || item.parts === undefined) return [selected];
          if (!item.parts.some((part) => holds.has(part.key))) return [selected];
          return item.parts
            .filter((part) => !holds.has(part.key))
            .map((part) => ({ item: part, pairs: false }));
        });
  const feedRef = useRef<HTMLDivElement>(null);
  const fromHeightRef = useRef<FeedRoom | null>(null);
  // A toggle leaves the room the work stood in: once the new fold is laid
  // out, the room eases from it to its own.
  useLayoutEffect(() => {
    const from = fromHeightRef.current;
    fromHeightRef.current = null;
    const feed = feedRef.current;
    if (from === null || feed === null) return;
    easeFeedHeight(feed, from);
  });
  // "Hide work": the work eases shut still drawn, and folds once it is shut — its line says so at
  // once. Folded at the press, its rows went in one frame and an empty room eased shut.
  const [shutting, setShutting] = useState(false);
  const shutRef = useRef<Animation | null>(null);
  // What joins the history enters one after another (`usePace`): a line
  // landing from the slot at once, what rode along with it after.
  const historyKeys = useMemo(() => history.map(({ item }) => item.key), [history]);
  const historyHeld = usePace({
    keys: historyKeys,
    landing: landing?.hosts ?? NO_HOLDS,
    flush: !slotted || ctx.syncing || outOfSight,
  });
  const entered =
    historyHeld.size === 0 ? history : history.filter(({ item }) => !historyHeld.has(item.key));
  // A burst (`slotBurst`): quick calls land folded into one row. The first of
  // them is no row on its own — it waits for the second, and they enter as
  // the one row whose count then ticks, so the log moves once for the batch
  // and never once per row. What the log held as the burst began stays.
  const burst = slotted ? slotBurst(slot) : null;
  const [burstBase, setBurstBase] = useState<ReadonlySet<string> | null>(null);
  if (burst === null && burstBase !== null) setBurstBase(null);
  if (burst !== null && burstBase === null) {
    setBurstBase(new Set(entered.map(({ item }) => item.key)));
  }
  const landedQuick = burst === null ? 0 : quickCallsAtEnd(entered, stepOfSelected);
  const lone =
    burst !== null && burstBase !== null && landedQuick === 1 ? entered.at(-1) : undefined;
  // Which of how many the working row says: counted with the calls the folded
  // row already holds, so the row's count and the working row's agree.
  const passedBefore = burst === null ? 0 : Math.max(landedQuick, burst.at - 1);
  const passingOf = burst === null ? 0 : passedBefore + burst.of - (burst.at - 1);
  const passing =
    burst === null ? null : { at: Math.min(passedBefore + 1, passingOf), of: passingOf };
  const logged =
    lone !== undefined && !burstBase?.has(lone.item.key) ? entered.slice(0, -1) : entered;
  const lines = above || !folded ? chatLines(logged, undone, burst !== null, lineCache) : [];
  // The scroll mounts with its first line, so its box is there from its
  // first frame for what keeps it at its foot.
  const scroll =
    lines.length === 0 ? null : (
      <RunScroll
        label={`${ctx.speaker.name}'s work`}
        landing={landing?.from ?? null}
        lines={lines}
        keepRef={keepScrollRef}
        roomsRef={historyRoomsRef}
        motionRef={motionRef}
        eases={!ctx.syncing}
        opensAtStart={!above}
        {...(above ? { readingRef } : {})}
        {...(pages === null ? {} : { pages })}
      />
    );
  const settledOutcome = settled ? row.outcome : null;
  const toggleWork = () => {
    hold(folded || shutting);
    // Watched to its end and still open over its line: it
    // folds into the line as a run settling does.
    if (fold === "watched") {
      foldNow();
      return;
    }
    const feed = feedRef.current;
    const room = feed === null ? null : roomOf(feed);
    // Pressed again as it shuts: it eases open again from where it stood.
    if (shutting) {
      shutRef.current?.cancel();
      shutRef.current = null;
      fromHeightRef.current = room;
      setShutting(false);
      return;
    }
    if (!folded && feed !== null && room !== null && !prefersReducedMotion()) {
      setShutting(true);
      shutRef.current = shutFeed(feed, room, () => {
        shutRef.current = null;
        setRunFold(ctx.routeThreadKey, row.turnKey, "folded");
        setShutting(false);
      });
      return;
    }
    fromHeightRef.current = room;
    setRunFold(ctx.routeThreadKey, row.turnKey, folded ? "shown" : "folded");
  };
  // "Show work" pressed before its lines were read: it opens once their first page is held, or
  // stays closed if the read fails.
  const openingRef = useRef<{ reading: boolean } | null>(null);
  const openWhenHeld = useEffectEvent(() => toggleWork());
  useLayoutEffect(() => {
    const opening = openingRef.current;
    if (opening === null || paging === null) return;
    if (paging.holdsLines) {
      openingRef.current = null;
      openWhenHeld();
    } else if (paging.reading !== null) opening.reading = true;
    else if (opening.reading) openingRef.current = null;
  }, [paging]);

  // What the result's strip draws, as it said (`resultStripFiles`); the first six until then.
  const stripGuess = useMemo(
    () => (settledOutcome === null ? NO_PATHS : stripShowsFiles(allResultPictures(settledOutcome))),
    [settledOutcome],
  );
  const resultPictures = useStripFiles(settledOutcome?.turnKey ?? null, stripGuess);
  // The card's head toggles its work: live, the history over what it does now; settled, the run
  // under its line. Its lines not read yet, it opens once their first page is held.
  const headToggle =
    shows.toggle === null
      ? null
      : row.live
        ? {
            open: !liveFolded,
            onToggle: () => {
              hold(!liveFolded);
              chooseLiveRunFold(ctx.routeThreadKey, row.turnKey, liveFolded ? "watched" : "folded");
            },
          }
        : {
            open: !folded && !shutting,
            onToggle: () => {
              if (folded && pages !== null && paging !== null && !paging.holdsLines) {
                if (openingRef.current !== null) return;
                hold(folded);
                openingRef.current = { reading: false };
                pages.read("later");
                return;
              }
              toggleWork();
            },
            ...(pages !== null && paging !== null && !paging.holdsLines
              ? { onIntent: () => pages.read("later") }
              : {}),
          };
  return (
    // One container for the card's head, its chat and what the Mate does now: the Mate's column
    // keeps one gap for them all. Its words wear its tint (`--run-speaker-tint`). Keyed, so the scroll
    // the person watched is the one that folds away.
    <CarriedOpenContext value={carriedOpen}>
      <ResultPicturesContext value={resultPictures}>
        <div
          ref={rootRef}
          // While the run goes on, once the record holds its height, the history and the working row
          // share it, so the card's outer box stands still: a row that grows takes its room from
          // the history, never from the page; on a short page the row alone can pass the cap, and
          // the card holds it whole (`--run-slot-room`, run-card.css). Holding an older height
          // while its edge travels to a taller one (`runRoom`), the history stands as laid out.
          className="@container/chat min-w-0 data-run-live:flex data-run-live:max-h-[max(min(560px,60svh),var(--run-slot-room,0px))] data-run-live:flex-col [&[data-run-live]>[data-run-above]]:flex [&[data-run-live]>[data-run-above]]:min-h-0 [&[data-run-live]>[data-run-above]]:flex-initial [&[data-run-live]>[data-run-above]]:flex-col [&[data-run-live]>[data-run-above]>[data-run-scroll]]:min-h-0 [&[data-run-live]>[data-run-above]>[data-run-scroll]]:flex-initial [&[data-run-live]>[data-run-slot]]:flex-none [&[data-run-live][data-room-easing]>[data-run-above]]:shrink-0"
          data-run-chat
          data-run-fold={settled ? fold : undefined}
          // The shared height holds through the settle's fold: dropped in the
          // commit the fold measures, the history jumped to its own height first.
          data-run-live={slotted || settling || fold === "folding" ? "" : undefined}
          style={
            {
              "--run-speaker-tint": `var(--zerops-mate-tint-${ctx.speaker.tint})`,
              ...(waitCap === null ? {} : { maxHeight: `${waitCap}px` }),
            } as CSSProperties
          }
        >
          {/* The card's head: the same line in every state, its words changed in place as the
              run settles — it never moves, and the work folds under it. */}
          {row.status === null ? null : (
            <NowLine
              key="head"
              answering={row.answering}
              head={{
                steps: row.chatItems.length,
                toggle: headToggle,
                ...(row.opener === undefined
                  ? {}
                  : {
                      title: backgroundLineOf(backgroundRowItems(row.opener), row.opener.helpers)
                        .words,
                    }),
              }}
              now={row.live ? now : null}
              outcome={settled ? outcome : null}
              settledHere={watchedLive && motionAllowed}
              status={row.status}
            />
          )}
          {above && scroll !== null ? (
            <div
              key="above"
              ref={aboveRef}
              // The log's first row stands 14 px under the head's line; over the working row, a
              // hairline sets it off. Settling, it folds shut into the line, the newest lines the
              // last to go under a soft edge (`foldAway`), its room over the work with it.
              className={cn(
                "mt-2.5 [&:not([hidden]):has(+[data-run-slot]:not([hidden]))]:border-b [&:not([hidden]):has(+[data-run-slot]:not([hidden]))]:border-foreground/8 [&:not([hidden]):has(+[data-run-slot]:not([hidden]))]:pb-4",
                fold === "folding" &&
                  "mt-0 flex flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,currentColor_24px)] *:flex-none",
              )}
              data-run-above=""
              hidden={row.live && liveFolded}
              style={row.live && liveFolded ? { display: "none" } : undefined}
              data-folding={fold === "folding" ? "" : undefined}
            >
              {scroll}
            </div>
          ) : null}
          {row.status === null || settled ? null : (
            <LiveSlot
              key="slot"
              folded={liveFolded}
              ref={slotRef}
              items={model.record}
              live={model.live}
              filler={model.filler}
              now={now}
              answering={row.answering}
              burst={passing}
              slot={slot}
              status={row.status}
              undone={undone}
              motionRef={motionRef}
            />
          )}
          {/* A run come back to: the log 14 px under its head, in its own box, so the height it
              eases to is the height it keeps. */}
          <div key="below" ref={feedRef} className="flow-root not-empty:mt-2.5">
            {above ? null : scroll}
          </div>
          {/* A landing is drawn in a commit of its own, its row the same: read before that one too. */}
          <AsPainted key="painted" of={row} and={landing} />
        </div>
      </ResultPicturesContext>
    </CarriedOpenContext>
  );
}

/** A line's step where the line is a call of the Mate's own: what may be a quick call. */
function stepOfSelected({ item }: RecordRow["chatItems"][number]): WorkStep | null {
  return item.kind === "step" ? item.step : null;
}

/**
 * A run's lines as they were last built, by key: what each was built from,
 * and the line. An item that draws the same keeps its line — the same object,
 * so React leaves its row alone. Every event of a run rebuilds its record's
 * items; built anew each time, every row of the log was drawn again for one
 * word streamed into the working row (at 1000 rows, a fifth of every second).
 */
type LineCache = Map<
  string,
  {
    readonly items: ReadonlyArray<RecordItem>;
    readonly undone: boolean;
    readonly pairs: boolean;
    readonly ticks: boolean;
    readonly line: ChatLine;
  }
>;

/**
 * Build bubbles only for the selected history once its work is drawn: each
 * item its line, quick calls in a row folded into one (`foldQuickCalls`).
 * `ticks`: a burst goes on, and the folded row at the log's foot counts it.
 * A line whose items draw as they did is the line `cache` holds.
 */
function chatLines(
  items: RecordRow["chatItems"],
  undone: ReadonlySet<string>,
  ticks: boolean,
  cache: LineCache,
): ChatLine[] {
  const folded = foldQuickCalls(items, stepOfSelected, ({ item }) => item.key);
  const drawn = new Set<string>();
  const lines = folded.map((entry, index) => {
    const quick = "quick" in entry;
    const key = quick ? `quick:${entry.key}` : entry.item.key;
    const made = quick ? entry.quick.map(({ item }) => item) : [entry.item];
    const fails = made.some((item) => undone.has(item.key));
    const pairs = quick ? false : entry.pairs;
    const counts = quick && ticks && index === folded.length - 1;
    drawn.add(key);
    const held = cache.get(key);
    if (
      held !== undefined &&
      held.undone === fails &&
      held.pairs === pairs &&
      held.ticks === counts &&
      held.items.length === made.length &&
      held.items.every((item, at) => sameRecordItem(item, made[at]!))
    ) {
      return held.line;
    }
    const line: ChatLine = quick
      ? {
          key: entry.key,
          bubble: (
            <QuickCallsBubble
              lines={made.map((item) => itemLine(item, undone))}
              steps={entry.quick.flatMap((selected) => stepOfSelected(selected) ?? [])}
              ticks={counts}
            />
          ),
          call: true,
        }
      : { ...itemLine(entry.item, undone), pairs };
    cache.set(key, { items: made, undone: fails, pairs, ticks: counts, line });
    return line;
  });
  // What left the log is not kept: the cache holds one run's lines as drawn.
  if (cache.size > drawn.size)
    for (const key of cache.keys()) if (!drawn.has(key)) cache.delete(key);
  return lines;
}

/** How long a card whose turn ended takes to stand at its new height. */
const CARD_SHUT_MS = 220;

/** Whether motion plays: never under reduced motion, nor in a hidden tab. */
function motionAllowedNow(): boolean {
  return (
    !prefersReducedMotion() &&
    (typeof document === "undefined" || document.visibilityState !== "hidden")
  );
}

/** Where an element stands on screen; null drawn outside a page (a test's renderer). */
function boxOf(element: HTMLElement | null): DOMRect | null {
  return typeof element?.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : null;
}

/** The history's scroll under `above`, if it is drawn. */
function scrollIn(above: HTMLElement | null): HTMLElement | null {
  if (typeof above?.querySelector !== "function") return null;
  return above.querySelector<HTMLElement>("[data-run-scroll]");
}

/** The list's row a run's chat stands in: its card's slice. */
function cardRowOf(chat: HTMLElement | null): HTMLElement | null {
  if (typeof chat?.closest !== "function") return null;
  return chat.closest<HTMLElement>("[data-card-slice]");
}
