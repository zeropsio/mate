/**
 * The crew's rows in the Crew tab — each the menu's Mate row
 * (`CrewRows.logic.ts` says what each line says): the face wearing its state,
 * the name and a time, what it is on and its current step, and what it needs
 * from you with the presses that settle it, right there; a row opens its
 * crewmate's conversation, and its ··· holds the rest.
 *
 * Motion (T-rules): rows never reorder. When a row starts needing you, its
 * face greets once, its dot fades in, what it needs unfolds from the top, and
 * the rows below slide down by transform (FLIP, 220 ms). Answer opens its box
 * right in the row, with the focus in it. Nothing moves on a first paint.
 *
 * A row reads the same to everybody; a press that runs or changes what runs
 * on a login the viewer may not run is not offered (`crewActionOffered`, D6),
 * and a row whose ··· would offer nothing has none.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { CrewAccess, CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  CREW_NEXT_WORD,
  CREW_ROW_VERBS,
  crewMenuOfWord,
  crewOpenConversationWord,
  crewRowVerbLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewCommand,
  CrewCommandResult,
  CrewSnapshot,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import { isCrewCard } from "@t3tools/shared/userAsk";
import { ArrowUpIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { agentActivitySnippet, threadAgentActivity } from "~/zerops/agentActivity";
import { useCrewTry } from "~/zerops/crew/useCrewTry";
import { createLiveStepPacer, type ShownLiveSteps, type LiveStepWords } from "~/zerops/liveStep";
import { useSecondsNowMs } from "~/zerops/useNowMs";

import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import { Menu, MenuTrigger } from "../../ui/menu";
import { MateFace } from "../primitives";
import { formatWorkingTime } from "../SidebarZeropsTree.logic";
import { crewmateMenuModel, type CrewmateMenuItemId } from "./CrewmateMenu.logic";
import { CrewmateMenuPopup } from "./CrewmateMenu";
import { CrewDots, CrewPress, CrewTip, useArrived } from "./CrewParts";
import {
  CREW_ORIGIN,
  CREW_ROW_NO_THREAD,
  crewActionOffered,
  crewNeedsByHandle,
  crewRowModel,
  type CrewRowAction,
  type CrewRowLine,
  type CrewRowModel,
  type CrewRowNeed,
  type CrewRowSlot,
  type CrewRowThread,
} from "./CrewRows.logic";

export interface CrewRowsProps {
  readonly environmentId: EnvironmentId;
  readonly snapshot: CrewSnapshot;
  readonly view: CrewView<EnvironmentThreadShell>;
  readonly mateName: string;
  /** A press of the tab's is on its way, or the crew is not current. */
  readonly busy: boolean;
  /** The last refusal's sentence at `origin`. */
  readonly errorAt: (origin: string) => string | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
  /** Sends one press; its result, or `null` when it was refused. */
  readonly onCommand: (command: CrewCommand, origin: string) => Promise<CrewCommandResult | null>;
  /** Hands the Mate a draft, confirmed first: `what` says why. */
  readonly onAsk: (ask: string, what: string) => void;
  readonly onReview: (taskId: string, from: HTMLElement) => void;
  /** A press in a row's ···. */
  readonly onMenu: (handle: string, item: CrewmateMenuItemId) => void;
  /** The lead's plan, drawn in its row while it waits for Start. */
  readonly renderPlan: (leadWords: string | null) => ReactNode;
  /** What this viewer may run or change on the crew. */
  readonly access: CrewAccess;
  /** The chat an ask for the Mate goes to is not this viewer's to run; `null` where it is. */
  readonly askLock: CrewLock | null;
}

/** A crewmate's thread as the row reads it, through the one status resolver. */
function rowThread(
  shell: EnvironmentThreadShell | null,
  lastVisitedAt: string | undefined,
  liveStep: LiveStepWords | undefined,
): CrewRowThread {
  if (shell === null) return CREW_ROW_NO_THREAD;
  const activity = threadAgentActivity(shell, lastVisitedAt);
  const preview = shell.latestUserMessagePreview?.text.trim();
  return {
    face: activity.face,
    working: activity.face === "working",
    at: shell.latestTurn === null && shell.latestUserMessageAt === null ? null : activity.at,
    liveStep: liveStep ?? null,
    asked:
      preview === undefined || preview === "" || isCrewCard(preview) ? null : maskSecrets(preview),
  };
}

