/**
 * Needs you: the list the menu's red count opens beside the menu while anything needs the person
 * — every conversation of their Mates, their crews and their automated Mates' tasks, as one
 * decision lists them (`needsYou`). Each thing is a row with its one action, done in place where
 * it can be: a plan approved, a question or a crewmate answered, a crew's press taken, reviewed
 * crew work added to the Mate's code, a Mate that stopped asked to fix it; a change, a release or
 * crew work still to read opens its review. Beside the action a message steers what waits. A thing
 * whose action went through leaves the list, its height closing in 200 ms. Under the rows a quiet
 * line says what runs for the person and what they got today. ⌥↓ steps through them in the menu.
 *
 * The rail's count opens the same list, beside the rail (`SidebarWaitingPopover`).
 */
import { cn } from "~/lib/utils";
import { fadeFillIn } from "~/lib/loadFills";
import {
  EnvironmentId,
  ThreadId,
  type CrewCommand,
  type ProviderApprovalDecision,
} from "@t3tools/contracts";
import { crewTaskReview } from "@t3tools/client-runtime/zerops";
import { crewNeedSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { MessageSquareIcon } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";
import { buildPlanImplementationPrompt } from "~/proposedPlan";
import { findLatestProposedPlan } from "~/session-logic";
import type { FixProblem } from "~/zerops/fixRequest";
import { useOpenReview, type OpenReviewOptions } from "~/zerops/review";
import { useMateWrite } from "~/zerops/useMateWrite";
import { useCrewValue } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";

import { Failure } from "../ui/failure";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { List } from "../ui/list";
import { LogoTile } from "../ui/logo-tile";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Row } from "../ui/row";
import { SectionHeader } from "../ui/section";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { crewActionOffered, crewNeedActions, type CrewRowAction } from "./crew/CrewRows.logic";
import { mateDecision } from "./mateDecision.logic";
import { crewLandCommand } from "./review/ZeropsReview.logic";
import { RailTip } from "./SidebarRailTip";
import { MateFace } from "./primitives";
import {
  NEEDS_YOU_LINE,
  NEEDS_YOU_TITLE,
  needsYouChangesLine,
  needsYouCountsLine,
  needsYouCrewLine,
  needsYouCrewOf,
  needsYouHeldLine,
  needsYouReadyLine,
  needsYouTaskLine,
  needsYouTellLabel,
  releaseWaitingLine,
  WAITING_VERBS,
  waitingVerb,
  waitingCountWords,
  waitingTitle,
  type NeedsYouCounts,
  type WaitingItem,
  type WaitingMate,
  type WaitingMateItem,
  type WaitingRelease,
} from "~/zerops/waiting.logic";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

/** What the list asks of the menu: a Mate's conversation, its crew, the fix request's composer. */
export interface WaitingVerbs {
  readonly onOpenMate: (projectId: string) => void;
  /**
   * A task the viewer put on the Board asks them: where they answer it — their own card in the chat
   * they put it from, else the Board. Named by the Mate that holds it, or by its application.
   */
  readonly onAnswerPut: (
    task: { readonly taskId: string } & (
      | { readonly projectId: string }
      | { readonly appId: string }
    ),
  ) => void;
  /** An application's Board, the task of the viewer's that waits on them open in its panel. */
  readonly onOpenBoard: (appId: string, taskId: string) => void;
  readonly onOpenCrew: (projectId: string) => void;
  readonly onAskToFix: (projectId: string, problem: FixProblem) => void;
}

/**
 * Where the list stands: beside the menu, its title on the trigger's title line. In a phone's sheet
 * there is no beside: it hangs under the menu's head, across the screen.
 */
interface Placement {
  readonly side: "right" | "bottom";
  readonly sideOffset: number;
  readonly alignOffset: number;
}

/** The list's border, padding and half its title row: its title's centre below its top edge. */
const TITLE_CENTRE_PX = 29;
/** The air between the menu's edge and the list. */
const BESIDE_PX = 8;

