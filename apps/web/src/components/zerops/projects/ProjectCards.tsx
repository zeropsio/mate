/**
 * The overview's cards (round 5, "Mate Clean Overview"): a card per project with Mates, side by
 * side in one row that scrolls sideways under its edge fades, each card as tall as the tallest so
 * production's lines stand in one line across them.
 *
 * A card reads top to bottom: the project's name and its address; its Mates, two lines each, what
 * waits on the viewer lifted onto a white card with its buttons; a release ready to go, lifted;
 * and at its foot production's one line, which opens its panel (`projectCard.logic.ts`).
 *
 * Structural like the list it replaced: a Mate's row, the project's menu, the release's door and
 * a place's panel are the page's slots (`ZeropsProjectsFlowProps`).
 */
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useNowMs } from "~/zerops/useNowMs";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { StopReadAgain } from "../StopReadAgain";
import { heldLine } from "./emptyApps.logic";
import { ComingMateFace, drawn, GroupName, matesOf, type FlowMateEntry } from "./flowSteps";
import {
  cardReady,
  foldMates,
  foldWords,
  mateChangeForReview,
  mateIsLoud,
  placeLines,
  readyLine,
  readyTitle,
  siteOf,
  type CardMateReading,
  type PlaceLine,
} from "./projectCard.logic";
import { comingMateLine, projectRowLine, stopLine } from "./projectsView.logic";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

export const cardId = (groupId: string) => `project-${groupId}`;

/** One card's width and the gap between cards: a step of the back and forward buttons. */
const CARD_STEP = 360 + 16;

/**
 * The row of cards: one width each, side by side; past the window's edge the row scrolls sideways
 * under a fade, with a round back and forward button on the side there is more.
 */