/** Each working crewmate's step, paced as the menu paces its rows'. */
function usePacedSteps(
  rows: ReadonlyArray<CrewmateView<EnvironmentThreadShell>>,
  lastVisited: Readonly<Record<string, string>>,
): ReadonlyMap<string, LiveStepWords> {
  const [shown, setShown] = useState<ShownLiveSteps<string>>(new Map());
  const [pacer] = useState(() => createLiveStepPacer<string>(setShown));
  useEffect(() => () => pacer.dispose(), [pacer]);
  const latest = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const shell = row.shell;
          if (shell === null) return [row.crewmate.handle, undefined] as const;
          const key = scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id));
          return [
            row.crewmate.handle,
            threadAgentActivity(shell, lastVisited[key]).liveStep,
          ] as const;
        }),
      ),
    [lastVisited, rows],
  );
  // Before paint: a step let through now never shows its predecessor for a frame.
  useLayoutEffect(() => pacer.update(latest), [latest, pacer]);
  return useMemo(
    () => new Map([...shown].map(([handle, step]) => [handle, step.step] as const)),
    [shown],
  );
}

/**
 * The rows below one that grew slide down to where they now stand (FLIP, 220
 * ms, strong ease-out), from wherever a slide in flight has them; nothing on
 * the first paint, and nothing under reduced motion. A row grows by its own
 * state too (Answer opens its box), which the list's own render never sees:
 * the list's size is watched, and its rows are measured again before paint.
 */