function placementOf(trigger: HTMLElement): Placement {
  const box = trigger.getBoundingClientRect();
  const menu = trigger.closest('[data-sidebar="sidebar"]')?.getBoundingClientRect();
  const line = trigger.querySelector("[data-waiting-line]")?.getBoundingClientRect() ?? box;
  if (trigger.closest('[data-sidebar="sidebar"][data-mobile="true"]') !== null) {
    const head = trigger.closest('[data-slot="sidebar-header"]')?.getBoundingClientRect();
    return {
      side: "bottom",
      sideOffset: Math.round((head?.bottom ?? box.bottom) - box.bottom + BESIDE_PX),
      alignOffset: 0,
    };
  }
  return {
    side: "right",
    sideOffset: Math.round((menu?.right ?? box.right) - box.right + BESIDE_PX),
    alignOffset: Math.round(line.top + line.height / 2 - box.top - TITLE_CENTRE_PX),
  };
}

/** The list, opened from `trigger` — the menu's row, or the rail's count. */
export function SidebarWaitingPopover({
  items,
  counts,
  verbs,
  trigger,
  children,
  tooltip,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly counts: NeedsYouCounts;
  readonly verbs: WaitingVerbs;
  /**
   * The element that opens it, marked `[data-waiting-trigger]`; its `[data-waiting-line]` names
   * the line the list's title stands on.
   */
  readonly trigger: ReactElement<Record<string, unknown>>;
  readonly children?: ReactNode;
  /** What the trigger says on hover, beside it (the rail's count). */
  readonly tooltip?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({
    side: "right",
    sideOffset: 16,
    alignOffset: -5,
  });
  const anchor = useRef<HTMLElement | null>(null);
  // Nothing waits any more: the list has nothing to hold.
  const shown = open && items.length > 0;
  return (
    <Popover
      onOpenChange={(next, details) => {
        // What was pressed: the trigger the list stands beside.
        const pressed = details.event?.target;
        const from = pressed instanceof Element ? pressed.closest("[data-waiting-trigger]") : null;
        if (next && from instanceof HTMLElement) anchor.current = from;
        if (next && anchor.current !== null) setPlacement(placementOf(anchor.current));
        setOpen(next);
      }}
      open={shown}
    >
      {tooltip === undefined ? (
        <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<PopoverTrigger render={trigger} />}>{children}</TooltipTrigger>
          <TooltipPopup side="right">{tooltip}</TooltipPopup>
        </Tooltip>
      )}
      <PopoverPopup
        align={placement.side === "bottom" ? "center" : "start"}
        alignOffset={placement.alignOffset}
        aria-label={NEEDS_YOU_TITLE}
        data-zerops-surface="sidebar-waiting-list"
        padding="compact"
        side={placement.side}
        sideOffset={placement.sideOffset}
        width="xl"
      >
        <div className="text-body">
          <WaitingList
            counts={counts}
            items={items}
            onClose={() => {
              setOpen(false);
            }}
            verbs={verbs}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * A bare count of what waits on the person — the menu's headline, the rail — that opens
 * the list; hovered, it says what it counts (Needs you, the first things by name), so the
 * number never stands without its noun.
 */
export function SidebarWaitingCount({
  items,
  counts,
  verbs,
  seat,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly counts: NeedsYouCounts;
  readonly verbs: WaitingVerbs;
  /** Where it stands: beside the headline's Overview, or on the rail's Overview's corner. */
  readonly seat: "head" | "rail";
}) {
  const words = waitingCountWords(items);
  return (
    // An 18 px circle in the theme's own red, the one every other count in the app wears, so it
    // reads from across the screen. Its seat: beside Overview in the open menu; on the rail's
    // Overview's corner, the menu's ground around it cutting it out of the square.
    <span
      className={cn(
        "grid flex-none *:grid *:h-4.5 *:min-w-4.5 *:place-items-center *:rounded-full *:bg-destructive! *:px-1.25 *:text-2xs *:leading-3.5 *:font-bold *:text-fill-ink! *:tabular-nums *:transition-[background-color,scale] *:duration-150 *:ease-out-strong pointer-fine:*:hover:bg-destructive/90! *:data-popup-open:bg-destructive/90! motion-safe:*:active:scale-96",
        seat === "rail" ? "absolute -top-1.5 -right-1.5 rounded-full bg-sidebar p-0.5" : "ms-2",
      )}
    >
      <SidebarWaitingPopover
        counts={counts}
        items={items}
        tooltip={<RailTip line={words.line} name={NEEDS_YOU_TITLE} shortcut="⌥↓" />}
        trigger={
          <Button
            aria-label={words.label}
            data-waiting-trigger=""
            data-zerops-surface="sidebar-waiting"
            // It stands with the menu's fill, or arrives later into its own seat: either way it
            // fades in where it stands (`fadeFillIn`).
            ref={fadeFillIn}
            shape="round"
            // Its seat draws its red.
            variant="bare"
          />
        }
        verbs={verbs}
      >
        <span data-zerops-surface="sidebar-waiting-count">{items.length}</span>
      </SidebarWaitingPopover>
    </span>
  );
}

/**
 * The list itself: its title and what it holds, ⌥↓, each thing as a row with its one action, and
 * under them the quiet line of what runs for the person and what they got today.
 */
export function WaitingList({
  items,
  counts,
  verbs,
  onClose,
}: {
  readonly items: ReadonlyArray<WaitingItem>;
  readonly counts: NeedsYouCounts;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
}) {
  // The things whose action went through: gone from the list as their height closes, before the
  // sources say so.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const listed = items.filter((item) => !gone.has(item.key));
  return (
    <>
      <div className="px-2 pt-1.5 pb-2">
        <SectionHeader
          action={
            // A key's hint means nothing under a finger.
            <Text
              className="inline-flex items-center gap-1.5 pointer-coarse:hidden"
              variant="description"
            >
              <Kbd>⌥↓</Kbd>
              next
            </Text>
          }
          count={listed.length}
          level={3}
          line={NEEDS_YOU_LINE}
          title={NEEDS_YOU_TITLE}
        />
      </div>
      <List>
        {listed.map((item) => (
          <WaitingEntry
            item={item}
            key={item.key}
            onClose={onClose}
            onGone={() => {
              const next = new Set(gone).add(item.key);
              setGone(next);
              if (items.every((entry) => next.has(entry.key))) onClose();
            }}
            verbs={verbs}
          />
        ))}
      </List>
      <Text className="block px-2 pt-2 pb-1" data-needs-you-counts="" variant="meta">
        {needsYouCountsLine(counts)}
      </Text>
    </>
  );
}

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Its height closes in 200 ms, then it is gone; with reduced motion it fades. */
function leave(element: HTMLElement | null, done: () => void) {
  if (element === null || typeof element.animate !== "function") {
    done();
    return;
  }
  element.style.pointerEvents = "none";
  if (prefersReducedMotion()) {
    element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      fill: "forwards",
    }).onfinish = done;
    return;
  }
  const height = element.offsetHeight;
  element.style.overflow = "clip";
  element.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 120,
    easing: EASE,
    fill: "forwards",
  });
  element.animate(
    [
      { height: `${String(height)}px` },
      { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginBottom: "0px" },
    ],
    { duration: 200, easing: EASE, fill: "forwards" },
  ).onfinish = done;
}