function CardRow({ children }: { readonly children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const element = row.current;
    if (element === null) return;
    const max = element.scrollWidth - element.clientWidth;
    const next = { left: element.scrollLeft > 2, right: element.scrollLeft < max - 2 };
    setEdges((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const step = (direction: -1 | 1) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.current?.scrollBy({ left: direction * CARD_STEP, behavior: reduced ? "auto" : "smooth" });
  };
  return (
    <div
      className="ov-rail"
      data-can-left={edges.left ? "true" : undefined}
      data-can-right={edges.right ? "true" : undefined}
    >
      <div
        aria-label="Projects"
        className="ov-row"
        data-zerops-surface="project-cards"
        ref={row}
        role="list"
      >
        {children}
      </div>
      <button
        aria-label="Back"
        className="ov-nav ov-nav-left"
        onClick={() => step(-1)}
        tabIndex={-1}
        type="button"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
      </button>
      <button
        aria-label="More projects"
        className="ov-nav ov-nav-right"
        onClick={() => step(1)}
        tabIndex={-1}
        type="button"
      >
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/** A place's dot: grey running, amber failed, red down, blue releasing, hollow when none. */
export function PlaceDot({ dot }: { readonly dot: PlaceLine["dot"] }) {
  return <i aria-hidden="true" className="ov-dot" data-dot={dot} />;
}

/** A place's words, `·` between, in its state's ink. */
export function PlaceWords({ line }: { readonly line: PlaceLine }) {
  return (
    <span className="ov-place-words" data-dot={line.dot}>
      {line.words.map((word, index) => (
        <Fragment key={word}>
          {index === 0 ? null : (
            <span aria-hidden="true" className="ov-sep">
              ·
            </span>
          )}
          <span>{word}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Holds the project's detail while a panel of it is open: its releases, for History. */
function PanelHold({
  groupId,
  children,
}: {
  readonly groupId: string;
  readonly children: ReactNode;
}) {
  useHqAppDetailHold([groupId]);
  return <>{children}</>;
}

/** What a place's panel says where the page gives it nothing more: its line. */
function PlainPanel({ line }: { readonly line: PlaceLine }) {
  return (
    <div className="ov-panel">
      <div className="ov-panel-head">
        <PlaceDot dot={line.dot} />
        <b>{line.name}</b>
      </div>
      <p className="ov-panel-sub">{line.words.join(" · ")}</p>
    </div>
  );
}

/** Production's one line: its dot, its words, a chevron on hover; a click opens its panel. */
function PlaceLineRow({
  line,
  panel,
  groupId,
}: {
  readonly line: PlaceLine;
  readonly panel: ReactNode;
  readonly groupId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <button
            aria-haspopup="dialog"
            className="ov-place"
            data-open={open ? "true" : undefined}
            data-zerops-place={line.kind}
            type="button"
          />
        }
      >
        <PlaceDot dot={line.dot} />
        {line.named ? <span className="ov-place-name">{line.name}</span> : null}
        <PlaceWords line={line} />
        <ChevronRightIcon aria-hidden="true" className="ov-place-go size-3.5" />
      </PopoverTrigger>
      {open ? (
        <PopoverPopup align="start" padding="none" side="bottom" sideOffset={6}>
          <PanelHold groupId={groupId}>{panel}</PanelHold>
        </PopoverPopup>
      ) : null}
    </Popover>
  );
}

/** A Mate being created: waking, named, how far its birth has got, nothing to press. */
function CardComingMate<T>({
  mate,
}: {
  readonly mate: Extract<FlowMateEntry<T>, { kind: "coming" }>;
}) {
  return (
    <div aria-busy="true" className="ov-mate" data-zerops-surface="mate-coming" role="listitem">
      <span className="ov-mate-face">
        <ComingMateFace coming={mate.coming} size="md" />
      </span>
      <span className="ov-mate-text">
        <span className="ov-mate-l1">
          <span className="ov-mate-name">{mate.mate.name}</span>
        </span>
        <span className="ov-mate-l2">{comingMateLine(mate.coming)}</span>
      </span>
    </div>
  );
}

/** A card's Mates: past four the quiet ones fold into "N more Mates" with their faces. */
function CardMates<T>({
  entry,
  props,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const mates = matesOf(entry);
  const { shown, folded } = foldMates(mates, (mate) => mateIsLoud(mate.mate, entry.flow));
  const draw = (mate: FlowMateEntry<T>) =>
    mate.kind === "coming" ? (
      <CardComingMate key={`coming:${mate.mate.projectId}`} mate={mate} />
    ) : (
      <Fragment key={props.getKey(mate.item)}>
        {props.renderMate(mate.item, {
          layout: "row",
          preview: mate.mate.preview,
          // A change is offered for review only once the project's changes are read and known.
          review:
            entry.changesAwaiting || entry.changesUnknown !== undefined
              ? undefined
              : mateChangeForReview(entry.flow, mate.mate.projectId),
        })}
      </Fragment>
    );
  const rest = folded.filter(
    (mate): mate is Extract<FlowMateEntry<T>, { kind: "listed" }> => mate.kind === "listed",
  );
  return (
    <section aria-label="Mates" className="ov-mates" data-zerops-step="mates">
      {shown.map(draw)}
      {unfolded ? folded.map(draw) : null}
      {folded.length > 0 && !unfolded ? (
        <button className="ov-fold" onClick={() => setUnfolded(true)} type="button">
          <span className="ov-fold-faces">
            {rest.slice(0, 3).map((mate) => (
              <Fragment key={props.getKey(mate.item)}>
                {props.renderMateFace(mate.item, "sm")}
              </Fragment>
            ))}
          </span>
          <span>{foldWords(folded.length)}</span>
        </button>
      ) : null}
    </section>
  );
}

/** The stops whose read failed, by name and what they say, beside their one attempt. */
function StopReads<T>({ entry }: { readonly entry: ProjectsFlowGroup<T> }) {
  const { production, stages } = entry.flow;
  const stops = [
    ...(production.kind === "absent" || production.kind === "creating" ? [] : [production.stop]),
    ...stages,
  ];
  // Every stop is held here, so each keeps the demand that reads what it runs.
  return (
    <div className="ov-reads">
      {stops.map((stop) => (
        <span className="ov-read" data-zerops-row-stop={stop.projectId} key={stop.projectId}>
          {stop.readFailed === true ? (
            <span>
              {stop.name} · {stopLine(stop).word}
            </span>
          ) : null}
          <StopReadAgain projectId={stop.projectId} />
        </span>
      ))}
    </div>
  );
}

function ProjectCard<T>({
  entry,
  props,
  focused,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly focused: boolean;
}) {
  const nowMs = useNowMs();
  const { group, flow } = entry;
  const route = "stop" in flow.production ? flow.production.stop.route : undefined;
  const site = siteOf(route);
  const quiet = [entry.line, heldLine(flow.mates.length, entry.contents)].find(
    (line) => line !== undefined,
  );
  const ready = cardReady(flow);
  const releaseDoor = ready === undefined ? null : props.renderReleaseVerb?.(entry);
  const lines = placeLines({ flow, ...props.cardPlaces?.(entry), nowMs });
  // Why its changes are not known, said plainly where they are not.
  const unknown = projectRowLine({
    flow,
    lastMerged: entry.lastMerged,
    activities: entry.activities,
    settled: !entry.awaiting && !entry.changesAwaiting,
    changesUnknown: entry.changesUnknown,
  });
  return (
    <article
      aria-label={group.name}
      className="ov-card"
      data-focused={focused ? "true" : undefined}
      data-zerops-group={group.groupId}
      id={cardId(group.groupId)}
      role="listitem"
    >
      <header className="ov-card-head">
        <div className="ov-card-h1">
          <h2 className="ov-card-name">
            <GroupName entry={entry} />
          </h2>
          {props.renderCardPeople?.(entry)}
          <span className="ov-card-menu">{props.renderGroupMenu(entry)}</span>
        </div>
        {site !== undefined && route !== undefined ? (
          <a className="ov-card-site" href={route} rel="noreferrer" target="_blank">
            {site}
          </a>
        ) : quiet !== undefined ? (
          <p className="ov-card-site">{quiet}</p>
        ) : null}
      </header>
      <CardMates entry={entry} props={props} />
      {unknown.kind === "unread" ? (
        <p className="ov-card-note" data-zerops-row-line="unread">
          {unknown.text}
        </p>
      ) : null}
      <section aria-label="Release and production" className="ov-card-env">
        {ready === undefined ? null : (
          <div className="ov-ready" data-zerops-card-ready="true">
            <p className="ov-ready-title">{readyTitle(ready)}</p>
            <p className="ov-ready-line">{readyLine(ready)}</p>
            {drawn(releaseDoor) ? <div className="ov-acts">{releaseDoor}</div> : null}
          </div>
        )}
        <div className="ov-foot">
          {lines.map((line) => (
            <PlaceLineRow
              groupId={group.groupId}
              key={`${line.kind}:${line.projectId ?? line.name}`}
              line={line}
              panel={props.renderPlacePanel?.(entry, line) ?? <PlainPanel line={line} />}
            />
          ))}
        </div>
        <StopReads entry={entry} />
      </section>
    </article>
  );
}

/**
 * Every project with Mates, in the person's order. `focusGroup` (`?group=`) scrolls its card into
 * view and pulses it, once when it is first there, and again while cards before it arrive — until
 * the person scrolls or types for themselves.
 */
export function ProjectCards<T>({
  groups,
  props,
  focusGroup,
}: {
  readonly groups: ReadonlyArray<ProjectsFlowGroup<T>>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly focusGroup: string | undefined;
}) {
  const shown = groups.some((entry) => entry.group.groupId === focusGroup);
  const orderKey = groups.map((entry) => entry.group.groupId).join(",");
  const scrolledTo = useRef<string | undefined>(undefined);
  const following = useRef(true);
  const [pulsed, setPulsed] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (focusGroup === undefined) return;
    following.current = true;
    const stop = () => {
      following.current = false;
    };
    const intents = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const intent of intents) window.addEventListener(intent, stop, { passive: true });
    return () => {
      for (const intent of intents) window.removeEventListener(intent, stop);
    };
  }, [focusGroup]);
  useEffect(() => {
    if (!shown || focusGroup === undefined || orderKey.length === 0) return;
    if (scrolledTo.current !== focusGroup) {
      scrolledTo.current = focusGroup;
      setPulsed(focusGroup);
    } else if (!following.current) return;
    document
      .getElementById(cardId(focusGroup))
      ?.scrollIntoView({ block: "nearest", inline: "start" });
  }, [focusGroup, shown, orderKey]);
  if (groups.length === 0) return null;
  return (
    <CardRow>
      {groups.map((entry) => (
        <ProjectCard
          entry={entry}
          focused={pulsed === entry.group.groupId}
          key={entry.group.groupId}
          props={props}
        />
      ))}
    </CardRow>
  );
}

/** A Mate's two lines on a card, and what it waits on the viewer for, lifted. */
export interface CardMateProps {
  readonly name: string;
  /** Its face, 32 px, with whose it is on its corner. */
  readonly face: ReactNode;
  /** The right of its name: its time, its dot. */
  readonly time: ReactNode;
  readonly reading: CardMateReading;
  /** Drawn in place of the words where its container has something else to say. */
  readonly line?: ReactNode;
  /** Opens its conversation; `undefined` where it cannot open yet. */
  readonly onOpen: (() => void) | undefined;
  /** Its verbs while lifted (`CardMateLiftActions`), or a verb its container needs (Start). */
  readonly actions?: ReactNode;
}

/**
 * A Mate on a card: a 32 px face, its name and time, its second line. What waits on the viewer is
 * lifted onto a white card, its line in ink over two lines, its buttons under it.
 */
export function CardMate({ name, face, time, reading, line, onOpen, actions }: CardMateProps) {
  const lifted = reading.lift !== undefined;
  return (
    <div
      className="ov-mate"
      data-lift={lifted ? reading.lift?.kind : undefined}
      data-zerops-surface="card-mate"
      role="listitem"
    >
      <span className="ov-mate-face">{face}</span>
      <span className="ov-mate-text">
        <span className="ov-mate-l1">
          {onOpen === undefined ? (
            <span className="ov-mate-name">{name}</span>
          ) : (
            <button
              aria-label={`Open ${name}`}
              className="ov-mate-name ov-mate-open"
              onClick={onOpen}
              type="button"
            >
              {name}
            </button>
          )}
          <span className="ov-mate-time">{time}</span>
        </span>
        <span
          className="ov-mate-l2"
          data-tone={reading.tone}
          data-wrap={lifted ? "true" : undefined}
        >
          {line ?? reading.text}
        </span>
        {drawn(actions) ? <span className="ov-acts">{actions}</span> : null}
      </span>
    </div>
  );
}

/**
 * A lifted Mate's buttons: a plan's Approve plan and Change it…, a question's Answer…, a failure's
 * Ask <Mate> to fix it, a change's Review change. Change it… and Answer… open a reply in the card;
 * Escape gives the buttons back.
 */
export function CardMateLiftActions({
  name,
  lift,
  onApprove,
  onReply,
  onFix,
  onReview,
}: {
  readonly name: string;
  readonly lift: NonNullable<CardMateReading["lift"]>;
  readonly onApprove: () => void;
  readonly onReply: (text: string) => void;
  readonly onFix: () => void;
  readonly onReview: (from: HTMLElement) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const label = lift.kind === "plan" ? `Tell ${name} what to change` : `Answer ${name}`;
  if (replying)
    return (
      <form
        className="ov-reply"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim().length === 0) return;
          onReply(text.trim());
          setReplying(false);
          setText("");
        }}
      >
        <input
          aria-label={label}
          autoFocus
          className="ov-reply-in"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setReplying(false);
          }}
          placeholder={label}
          value={text}
        />
        <button className="ov-btn" data-main="true" type="submit">
          Send
        </button>
      </form>
    );
  switch (lift.kind) {
    case "plan":
      return (
        <>
          <button className="ov-btn" data-main="true" onClick={onApprove} type="button">
            Approve plan
          </button>
          <button className="ov-btn" onClick={() => setReplying(true)} type="button">
            Change it…
          </button>
        </>
      );
    case "question":
      return (
        <button className="ov-btn" onClick={() => setReplying(true)} type="button">
          Answer…
        </button>
      );
    case "fix":
      return (
        <button className="ov-btn" data-main="true" onClick={onFix} type="button">
          Ask {name} to fix it
        </button>
      );
    case "review":
      return (
        <button
          className="ov-btn"
          data-main="true"
          onClick={(event) => onReview(event.currentTarget)}
          type="button"
        >
          Review change
        </button>
      );
  }
}

/** The right of a Mate's name: the dot before its time (amber needs you, blue unseen, red broken). */
export function CardMateTime({
  dot,
  children,
}: {
  readonly dot: "attention" | "unread" | "failed" | undefined;
  readonly children: ReactNode;
}) {
  return (
    <>
      {dot === undefined ? null : <i aria-hidden="true" className="ov-mate-dot" data-dot={dot} />}
      {children}
    </>
  );
}
