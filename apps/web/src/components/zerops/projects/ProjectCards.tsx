/**
 * The overview's cards: a card per project with Mates, side by side in a strip that scrolls.
 *
 * A card reads top to bottom, what stands now first and what happened last: the project's name,
 * its people and its menu; production and each stage in full (`PlacePanel`); a release ready to
 * go; its Mates, each with its previews; and the latest changes, open and merged, with where each
 * went (`projectCard.logic.ts`).
 *
 * Structural like the list it replaced: a Mate's row, the project's menu, the release's door and
 * a place's panel are the page's slots (`ZeropsProjectsFlowProps`).
 */
import { environmentDoorLabel, PUT_LIVE_AFTER_CREATION } from "~/zerops/putLive.logic";
import { ArrowUpRightIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { REVIEW_LABEL } from "@t3tools/client-runtime/zerops";
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { Link } from "@tanstack/react-router";
import { useHqAppDetailHold, useHqAppDetails } from "~/zerops/useHqAppDetail";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { rememberOverviewCards } from "~/zerops/overviewCardCount";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { formatElapsed } from "~/components/ui/progress.logic";
import { MateDot } from "../MateDot";
import { StopReadAgain } from "../StopReadAgain";
import { heldLine } from "./emptyApps.logic";
import { ProjectCardStandIn } from "./OverviewStandIn";
import { ComingMateFace, drawn, GroupName, matesOf, type FlowMateEntry } from "./flowSteps";
import {
  cardChangeRows,
  cardReady,
  foldMates,
  foldWords,
  mateChangeForReview,
  mateIsLoud,
  placeLabel,
  placeLines,
  readyLine,
  readyTitle,
  type CardChange,
  type CardMateReading,
  type PlaceLine,
} from "./projectCard.logic";
import { comingMateLine, projectRowLine, stopLine } from "./projectsView.logic";
import { ProjectPageSpend, ProjectSpendSection } from "./ProjectSpend";
import { ChangeRow } from "./ChangeRow";
import { ProjectPageHistory } from "./ProjectHistory";
import { spendProjectIds } from "./projectSpend.logic";
import type {
  ProjectsFlowGroup,
  StageSettingUp,
  ZeropsProjectsFlowProps,
} from "./ZeropsProjectsFlow";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export const cardId = (groupId: string) => `project-${groupId}`;

/** One card's width and the gap between cards: a step of the back and forward buttons. */
const CARD_STEP = 380 + 16;

/**
 * The row of cards: one width each, side by side; past the window's edge the row scrolls sideways
 * under a fade, with a round back and forward button on the side there is more.
 */
function CardRow({
  children,
  contentsKey,
}: {
  readonly children: ReactNode;
  readonly contentsKey: string;
}) {
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
    // A different set starts at its first card; scroll snap must not retain a filtered card.
    if (element === null) return;
    element.scrollLeft = 0;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer?.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure, contentsKey]);
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

/** A place's dot: green running, amber failed, red down, blue releasing, hollow when none. */
export function PlaceDot({ dot }: { readonly dot: PlaceLine["dot"] }) {
  return <i aria-hidden="true" className="ov-dot" data-dot={dot} />;
}

/** A place's words, `·` between, in its state's ink — and the clock of a wait it is in. */
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
      {line.clock === undefined ? null : <PlaceClock clock={line.clock} />}
    </span>
  );
}

/** How long a place's wait has run: it ticks here alone, never the card. */
function PlaceClock({ clock }: { readonly clock: NonNullable<PlaceLine["clock"]> }) {
  const nowMs = useSecondsNowMs(true);
  return (
    <>
      <span aria-hidden="true" className="ov-sep">
        ·
      </span>
      <span className="tabular-nums">{formatElapsed(nowMs - clock.since)}</span>
    </>
  );
}

/** A stage's services' line while they are read: its height, nothing in it. */
export function ServicesHeld() {
  return (
    <p aria-hidden="true" className="ov-panel-services" data-zerops-services-held="">
      <span className="ov-service">{"\u200b"}</span>
    </p>
  );
}