/** What opens under a row — an answer, a message — grows in over 200 ms; reduced motion places it. */
function growIn(element: HTMLElement | null) {
  if (element === null || typeof element.animate !== "function" || prefersReducedMotion()) return;
  const height = element.offsetHeight;
  element.animate(
    [
      { height: "0px", opacity: 0 },
      { height: `${String(height)}px`, opacity: 1 },
    ],
    { duration: 200, easing: EASE },
  );
}

/** What an entry hands its row: where it leaves from, and how it says it went. */
interface EntryProps {
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
  /** Its action went through: the row closes and leaves the list. */
  readonly went: () => void;
}

function WaitingEntry({
  item,
  verbs,
  onClose,
  onGone,
}: {
  readonly item: WaitingItem;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
  readonly onGone: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const props: EntryProps = {
    verbs,
    onClose,
    went: () => {
      leave(element.current, onGone);
    },
  };
  return (
    <div data-waiting-kind={item.kind} data-waiting-key={item.key} ref={element}>
      {item.kind === "release" ? (
        <ReleaseEntry release={item.release} {...props} />
      ) : item.kind === "crew" ? (
        <CrewEntry item={item} {...props} />
      ) : item.kind === "task" ? (
        <TaskEntry item={item} {...props} />
      ) : item.kind === "asked" || item.kind === "held" ? (
        <BoardEntry item={item} {...props} />
      ) : (
        <MateEntry item={item} {...props} />
      )}
    </div>
  );
}

/**
 * One row of the list: who it is about, what waits, its one action at the row's end, and what
 * opens under it in place — an answer's field and choices, a message, a refusal — at the words'
 * edge.
 */
function EntryRow({
  lead,
  title,
  meta,
  line,
  control,
  children,
}: {
  readonly lead: ReactNode;
  readonly title: string;
  /** Whose it is, where the title alone does not say: a crewmate's Mate. */
  readonly meta?: string | undefined;
  readonly line: string | undefined;
  readonly control: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="py-1">
      <Row
        control={control}
        controlStays
        lead={<span aria-hidden="true">{lead}</span>}
        line={line === undefined || line.length === 0 ? undefined : line}
        meta={meta}
        title={title}
      />
      {children === undefined || children === null || children === false ? null : (
        <div className="flex flex-wrap gap-2 ps-13.5 pe-2.5 pb-2" ref={growIn}>
          {children}
        </div>
      )}
    </div>
  );
}

function MateLead({
  tint,
  shape,
  face,
}: {
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
}) {
  return <MateFace shape={shape} size={32} state={face} tint={tint} />;
}

/**
 * The quiet press beside a row's action that steers what waits with a message: its Mate hears it
 * in its conversation, a crewmate in its own chat.
 */
function TellButton({
  name,
  open,
  onPress,
}: {
  readonly name: string;
  readonly open: boolean;
  readonly onPress: () => void;
}) {
  const label = needsYouTellLabel(name);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-expanded={open}
            aria-label={label}
            onClick={onPress}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <MessageSquareIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ReleaseEntry({ release, onClose }: EntryProps & { readonly release: WaitingRelease }) {
  return (
    <EntryRow
      control={
        <ReviewButton
          label={WAITING_VERBS.release}
          onClose={onClose}
          target={{ kind: "release", groupId: release.groupId }}
        />
      }
      lead={<LogoTile>{release.name.trim().charAt(0).toLocaleUpperCase()}</LogoTile>}
      line={releaseWaitingLine(release)}
      title={waitingTitle({ kind: "release", key: "", release })}
    />
  );
}

/**
 * What a crewmate needs from the person, its one action read off its crew as the Crew tab reads it
 * (`crewNeedActions`, offered by `crewActionOffered`): an answer in place, a press the crew takes
 * at once (*Let it*, *Continue*, *Not now* beside it), finished work added to the Mate's code once
 * reviewed, else its review; what only the crew can show opens the crew. A message to the
 * crewmate steers it.
 */
function CrewEntry({
  item,
  verbs,
  onClose,
  went,
}: EntryProps & { readonly item: Extract<WaitingItem, { readonly kind: "crew" }> }) {
  const { crew } = item;
  const environmentId =
    crew.environmentId === undefined ? null : EnvironmentId.make(crew.environmentId);
  const { snapshot } = useCrewValue(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
  const command = useCrewCommand(environmentId);
  const openReview = useOpenReview();
  const [open, setOpen] = useState<"answer" | "tell" | null>(null);
  const { need, crewmate } = crew;
  const name = crewmate.name;
  const openCrew = () => {
    onClose();
    verbs.onOpenCrew(crew.projectId);
  };
  const send = (next: CrewCommand, after: () => void) => {
    void command.send(next, NEEDS_YOU_ORIGIN).then((result) => {
      if (result !== null) after();
    });
  };
  const row =
    need.kind === "row" ? snapshot?.attention.find((each) => each.id === need.rowId) : undefined;
  const task =
    need.kind === "ready"
      ? snapshot?.board.tasks.find((each) => each.id === need.taskId)
      : undefined;
  const actions =
    row === undefined || snapshot === null
      ? []
      : crewNeedActions(row, snapshot, crew.mateName).filter((action) =>
          crewActionOffered(action, access, null, false),
        );
  // Reviewed work the person adds themselves goes in from here; anything else is its review's.
  const lands =
    task !== undefined && task.review?.verdict === "accept"
      ? crewTaskReview({
          ownerName: name,
          mateName: crew.mateName,
          state: task.state,
          check: task.check,
          diffStat: task.diffStat,
          conflicts: [],
          waitingOn: task.waitingOn,
          landedCommit: task.landedCommit,
          reason: task.reason,
        }).primary
      : undefined;
  const press = (action: CrewRowAction) => (
    <Button
      disabled={command.pending}
      key={action.label}
      onClick={() => {
        switch (action.kind) {
          case "answer":
            setOpen(open === "answer" ? null : "answer");
            return;
          case "review":
            onClose();
            if (environmentId !== null)
              openReview({ kind: "crew-task", environmentId, taskId: action.taskId });
            return;
          case "command":
            send(action.command, went);
            return;
          case "ask":
          case "try":
            openCrew();
        }
      }}
      size="sm"
    >
      {action.label}
    </Button>
  );
  // One action per row: the crew's first press. Any other stays in the Crew panel, where the row's
  // name and line still fit beside it.
  const [first] = actions;
  const action =
    need.kind === "ready" ? (
      lands !== undefined && lands.enabled && task !== undefined ? (
        <Button
          disabled={command.pending}
          onClick={() => {
            send(crewLandCommand(task), went);
          }}
          size="sm"
        >
          {lands.label}
        </Button>
      ) : (
        <Button
          disabled={environmentId === null}
          onClick={() => {
            onClose();
            if (environmentId !== null)
              openReview({ kind: "crew-task", environmentId, taskId: need.taskId });
          }}
          size="sm"
        >
          {waitingVerb(item)}
        </Button>
      )
    ) : first !== undefined ? (
      press(first)
    ) : (
      // Not read yet, or nothing it lets the person do from here: its crew shows it.
      <Button onClick={openCrew} size="sm">
        {waitingVerb(item)}
      </Button>
    );
  const answering = open === "answer" && first?.kind === "answer" ? first : undefined;
  const line =
    need.kind === "ready"
      ? task === undefined
        ? needsYouCrewLine(need)
        : needsYouReadyLine(task.title, task.review?.verdict === "accept")
      : row !== undefined && snapshot !== null
        ? crewNeedSentence(row, snapshot, crew.mateName)
        : needsYouCrewLine(need);
  const failure = command.errorAt(NEEDS_YOU_ORIGIN) ?? undefined;
  return (
    <EntryRow
      control={
        <>
          <TellButton
            name={name}
            onPress={() => {
              setOpen(open === "tell" ? null : "tell");
            }}
            open={open === "tell"}
          />
          {action}
        </>
      }
      lead={<MateLead face="needs" shape={crewmate.shape} tint={crewmate.tint} />}
      line={line}
      meta={needsYouCrewOf(crew.mateName)}
      title={name}
    >
      {open === "tell" ? (
        <Replying
          error={failure}
          label={needsYouTellLabel(name)}
          onCancel={() => {
            setOpen(null);
          }}
          onSend={(text) => {
            send({ _tag: "message", handle: crewmate.handle, text, attachments: [] }, () => {
              setOpen(null);
            });
          }}
          placeholder={needsYouTellLabel(name)}
          replying
          sending={command.pending}
        >
          {null}
        </Replying>
      ) : answering !== undefined ? (
        <Replying
          error={failure}
          label="Your answer"
          onCancel={() => {
            setOpen(null);
          }}
          onSend={(text) => {
            send(
              { _tag: "answer", handle: answering.handle, taskId: answering.taskId, text },
              went,
            );
          }}
          placeholder={`Your answer to ${name}`}
          replying
          sending={command.pending}
        >
          {null}
        </Replying>
      ) : failure === undefined ? null : (
        <Replying error={failure} replying={false} sending={false}>
          {null}
        </Replying>
      )}
    </EntryRow>
  );
}

/** Where the list's crew presses are placed, so their refusal reads back here. */
const NEEDS_YOU_ORIGIN = "needs-you";

/**
 * An automated Mate's task waits for an answer in its conversation, where its question stands; one
 * the viewer put on the Board, on their own card in the chat they put it from.
 */
function TaskEntry({
  item,
  verbs,
  onClose,
}: EntryProps & { readonly item: Extract<WaitingItem, { readonly kind: "task" }> }) {
  const { task } = item;
  return (
    <EntryRow
      control={
        <Button
          onClick={() => {
            onClose();
            if (task.put === true) verbs.onAnswerPut(task);
            else verbs.onOpenMate(task.projectId);
          }}
          size="sm"
        >
          {waitingVerb(item)}
        </Button>
      }
      lead={<MateLead face="needs" shape={task.shape} tint={task.tint} />}
      line={needsYouTaskLine(task.title)}
      title={waitingTitle(item)}
    />
  );
}

/**
 * A Board task of the viewer's that no listed Mate says: one whose automated Mate asks them,
 * answered where they put it from, else on the Board; one whose need broke, on the Board, where
 * they drop the need or stop it.
 */
function BoardEntry({
  item,
  verbs,
  onClose,
}: EntryProps & {
  readonly item: Extract<WaitingItem, { readonly kind: "asked" | "held" }>;
}) {
  const { board } = item;
  return (
    <EntryRow
      control={
        <Button
          onClick={() => {
            onClose();
            if (item.kind === "asked")
              verbs.onAnswerPut({ appId: board.appId, taskId: board.taskId });
            else verbs.onOpenBoard(board.appId, board.taskId);
          }}
          size="sm"
        >
          {waitingVerb(item)}
        </Button>
      }
      lead={<LogoTile>{board.appName.trim().charAt(0).toLocaleUpperCase()}</LogoTile>}
      line={item.kind === "asked" ? needsYouTaskLine(board.title) : needsYouHeldLine(board.title)}
      title={waitingTitle(item)}
    />
  );
}

/**
 * A Mate's own wait: its one action — approve its plan, answer it, ask it to fix what stopped it,
 * review its changes, sign it in — and, beside it, a message that steers it.
 */
function MateEntry({
  item,
  verbs,
  onClose,
  went,
}: EntryProps & { readonly item: WaitingMateItem }) {
  const { mate } = item;
  const [open, setOpen] = useState<"answer" | "tell" | null>(null);
  const tells = mate.threadId !== undefined && mate.environmentId !== undefined;
  const asks = item.kind === "plan" || item.kind === "question";
  const tell = tells ? (
    <TellButton
      name={mate.name}
      onPress={() => {
        setOpen(open === "tell" ? null : "tell");
      }}
      open={open === "tell"}
    />
  ) : null;
  const lead = <MateLead face={mate.face} shape={mate.shape} tint={mate.tint} />;
  // A plan and a question are answered where they stand, from the conversation they were asked in.
  if (asks && mate.threadId !== undefined && mate.environmentId !== undefined)
    return (
      <MateAsks
        lead={lead}
        mate={mate}
        onClose={onClose}
        onTell={() => {
          setOpen(open === "tell" ? null : "tell");
        }}
        open={open}
        setOpen={setOpen}
        verbs={verbs}
        went={went}
      />
    );
  const action =
    item.kind === "failed" ? (
      <Button
        aria-label={`Ask ${mate.name} to fix it`}
        onClick={() => {
          verbs.onAskToFix(mate.projectId, {
            what: `${mate.name} stopped on an error`,
            error: mate.text,
            ask: "Find out why, fix it, and carry on.",
          });
          went();
          onClose();
        }}
        size="sm"
      >
        {WAITING_VERBS.failed}
      </Button>
    ) : item.kind === "change" && mate.change !== undefined ? (
      <ReviewButton
        label={waitingVerb(item)}
        onClose={onClose}
        // "Review Nova's 3 changes" goes through every one, one review after another.
        queue={mate.change.queue?.map((change) => ({
          kind: "change" as const,
          groupId: mate.change?.groupId ?? "",
          ...change,
        }))}
        target={{
          kind: "change",
          groupId: mate.change.groupId,
          repository: mate.change.repository,
          number: mate.change.number,
        }}
      />
    ) : (
      // Its conversation holds it: a sign-in, a change not read yet, a question with nowhere here
      // to answer it.
      <OpenButton label={waitingVerb(item)} mate={mate} onClose={onClose} verbs={verbs} />
    );
  return (
    <EntryRow
      control={
        <>
          {tell}
          {action}
        </>
      }
      lead={lead}
      line={mateWaitLine(item)}
      title={waitingTitle(item)}
    >
      {open === "tell" ? (
        <MateTell
          mate={mate}
          onDone={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </EntryRow>
  );
}

/** What a Mate's row says under its name: its question, its plan, its error, its change. */
function mateWaitLine(item: WaitingMateItem): string | undefined {
  if (item.kind === "change") {
    const count = item.mate.changes ?? 1;
    return count > 1 ? needsYouChangesLine(count) : item.mate.text;
  }
  return item.mate.text;
}

/**
 * A message to a Mate about what waits, sent into its conversation as the person's own words: it
 * steers the Mate and settles nothing, so the row stays until its source says otherwise; sent, or
 * Esc, the field closes.
 */
function MateTell({ mate, onDone }: { readonly mate: WaitingMate; readonly onDone: () => void }) {
  const write = useMateWrite(
    mate.environmentId === undefined ? null : EnvironmentId.make(mate.environmentId),
    mate.threadId === undefined ? null : ThreadId.make(mate.threadId),
  );
  const { sending, error, settle } = useSettle(onDone);
  return (
    <Replying
      error={error}
      label={needsYouTellLabel(mate.name)}
      onCancel={onDone}
      onSend={(text) => {
        settle(write.send(text));
      }}
      placeholder={needsYouTellLabel(mate.name)}
      replying
      sending={sending}
    >
      {null}
    </Replying>
  );
}

/** A press under way and its refusal: what every write from the list holds, and no answer. */
function useSettle(onDone: () => void) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const settle = (pending: Promise<AtomCommandResult<unknown, unknown>> | undefined) => {
    if (pending === undefined) {
      setError("Not sent: its conversation is still being read.");
      return;
    }
    setSending(true);
    setError(undefined);
    void pending.then((result) => {
      setSending(false);
      if (result._tag === "Success") onDone();
      else if (!isAtomCommandInterrupted(result)) setError("Not sent. Try again.");
    });
  };
  return { sending, error, settle };
}

function ReviewButton({
  label,
  target,
  queue,
  onClose,
}: {
  readonly label: string;
  readonly target: Parameters<ReturnType<typeof useOpenReview>>[0];
  /** Several changes reviewed together, from `target` on (`OpenReviewOptions.queue`). */
  readonly queue?: OpenReviewOptions["queue"];
  readonly onClose: () => void;
}) {
  const openReview = useOpenReview();
  return (
    <Button
      onClick={() => {
        // The list closes first, and the review opens over the page.
        onClose();
        openReview(target, { queue });
      }}
      size="sm"
    >
      {label}
    </Button>
  );
}

/** Its conversation, where the wait is acted on: its kind's verb (`WAITING_VERBS`). */
function OpenButton({
  label,
  mate,
  verbs,
  onClose,
}: {
  readonly label: string;
  readonly mate: WaitingMate;
  readonly verbs: WaitingVerbs;
  readonly onClose: () => void;
}) {
  return (
    <Button
      onClick={() => {
        onClose();
        verbs.onOpenMate(mate.projectId);
      }}
      size="sm"
    >
      {label}
    </Button>
  );
}

/**
 * A plan's and a question's row, read off the Mate's conversation as its composer reads it: a
 * plan's one action approves it, and its message says what to change; a question's opens its
 * choices and its answer under the row; an approval's choices stand there too. Anything the list
 * cannot answer in place — several questions at once — opens the conversation.
 */
function MateAsks({
  mate,
  lead,
  verbs,
  open,
  setOpen,
  onTell,
  went,
  onClose,
}: {
  readonly mate: WaitingMate;
  readonly lead: ReactNode;
  readonly verbs: WaitingVerbs;
  readonly open: "answer" | "tell" | null;
  readonly setOpen: (open: "answer" | "tell" | null) => void;
  readonly onTell: () => void;
  readonly went: () => void;
  readonly onClose: () => void;
}) {
  const write = useMateWrite(
    mate.environmentId === undefined ? null : EnvironmentId.make(mate.environmentId),
    mate.threadId === undefined ? null : ThreadId.make(mate.threadId),
  );
  const { sending, error, settle } = useSettle(went);
  // A plan's message says what to change and takes the plan's place; a question's steers it and
  // leaves the question standing.
  const told = useSettle(
    mate.kind === "plan"
      ? went
      : () => {
          setOpen(null);
        },
  );
  const { detail, requests } = write;
  const tell = <TellButton name={mate.name} onPress={onTell} open={open === "tell"} />;
  const telling =
    open === "tell" ? (
      <Replying
        error={told.error}
        label={needsYouTellLabel(mate.name)}
        onCancel={() => {
          setOpen(null);
        }}
        onSend={(text) => {
          told.settle(write.send(text, mate.kind === "plan" ? "plan" : undefined));
        }}
        placeholder={
          mate.kind === "plan" ? `Tell ${mate.name} what to change` : needsYouTellLabel(mate.name)
        }
        replying
        sending={told.sending}
      >
        {null}
      </Replying>
    ) : null;
  const row = (control: ReactNode, under: ReactNode) => (
    <EntryRow control={control} lead={lead} line={mate.text} title={mate.name}>
      {under}
    </EntryRow>
  );

  if (mate.kind === "plan") {
    const plan =
      detail === undefined
        ? null
        : findLatestProposedPlan(detail.proposedPlans, detail.latestTurn?.turnId ?? null);
    return row(
      <>
        {tell}
        <Button
          disabled={plan === null || sending}
          onClick={() => {
            if (plan !== null)
              settle(write.send(buildPlanImplementationPrompt(plan.planMarkdown), "default"));
          }}
          size="sm"
        >
          Approve plan
        </Button>
      </>,
      telling ??
        (error === undefined ? null : (
          <Replying error={error} replying={false} sending={sending}>
            {null}
          </Replying>
        )),
    );
  }

  const decision =
    detail === undefined && requests.approvals.length === 0 && requests.userInputs.length === 0
      ? { kind: "reading" as const }
      : mateDecision({
          name: mate.name,
          kind: requests.approvals.length > 0 ? "approval" : "input",
          read: detail !== undefined,
          approvals: requests.approvals,
          userInputs: requests.userInputs,
          failure: undefined,
        });
  const answerPress = (
    <Button
      aria-expanded={open === "answer"}
      disabled={decision?.kind === "reading" || sending}
      onClick={() => {
        setOpen(open === "answer" ? null : "answer");
      }}
      size="sm"
    >
      {WAITING_VERBS.question}
    </Button>
  );
  if (decision?.kind === "approval") {
    return row(
      <>
        {tell}
        {answerPress}
      </>,
      telling ??
        (open === "answer" ? (
          <Replying error={error} replying={false} sending={sending}>
            {decision.choices.map((choice) => (
              <Button
                disabled={sending}
                key={choice.value}
                onClick={() => {
                  settle(
                    write.decide(decision.requestId, choice.value as ProviderApprovalDecision),
                  );
                }}
                size="sm"
                variant={choice.primary ? "primary" : "secondary"}
              >
                {choice.label}
              </Button>
            ))}
          </Replying>
        ) : null),
    );
  }
  if (decision?.kind === "question") {
    return row(
      <>
        {tell}
        {answerPress}
      </>,
      telling ??
        (open === "answer" ? (
          <Replying error={error} replying={false} sending={sending}>
            {decision.choices.map((choice) => (
              <Button
                disabled={sending}
                key={choice.value}
                onClick={() => {
                  settle(write.answer(decision.requestId, decision.questionId, choice.value));
                }}
                size="sm"
                variant="secondary"
              >
                {choice.label}
              </Button>
            ))}
            {decision.allowText ? (
              <AnswerField
                label="Your answer"
                onSend={(text) => {
                  settle(write.answer(decision.requestId, decision.questionId, text));
                }}
                placeholder={`Your answer to ${mate.name}`}
                sending={sending}
              />
            ) : null}
          </Replying>
        ) : null),
    );
  }
  // Still being read: its answer's way in stands, waiting for what it asks.
  if (decision?.kind === "reading")
    return row(
      <>
        {tell}
        {answerPress}
      </>,
      telling,
    );
  // More than the list can answer in place: its conversation.
  return row(
    <>
      {tell}
      <OpenButton label={WAITING_VERBS.question} mate={mate} onClose={onClose} verbs={verbs} />
    </>,
    telling,
  );
}

/** A one-line answer beside a question's choices: Enter sends it. */
function AnswerField({
  label,
  placeholder,
  sending,
  onSend,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly sending: boolean;
  readonly onSend: (text: string) => void;
}) {
  return (
    <Replying
      error={undefined}
      label={label}
      onSend={onSend}
      placeholder={placeholder}
      replying
      sending={sending}
    >
      {null}
    </Replying>
  );
}

/**
 * An item's buttons, or the one-line reply that takes their place: Enter sends, Esc gives the
 * buttons back.
 */
export function Replying({
  children,
  replying,
  sending,
  error,
  placeholder,
  label,
  onSend,
  onCancel,
}: {
  readonly children: ReactNode;
  readonly replying: boolean;
  readonly sending: boolean;
  readonly error: string | undefined;
  readonly placeholder?: string;
  readonly label?: string;
  readonly onSend?: (text: string) => void;
  readonly onCancel?: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (replying) field.current?.focus({ preventScroll: true });
  }, [replying]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      const text = event.currentTarget.value.trim();
      if (text.length === 0 || sending) return;
      event.preventDefault();
      onSend?.(text);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel?.();
    }
  };
  return (
    <>
      {replying ? (
        <InputGroup className="basis-full">
          <InputGroupInput
            aria-label={label}
            disabled={sending}
            nativeInput
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={field}
            type="text"
          />
          <InputGroupAddon align="inline-end">
            <Kbd>↵</Kbd>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        children
      )}
      {error === undefined ? null : (
        <Failure cause={error} className="mt-2 basis-full" role="alert" size="line" />
      )}
    </>
  );
}