function useRowsFlip(list: React.RefObject<HTMLDivElement | null>) {
  const tops = useRef(new Map<string, number>());
  const flights = useRef(new Map<string, Animation>());
  const settle = useCallback(() => {
    const element = list.current;
    if (element === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = new Set<string>();
    for (const row of element.querySelectorAll<HTMLElement>("[data-crew-row]")) {
      const key = row.dataset.crewRow ?? "";
      seen.add(key);
      const top = row.offsetTop;
      const before = tops.current.get(key);
      tops.current.set(key, top);
      if (before === undefined || before === top || still) continue;
      const flying = flights.current.get(key);
      const from =
        flying === undefined ? 0 : new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
      flying?.cancel();
      const flight = row.animate(
        [{ transform: `translateY(${before - top + from}px)` }, { transform: "translateY(0)" }],
        { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
      flights.current.set(key, flight);
      flight.onfinish = () => flights.current.delete(key);
    }
    for (const key of tops.current.keys()) {
      if (!seen.has(key)) tops.current.delete(key);
    }
  }, [list]);
  // After each render of the list: a row added, gone, or grown with it.
  useLayoutEffect(settle);
  // A row grown by its own state: the list's size changes, seen before paint.
  useEffect(() => {
    const element = list.current;
    if (element === null) return;
    const watch = new ResizeObserver(settle);
    watch.observe(element);
    return () => watch.disconnect();
  }, [list, settle]);
}

export function CrewRows(props: CrewRowsProps) {
  const { snapshot, view, mateName } = props;
  const lastVisited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const steps = usePacedSteps(view.crewmates, lastVisited);
  const needs = useMemo(
    () => crewNeedsByHandle(snapshot.attention, snapshot.crewmates),
    [snapshot.attention, snapshot.crewmates],
  );
  const list = useRef<HTMLDivElement>(null);
  useRowsFlip(list);
  return (
    <div className="mt-5 flex flex-col gap-0.5 @max-md:mt-4" data-crew-rows ref={list}>
      {view.crewmates.map((row) => {
        const shell = row.shell;
        const visited =
          shell === null
            ? undefined
            : lastVisited[scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))];
        const thread = rowThread(shell, visited, steps.get(row.crewmate.handle));
        const model = crewRowModel({
          row,
          snapshot,
          view,
          thread,
          attention: needs.get(row.crewmate.handle) ?? [],
          mateName,
        });
        return (
          <CrewRow
            {...props}
            key={row.crewmate.handle}
            leadWords={model.plan && shell !== null ? (agentActivitySnippet(shell) ?? null) : null}
            model={model}
            row={row}
          />
        );
      })}
    </div>
  );
}

const TONE_CLASS: Readonly<Record<CrewRowLine["tone"], string>> = {
  "ink-2": "crew-ink-2",
  muted: "text-muted-foreground",
  ink: "text-foreground",
  failed: "text-status-failed-text",
};

/** One line of a row: 13/18, its ink by what it says; a step's command after it, in mono. */
function RowLine({
  line,
  wraps = false,
  className = "",
}: {
  readonly line: CrewRowLine;
  readonly wraps?: boolean;
  readonly className?: string;
}) {
  return (
    <p
      className={cn(
        !wraps && "truncate",
        "text-line leading-4.5",
        TONE_CLASS[line.tone],
        className,
      )}
    >
      {line.text}
      {line.diff === undefined ? null : (
        <span className="tabular-nums">
          {" · "}
          <span className="rv-add">{`+${line.diff.insertions}`}</span>{" "}
          <span className="rv-del">{`−${line.diff.deletions}`}</span>
        </span>
      )}
    </p>
  );
}

/** The row's right edge: its working clock in ink, ticking once a second, or when it last did something. */
function RowTime({ slot }: { readonly slot: CrewRowSlot }) {
  const nowMs = useSecondsNowMs(slot.kind === "clock");
  switch (slot.kind) {
    case "none":
      return null;
    case "clock":
      return (
        <span className="crew-row-time" data-working="">
          {formatWorkingTime(nowMs - Date.parse(slot.since))}
        </span>
      );
    case "age": {
      const when = compactSidebarTimeLabel(formatRelativeTimeLabel(slot.at));
      return when === "" ? null : <span className="crew-row-time">{when}</span>;
    }
  }
}

function CrewRow(
  props: CrewRowsProps & {
    readonly row: CrewmateView<EnvironmentThreadShell>;
    readonly model: CrewRowModel;
    readonly leadWords: string | null;
  },
) {
  const { model, row, mateName } = props;
  const tries = useCrewTry(props.environmentId, model.lead ? null : model.handle);
  const needed = useArrived(model.needsYou);
  // What the row needed when the tab first drew it stands still; only what arrives after unfolds.
  const [firstNeeds] = useState(() => new Set(model.needs.map((need) => need.id)));
  const origin = CREW_ORIGIN.crewmate(model.handle);
  const error = props.errorAt(origin);
  const menu = crewmateMenuModel({
    crewmate: row.crewmate,
    mateName,
    tries:
      tries === null
        ? null
        : {
            where: tries.tries.where,
            enabled: tries.enabled,
            stops: tries.stop !== null,
            offered: tries.offered,
          },
    busy: props.busy,
    removable: true,
    lock: props.access.crewmate(model.handle),
  });
  const offered = (action: CrewRowAction) =>
    crewActionOffered(action, props.access, props.askLock, tries?.offered ?? false);
  const open = model.threadId;
  return (
    <div
      className="crew-row"
      data-crew-row={model.handle}
      data-needs={model.needsYou || model.plan ? "" : undefined}
    >
      <MateFace greets size="md" state={model.pose} tint={model.tint} />
      <div className="flex min-w-0 flex-col">
        <div className="flex h-5 items-center gap-2">
          {open === null ? (
            <span className="crew-row-open">{model.name}</span>
          ) : (
            <CrewTip tip={crewOpenConversationWord(model.name)}>
              <button
                aria-label={crewOpenConversationWord(model.name)}
                className="crew-row-open"
                onClick={() => props.onOpenThread(open)}
                type="button"
              >
                {model.name}
              </button>
            </CrewTip>
          )}
          <span className="grow" />
          {model.needsYou ? (
            <span className="crew-dot" data-arrived={needed ? "" : undefined} />
          ) : null}
          <RowTime slot={model.slot} />
          {menu.items.length === 0 ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    aria-label={crewMenuOfWord(model.name)}
                    className="crew-menu-btn crew-row-menu crew-row-above"
                    type="button"
                  />
                }
              >
                <CrewDots />
              </MenuTrigger>
              <CrewmateMenuPopup
                from="row"
                model={menu}
                onSelect={(item) => {
                  if (item === "try") tries?.press();
                  else if (item === "stop") tries?.stop?.();
                  else props.onMenu(model.handle, item);
                }}
              />
            </Menu>
          )}
        </div>
        {model.line2 === null ? null : <RowLine className="mt-0.5" line={model.line2} />}
        {model.line3 === null ? null : <RowLine line={model.line3} />}
        {model.plan ? (
          <div className="crew-reveal" data-arrived={needed ? "" : undefined}>
            {props.renderPlan(props.leadWords)}
          </div>
        ) : null}
        {model.needs.map((need, index) => (
          <CrewNeed
            {...props}
            arrived={!firstNeeds.has(need.id)}
            first={index === 0}
            key={need.id}
            need={{ ...need, actions: need.actions.filter(offered) }}
            origin={origin}
            tryPress={tries === null ? null : tries.press}
            tryEnabled={tries?.enabled ?? false}
          />
        ))}
        {model.served === null ? null : (
          <p className="mt-1 text-line leading-4.5 text-muted-foreground">
            {model.served.line.text}
            {offered(model.served.action) ? (
              <>
                <span aria-hidden="true">{" · "}</span>
                <Action {...props} action={model.served.action} origin={origin} quiet="text" />
              </>
            ) : null}
          </p>
        )}
        {model.next === null ? null : (
          <p className="mt-1.5 truncate text-line leading-4.5 text-muted-foreground">
            <span className="crew-ink-2 me-1.5 font-medium">{CREW_NEXT_WORD}</span>
            {model.next}
          </p>
        )}
        {error === null ? null : (
          <p className="mt-1.5 text-line leading-4.5 text-status-failed-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** What a row needs from you: its line, then its presses — or the answer box, once Answer opens it. */
function CrewNeed(
  props: CrewRowsProps & {
    readonly need: CrewRowNeed;
    /** It arrived while the tab watched: it unfolds. */
    readonly arrived: boolean;
    readonly first: boolean;
    readonly origin: string;
    readonly tryPress: (() => void) | null;
    readonly tryEnabled: boolean;
  },
) {
  const { need } = props;
  const [answering, setAnswering] = useState(false);
  return (
    <div
      className={cn("crew-reveal", !props.first && "mt-2.5")}
      data-arrived={props.arrived ? "" : undefined}
    >
      <RowLine line={need.line} wraps />
      {need.detail === undefined ? null : (
        <RowLine line={{ text: need.detail, tone: "muted" }} wraps />
      )}
      {answering ? (
        <AnswerBox
          {...props}
          answer={need.actions.find((action) => action.kind === "answer") ?? null}
          onDone={() => setAnswering(false)}
        />
      ) : need.actions.length === 0 ? null : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {need.actions.map((action, index) => (
            <Action
              {...props}
              action={action}
              key={action.label}
              onAnswer={() => setAnswering(true)}
              quiet={index === 0 ? "no" : "yes"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Action(
  props: CrewRowsProps & {
    readonly action: CrewRowAction;
    readonly origin: string;
    /** The first press of a row is filled; the rest are its words; `text` is a word in a line. */
    readonly quiet: "no" | "yes" | "text";
    readonly onAnswer?: () => void;
    readonly tryPress?: (() => void) | null;
    readonly tryEnabled?: boolean;
  },
) {
  const { action } = props;
  const press = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (action.kind) {
      case "answer":
        props.onAnswer?.();
        return;
      case "review":
        props.onReview(action.taskId, event.currentTarget);
        return;
      case "try":
        props.tryPress?.();
        return;
      case "ask":
        props.onAsk(action.ask, action.line);
        return;
      case "command":
        void props.onCommand(action.command, props.origin);
        return;
    }
  };
  const disabled =
    (action.kind === "command" && props.busy) ||
    (action.kind === "try" && props.tryEnabled !== true);
  if (props.quiet === "text") {
    return (
      <CrewTip tip={action.line}>
        <button
          className="crew-textbtn crew-row-above"
          disabled={disabled}
          onClick={press}
          type="button"
        >
          {action.label}
        </button>
      </CrewTip>
    );
  }
  return (
    <CrewPress
      disabled={disabled}
      label={action.label}
      line={action.line}
      onPress={press}
      tone={props.quiet === "no" ? "primary" : "quiet"}
    />
  );
}

/** The answer, right in the row that asked: the focus in it, Enter sends, Escape closes. */
function AnswerBox(
  props: CrewRowsProps & {
    readonly answer: CrewRowAction | null;
    readonly origin: string;
    readonly onDone: () => void;
  },
) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const answer = props.answer;
  if (answer?.kind !== "answer") return null;
  const ready = text.trim() !== "" && !props.busy;
  const send = () => {
    if (!ready) return;
    void props
      .onCommand(
        { _tag: "answer", handle: answer.handle, taskId: answer.taskId, text: text.trim() },
        props.origin,
      )
      .then((result) => {
        if (result !== null) props.onDone();
      });
  };
  return (
    <form
      className="crew-answer crew-row-above crew-reveal mt-2.5"
      data-arrived=""
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        aria-label={CREW_ROW_VERBS.answer}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onDone();
        }}
        ref={input}
        value={text}
      />
      <CrewTip tip={crewRowVerbLine("send", props.mateName)}>
        <button
          aria-label={CREW_ROW_VERBS.send}
          className="crew-send"
          data-ready={ready ? "" : undefined}
          disabled={!ready}
          type="submit"
        >
          <ArrowUpIcon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
        </button>
      </CrewTip>
    </form>
  );
}