/**
 * A button's room while what it opens is on its way: the button it becomes, unseen and out of
 * reach — production's first release brings its History as it lands, into the room it held.
 */
export function ActionHeld({ children }: { readonly children: string }) {
  return (
    <span aria-hidden="true" className="contents invisible" data-zerops-action-held="" inert>
      <Button tabIndex={-1} variant="secondary">
        {children}
      </Button>
    </span>
  );
}

/** How long a card waits for its detail before it paints what it has: HQ may not answer. */
const DETAIL_PATIENCE_MS = 3_000;

/**
 * Holds the project's detail — its releases, its merged changes — while its card is on screen or
 * one card's width from it: what production's release brought and where each merged change went
 * are read for the cards a person can see, never for the whole organization at once.
 *
 * `answered` once HQ said the detail, or why not, or past its patience: until then the card stands
 * in, so it paints once, whole (the onboarding run's card said "No changes yet" and grew 106 px a
 * frame later). Outside an account there is no detail to wait for.
 */
function useDetailWhileSeen(groupId: string) {
  // The element the card stands as — its stand-in, then itself: watched whichever it is.
  const [element, ref] = useState<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);
  const [painted, setPainted] = useState(false);
  const orgId = useAccountOrgId();
  const appIds = useMemo(() => [groupId], [groupId]);
  const read = useHqAppDetails(appIds)[groupId];
  const answered =
    painted ||
    orgId === null ||
    waitedOut ||
    read?.read === "read" ||
    (read?.failure ?? null) !== null;
  // Painted once, a card stays painted: letting its detail go off screen takes nothing back.
  if (answered && !painted) setPainted(true);
  useEffect(() => {
    if (answered || !seen) return;
    const timer = setTimeout(() => setWaitedOut(true), DETAIL_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [answered, seen]);
  useEffect(() => {
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      // A busy page gets several of its reports in one call, oldest first: the last says where it
      // stands now. Read first, a card mounted out of sight under the overview's wait stood in
      // for good once it came into sight (State Smoke, 2026-10-27).
      (records) => {
        setSeen(records.at(-1)?.isIntersecting === true);
      },
      { rootMargin: `0px ${String(CARD_STEP)}px` },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  useHqAppDetailHold(seen ? [groupId] : NO_GROUPS);
  return { ref, answered };
}

const NO_GROUPS: ReadonlyArray<string> = [];

/** A stage the project does not have yet, as its card names it where one would stand. */
const NEW_STAGE: PlaceLine = {
  projectId: undefined,
  kind: "stage",
  name: "stage",
  dot: "none",
  words: [],
  trouble: false,
  addresses: [],
};

/**
 * A stage's line while it is being added: the step under way, and how long the adding has run —
 * the words its own reading takes over once the adding ends. A card's line has no room for what it
 * usually takes.
 */
function settingUpLine(line: PlaceLine, settingUp: StageSettingUp | undefined): PlaceLine {
  const since = settingUp?.startedAtMs ?? null;
  return {
    ...line,
    dot: "unknown",
    words: [settingUp?.step ?? "Setting up…"],
    trouble: false,
    clock: since === null ? undefined : { since },
  };
}

/**
 * Production's line while a release this tab sent is on its way: said once, with the clock of the
 * run that sent it.
 */
function releaseClock(line: PlaceLine, since: number | undefined): PlaceLine {
  return line.dot === "releasing" && since !== undefined ? { ...line, clock: { since } } : line;
}

/**
 * What a place says where the page gives it nothing more: its name and its line — and, for a stage
 * being set up, its services' line held, so the stage it becomes takes the same room.
 */
function PlainPanel({ line, held = false }: { readonly line: PlaceLine; readonly held?: boolean }) {
  return (
    <div className="ov-panel">
      <div className="ov-panel-head">
        <b className="ov-panel-name">{placeLabel(line)}</b>
      </div>
      <p className="ov-panel-state">
        <PlaceDot dot={line.dot} />
        <PlaceWords line={line} />
      </p>
      {held ? <ServicesHeld /> : null}
    </div>
  );
}

/**
 * A place not set up yet, by its way to be: its name, and the button that sets it up — kept, not
 * to be pressed, while another environment is being set up (`"busy"`).
 */
function SetUpPanel({
  line,
  onSetUp,
}: {
  readonly line: PlaceLine;
  readonly onSetUp: (() => void) | "busy";
}) {
  return (
    <div className="ov-panel" data-zerops-place-setup={line.kind}>
      <div className="ov-panel-head">
        <b className="ov-panel-name">{placeLabel(line)}</b>
      </div>
      {/* A place's door, as its others are: Roll back, Put it on your domain. */}
      <div className="flex">
        <Button
          disabled={onSetUp === "busy"}
          onClick={onSetUp === "busy" ? undefined : onSetUp}
          size="sm"
          variant="secondary"
        >
          <PlusIcon aria-hidden="true" />
          {environmentDoorLabel(line.kind, placeLabel(line))}
        </Button>
      </div>
      {onSetUp === "busy" && line.kind === "production" ? (
        <p className="ov-panel-note" data-tone="muted" role="status">
          {PUT_LIVE_AFTER_CREATION}
        </p>
      ) : null}
    </div>
  );
}

/** How long ago a change last moved, as a menu row says its time: "3h", "2d". */
/**
 * A card's latest changes: each with its Mate's face, what it is, whose, and where it stands — a
 * click opens it — with the releases cut among them and production's marked (`cardChangeRows`).
 */
export function CardChanges({
  changes,
  changesKnown = true,
  changesFailure,
  releases = [],
  face,
  mateName,
  onOpen,
  unknown,
}: {
  readonly changes: ReadonlyArray<CardChange>;
  /** HQ has told the project's changes: until then none listed is no answer (`changesKnown`). */
  readonly changesKnown?: boolean;
  /** Why they are not told — HQ refuses them to this person, or does not answer — in its words. */
  readonly changesFailure?: string | undefined;
  /** Newest first, as the flow lists them. */
  readonly releases?: ReadonlyArray<{
    readonly tag: string;
    readonly taggedAt: string;
    readonly live: boolean;
  }>;
  /** The face of the Mate a change is from, where the card holds it. */
  readonly face?: ((projectId: string) => ReactNode) | undefined;
  readonly mateName: (projectId: string) => string | undefined;
  readonly onOpen: (change: CardChange, from: HTMLElement) => void;
  /** Why its changes are not known, where HQ did not tell them (`changesUnknownOf`). */
  readonly unknown?: string | undefined;
}) {
  const rows = cardChangeRows(changes, releases);
  return (
    <section aria-label="Changes" className="ov-sec" data-zerops-surface="card-changes">
      <h3 className="ov-sec-name">Changes</h3>
      {rows.length === 0 ? (
        unknown !== undefined ? (
          <p className="ov-sec-empty">{unknown}</p>
        ) : changesFailure !== undefined ? (
          <p className="ov-sec-empty">{changesFailure}</p>
        ) : changesKnown ? (
          <p className="ov-sec-empty">No changes yet — a Mate opens one as it works.</p>
        ) : (
          // Until HQ answers, its line's place is held: the card does not grow when it lands.
          <p aria-hidden="true" className="ov-sec-empty" data-zerops-changes-held="" />
        )
      ) : (
        <ul className="ov-changes">
          {rows.map((row) => {
            if (row.kind === "release")
              return (
                <li
                  className="ov-change-release"
                  data-zerops-surface="card-release"
                  key={`release:${row.tag}`}
                >
                  <span className="ov-release-tag">{row.tag}</span>
                  {row.live ? <span className="ov-release-live">Production</span> : null}
                </li>
              );
            const { change } = row;
            const by = mateName(change.pull.mateProjectId);
            return (
              <ChangeRow
                at={change.at}
                face={face?.(change.pull.mateProjectId)}
                key={`${change.pull.repository}#${String(change.pull.number)}`}
                line={by === undefined ? change.words : `${by} · ${change.words}`}
                onOpen={(from) => {
                  onOpen(change, from);
                }}
                open={change.open}
                pull={change.pull}
                tone={change.tone}
              />
            );
          })}
        </ul>
      )}
    </section>
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
        <ComingMateFace coming={mate.coming} size={24} />
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

/**
 * A card's Mates: past four the quiet ones fold into "N more Mates" with their faces. On the
 * project's page every one is drawn, and *Add a Mate* closes the list.
 */
function CardMates<T>({
  entry,
  props,
  all = false,
  onAdd,
  addWhy = null,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly all?: boolean;
  readonly onAdd?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press: *Add a Mate* stands off with it. */
  readonly addWhy?: string | null;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const mates = matesOf(entry);
  const { shown, folded } = all
    ? { shown: mates, folded: [] }
    : foldMates(mates, (mate) => mateIsLoud(mate.mate, entry.flow));
  const draw = (mate: FlowMateEntry<T>) =>
    mate.kind === "coming" ? (
      <CardComingMate key={`coming:${mate.mate.projectId}`} mate={mate} />
    ) : (
      <Fragment key={props.getKey(mate.item)}>
        {props.renderMate(mate.item, {
          layout: "row",
          parts: mate.mate.parts ?? [],
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
    <section aria-label="Project Mates" className="ov-sec ov-mates" data-zerops-step="mates">
      <h3 className="ov-sec-name">Project Mates</h3>
      {shown.map(draw)}
      {unfolded ? folded.map(draw) : null}
      {folded.length > 0 && !unfolded ? (
        <button className="ov-fold" onClick={() => setUnfolded(true)} type="button">
          <span className="ov-fold-faces">
            {rest.slice(0, 3).map((mate) => (
              <Fragment key={props.getKey(mate.item)}>
                {props.renderMateFace(mate.item, 20)}
              </Fragment>
            ))}
          </span>
          <span>{foldWords(folded.length)}</span>
        </button>
      ) : null}
      {onAdd === undefined ? null : addWhy === null ? (
        <button className="ov-add" data-zerops-surface="add-mate" onClick={onAdd} type="button">
          <span aria-hidden="true" className="ov-add-face">
            <PlusIcon className="size-4" />
          </span>
          <span>Add a Mate</span>
        </button>
      ) : (
        <button
          aria-describedby={`${entry.group.groupId}-add-why`}
          className="ov-add"
          data-zerops-surface="add-mate"
          disabled
          type="button"
        >
          <span aria-hidden="true" className="ov-add-face">
            <PlusIcon className="size-4" />
          </span>
          <span className="ov-add-words">
            <span>Add a Mate</span>
            <span className="ov-add-why" data-part="why" id={`${entry.group.groupId}-add-why`}>
              {addWhy}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}

/** The stops whose read failed, by name and what they say, beside their one attempt. */
function StopReads<T>({ entry }: { readonly entry: ProjectsFlowGroup<T> }) {
  const { production, stages } = entry.flow;
  const stops = [
    ...(production.kind === "absent" ||
    production.kind === "unread" ||
    production.kind === "creating"
      ? []
      : [production.stop]),
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
  page,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly focused: boolean;
  /** Drawn as its own page's card: every Mate unfolded, *Add a Mate* at their foot. */
  readonly page?:
    | {
        readonly onAddMate?: (() => void) | undefined;
        readonly addMateWhy?: string | null;
        readonly people?: ReactNode;
      }
    | undefined;
}) {
  const nowMs = useNowMs();
  const { group, flow } = entry;
  const detail = useDetailWhileSeen(group.groupId);
  const quiet = [entry.line, heldLine(flow.mates.length, entry.contents)].find(
    (line) => line !== undefined,
  );
  // A release on its way is production's line alone ("Releasing v0.1.0"): the run's card said it
  // twice, there and in a block of its own.
  const ready = cardReady(flow);
  const releaseDoor = ready === undefined ? null : props.renderReleaseVerb?.(entry);
  // The page's door decides whether a release is offered here at all (Put it live releases the
  // production it makes); where the page gives none, the card says what the flow says.
  const releaseShown = props.renderReleaseVerb === undefined || drawn(releaseDoor);
  // A stage being added says how far it has got on its own line, where the stage stands.
  const settingUp = props.stageSettingUp?.(entry);
  const placeFacts = props.cardPlaces?.(entry);
  const readyWhere = ready === undefined ? undefined : readyLine(ready, placeFacts?.releaseOnStage);
  // No stage yet: where one would stand, the way to add it — or that one is being set up.
  const stageSetUp =
    flow.stages.length > 0
      ? undefined
      : flow.creatingStages.length > 0 || settingUp !== undefined
        ? ("creating" as const)
        : props.setUpStage?.(entry);
  const addMate = page === undefined ? props.addMate?.(entry) : undefined;
  const lines = placeLines({ flow, ...placeFacts, nowMs }).map((line) =>
    line.kind === "stage" && settingUp !== undefined
      ? settingUpLine(line, settingUp)
      : line.kind === "production"
        ? releaseClock(line, placeFacts?.releaseSince)
        : line,
  );
  // Production first — what a person runs for others — then each stage behind it.
  const places = [
    ...lines.filter((line) => line.kind === "production"),
    ...lines.filter((line) => line.kind === "stage"),
  ];
  // Why its changes are not known, said plainly where they are not.
  const unknown = projectRowLine({
    flow,
    lastMerged: entry.lastMerged,
    activities: entry.activities,
    settled: !entry.awaiting && !entry.changesAwaiting,
    changesUnknown: entry.changesUnknown,
  });
  if (!detail.answered)
    return (
      <ProjectCardStandIn
        id={page === undefined ? cardId(group.groupId) : undefined}
        label={group.name}
        page={page !== undefined}
        ref={detail.ref}
      />
    );
  return (
    <article
      aria-label={group.name}
      className="ov-card"
      data-focused={focused ? "true" : undefined}
      data-page={page === undefined ? undefined : "true"}
      data-zerops-group={group.groupId}
      id={page === undefined ? cardId(group.groupId) : undefined}
      ref={detail.ref}
      role={page === undefined ? "listitem" : undefined}
    >
      <header className="ov-card-head">
        <div className="ov-card-h1">
          {/* On its own page the card's name is the page's heading. */}
          {page === undefined ? (
            <h2 className="ov-card-name">
              {/* The name opens the project's page; ··· and every other control keep their own. */}
              <Link
                className="ov-card-title"
                params={{ groupId: group.groupId }}
                to="/group/$groupId/flow"
              >
                <GroupName entry={entry} />
              </Link>
            </h2>
          ) : (
            <h1 className="ov-card-name">
              <GroupName entry={entry} />
            </h1>
          )}
          {props.renderCardPeople?.(entry)}
          <span className="ov-card-menu">{props.renderGroupMenu(entry)}</span>
        </div>
        {quiet === undefined ? null : <p className="ov-card-site">{quiet}</p>}
      </header>
      {places.map((line) => {
        const setUp =
          line.kind === "production" && flow.production.kind === "absent"
            ? props.setUpProduction?.(entry)
            : undefined;
        return (
          <section
            className="ov-sec"
            data-zerops-place={line.kind}
            data-zerops-setting-up={
              line.kind === "stage" && settingUp !== undefined ? "true" : undefined
            }
            key={`${line.kind}:${line.projectId ?? line.name}`}
          >
            {setUp === undefined ? (
              (props.renderPlacePanel?.(entry, line) ?? <PlainPanel line={line} />)
            ) : (
              <SetUpPanel line={line} onSetUp={setUp} />
            )}
            {/* A release or Put it live run is production's, never a Mate's conversation's. */}
            {line.kind === "production" ? props.renderProductionRun?.(entry) : null}
          </section>
        );
      })}
      {stageSetUp === undefined ? null : (
        <section
          className="ov-sec"
          data-zerops-place="stage"
          data-zerops-setting-up={stageSetUp === "creating" ? "true" : undefined}
        >
          {stageSetUp === "creating" ? (
            <PlainPanel held line={settingUpLine(NEW_STAGE, settingUp)} />
          ) : (
            <SetUpPanel line={NEW_STAGE} onSetUp={stageSetUp} />
          )}
        </section>
      )}
      {ready === undefined || !releaseShown ? null : (
        <section className="ov-sec" data-zerops-card-ready="true">
          <p className="ov-ready-title">{readyTitle(ready)}</p>
          {readyWhere === undefined ? null : <p className="ov-ready-line">{readyWhere}</p>}
          {drawn(releaseDoor) ? <div className="ov-acts">{releaseDoor}</div> : null}
        </section>
      )}
      <CardMates
        addWhy={page?.addMateWhy ?? addMate?.why ?? null}
        all={page !== undefined}
        entry={entry}
        onAdd={page?.onAddMate ?? addMate?.onAdd}
        props={props}
      />
      {page?.people}
      {/* Its changes say why they are unknown where the card draws them. */}
      {unknown.kind === "unread" && props.renderChanges === undefined ? (
        <p className="ov-card-note" data-zerops-row-line="unread">
          {unknown.text}
        </p>
      ) : null}
      {/* The latest changes last: their merged rows are read with the app's detail once the card
          is in view, and at the foot they extend the card without moving what stands above —
          over the Mates, they pushed them down 100–300 px at 1.3 s. */}
      {props.renderChanges?.(entry)}
      <StopReads entry={entry} />
    </article>
  );
}

/**
 * A project's own page: its card, the same one the overview draws, at the page's width with every
 * Mate in it — and the page's column beside it, which says what a card has no room for.
 */
export function ProjectPage<T>({
  entry,
  props,
  aside,
  onAddMate,
  addMateWhy = null,
  people,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly aside: ReactNode;
  readonly onAddMate?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press. */
  readonly addMateWhy?: string | null;
  /** Who can work on it, under its Mates. */
  readonly people?: ReactNode;
}) {
  const { group, flow } = entry;
  const spendIds = useMemo(() => spendProjectIds(flow), [flow]);
  return (
    <div className="ov-page" data-zerops-surface="project-page">
      <ProjectCard
        entry={entry}
        focused={false}
        page={{ onAddMate, addMateWhy, people }}
        props={props}
      />
      {/* Its spend and its History are sections of the column, which the page's flow alone can
          name the parts of. */}
      <ProjectPageSpend value={<ProjectSpendSection appId={group.groupId} projectIds={spendIds} />}>
        <ProjectPageHistory value={props.renderHistory?.(entry) ?? null}>
          <div className="ov-page-aside">{aside}</div>
        </ProjectPageHistory>
      </ProjectPageSpend>
    </div>
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
  // What the next load's stand-in draws (`OverviewCardsStandIn`).
  useEffect(() => {
    rememberOverviewCards(groups.length);
  }, [groups.length]);
  if (groups.length === 0) return null;
  return (
    <CardRow contentsKey={orderKey}>
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
  /**
   * Its parts (`mateParts`), each a chip on its name's line by the part's name: a door to its
   * preview, or to its dev where it has no preview, or muted with why where it has neither.
   */
  readonly parts?: ReadonlyArray<MatePart> | undefined;
  /** Drawn in place of the words where its container has something else to say. */
  readonly line?: ReactNode;
  /** Opens its conversation; `undefined` where it cannot open yet. */
  readonly onOpen: (() => void) | undefined;
  /** Its verbs while lifted (`CardMateLiftActions`), or a verb its container needs (Start). */
  readonly actions?: ReactNode;
  /** The mark after its name: an automated Mate's (`MateAutomatedMark`); absent, none. */
  readonly mark?: ReactNode;
}

/**
 * A Mate on a card: a 32 px face, its name and time, its second line. What waits on the viewer is
 * lifted onto a white card, its line in ink over two lines, its buttons under it.
 */
export function CardMate({
  name,
  face,
  time,
  reading,
  parts = [],
  line,
  onOpen,
  actions,
  mark,
}: CardMateProps) {
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
          {mark}
          {parts.length === 0 ? null : (
            <span className="ov-mate-parts" data-zerops-surface="card-mate-parts">
              {parts.map((part) => (
                <CardMatePart key={part.key} mate={name} part={part} />
              ))}
            </span>
          )}
          <span className="ov-mate-time">{time}</span>
        </span>
        {/* Cut at the card's edge, its whole is the row's press away: its conversation. */}
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
 * A part's chip on a Mate's row: a door to its preview, else to its dev, by the part's name; muted,
 * with why in its title, where it has neither address.
 */
function CardMatePart({ mate, part }: { readonly mate: string; readonly part: MatePart }) {
  const door =
    part.preview?.url === undefined
      ? part.dev.find((entry) => entry.url !== undefined)
      : part.preview;
  const url = door?.url;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          url === undefined ? (
            <span className="ov-mate-preview" data-off="" />
          ) : (
            <a
              aria-label={`Open ${mate}'s ${part.name} ${door?.label === "preview" ? "preview" : "dev"}`}
              className="ov-mate-preview"
              href={url}
              rel="noreferrer"
              target="_blank"
            />
          )
        }
      >
        {part.name}
        {url === undefined ? null : <ArrowUpRightIcon aria-hidden="true" className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {url === undefined ? (part.preview?.why ?? "no address yet") : door?.host}
      </TooltipPopup>
    </Tooltip>
  );
}

const NO_CHOICES: ReadonlyArray<CardMateChoice> = [];

/** A choice a lifted Mate offers in place: a question's option, an approval's decision. */
export interface CardMateChoice {
  readonly label: string;
  readonly primary: boolean;
  readonly onPick: () => void;
}

/**
 * A lifted Mate's buttons: a plan's Approve plan and Change it…, a question's options and
 * Answer…, a failure's Ask <Mate> to fix it, a change's Review. Change it… and Answer…
 * open a reply in the card; Escape gives the buttons back. What its conversation answers in
 * place (`useMateWrite`) is the page's: `busy` while a send is on its way, `error` when it failed.
 */
export function CardMateLiftActions({
  name,
  lift,
  onApprove,
  onReply,
  onFix,
  onReview,
  choices = NO_CHOICES,
  allowText = true,
  busy = false,
  error,
}: {
  readonly name: string;
  readonly lift: NonNullable<CardMateReading["lift"]>;
  /** Approves the plan in place; `undefined` while its plan is still being read. */
  readonly onApprove: (() => void) | undefined;
  readonly onReply: (text: string) => void;
  readonly onFix: () => void;
  readonly onReview: (from: HTMLElement) => void;
  /** A question's options, an approval's choices. */
  readonly choices?: ReadonlyArray<CardMateChoice>;
  /** Whether it takes an answer in words. */
  readonly allowText?: boolean;
  readonly busy?: boolean;
  readonly error?: string | undefined;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const label = lift.kind === "plan" ? `Tell ${name} what to change` : `Answer ${name}`;
  const said =
    error === undefined ? null : (
      <span className="ov-act-error" role="status">
        {error}
      </span>
    );
  if (replying)
    return (
      <>
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
          <Button disabled={busy} type="submit">
            Send
          </Button>
        </form>
        {said}
      </>
    );
  switch (lift.kind) {
    case "plan":
      return (
        <>
          <Button disabled={onApprove === undefined || busy} onClick={onApprove}>
            Approve plan
          </Button>
          <Button disabled={busy} onClick={() => setReplying(true)} variant="secondary">
            Change it…
          </Button>
          {said}
        </>
      );
    case "question":
      return (
        <>
          {choices.map((choice) => (
            <Button
              disabled={busy}
              key={choice.label}
              onClick={choice.onPick}
              variant={choice.primary ? "primary" : "secondary"}
            >
              {choice.label}
            </Button>
          ))}
          {allowText ? (
            <Button disabled={busy} onClick={() => setReplying(true)} variant="secondary">
              Answer…
            </Button>
          ) : null}
          {said}
        </>
      );
    case "fix":
      return <Button onClick={onFix}>Ask {name} to fix it</Button>;
    case "review":
      return <Button onClick={(event) => onReview(event.currentTarget)}>{REVIEW_LABEL}</Button>;
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
      {dot === undefined ? null : <MateDot place="inline" tone={dot} />}
      <span data-zerops-surface="card-mate-time">{children}</span>
    </>
  );
}
