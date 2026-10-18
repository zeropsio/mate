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
import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PlusIcon,
} from "lucide-react";
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

import { REVIEW_LABEL, type GroupFlowPreview } from "@t3tools/client-runtime/zerops";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useHqAppDetailHold, useHqAppDetails } from "~/zerops/useHqAppDetail";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { rememberOverviewCards } from "~/zerops/overviewCardCount";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { formatElapsed } from "~/components/ui/progress.logic";
import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import { MateDot } from "../MateDot";
import { StopReadAgain } from "../StopReadAgain";
import { heldLine } from "./emptyApps.logic";
import { ProjectCardStandIn, ProjectPageStandIn } from "./OverviewStandIn";
import { CardRoad, PageRoad, PlaceDot, ProjectStateLine, type RoadReading } from "./ProjectRoad";
import {
  automatedWords,
  freeWords,
  inReview,
  productionUnder,
  projectState,
  readyWords,
  releaseSegment,
  stageUnder,
} from "./projectRoad.logic";
import { ComingMateFace, drawn, GroupName, matesOf, type FlowMateEntry } from "./flowSteps";
import {
  cardChangeRows,
  cardReady,
  CARD_MATES_SHOWN,
  mateChangeForReview,
  mateIsLoud,
  placeLabel,
  placeLines,
  type CardChange,
  type CardMateReading,
  type PlaceLine,
} from "./projectCard.logic";
import { comingMateLine, projectRowLine, stopLine } from "./projectsView.logic";
import { ProjectPageSpend, ProjectSpendCard, ProjectSpendLine } from "./ProjectSpend";
import { spendProjectIds } from "./projectSpend.logic";
import type {
  ProjectsFlowGroup,
  StageSettingUp,
  ZeropsProjectsFlowProps,
} from "./ZeropsProjectsFlow";
import { Button } from "~/components/ui/button";

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
      ([record]) => {
        setSeen(record?.isIntersecting === true);
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
      <button
        className="ov-setup"
        disabled={onSetUp === "busy"}
        onClick={onSetUp === "busy" ? undefined : onSetUp}
        type="button"
      >
        <PlusIcon aria-hidden="true" className="size-3.5" />
        {environmentDoorLabel(line.kind, placeLabel(line))}
      </button>
      {onSetUp === "busy" && line.kind === "production" ? (
        <p className="text-muted-foreground text-xs" role="status">
          {PUT_LIVE_AFTER_CREATION}
        </p>
      ) : null}
    </div>
  );
}

/** How long ago a change last moved, as a menu row says its time: "3h", "2d". */
function ChangeAge({ at }: { readonly at: string | undefined }) {
  const nowMs = useNowMs();
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return when.length === 0 ? null : <span className="ov-change-time">{when}</span>;
}

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
            const Icon = change.open ? GitPullRequestIcon : GitMergeIcon;
            const own = face?.(change.pull.mateProjectId);
            return (
              <li key={`${change.pull.repository}#${String(change.pull.number)}`}>
                <button
                  className="ov-change"
                  data-open={change.open ? "true" : undefined}
                  onClick={(event) => {
                    onOpen(change, event.currentTarget);
                  }}
                  type="button"
                >
                  {own === undefined || own === null ? (
                    <Icon aria-hidden="true" className="ov-change-icon" />
                  ) : (
                    <span aria-hidden="true" className="ov-change-face">
                      {own}
                    </span>
                  )}
                  <span className="ov-change-text">
                    <span className="ov-change-title">{change.pull.title}</span>
                    <span className="ov-change-line" data-tone={change.tone}>
                      {by === undefined ? change.words : `${by} · ${change.words}`}
                    </span>
                  </span>
                  {/* Review on a change still open, as the menu has it (the owner, 2026-10-12: "more
                      limited in functionality than the left menu"); the row opens it too. */}
                  <span className="ov-change-end">
                    <ChangeAge at={change.at} />
                    {change.open ? (
                      <span className="ov-review" data-zerops-surface="card-change-review">
                        Review
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * A card's last line: the newest event it has not said above — "Vera merged “Prices per 100 g”" —
 * with whose face, and how long ago. A press opens it.
 */
export function CardActivity({
  words,
  face,
  at,
  nowMs,
  onOpen,
}: {
  readonly words: string;
  readonly face: ReactNode;
  readonly at: string | undefined;
  readonly nowMs: number;
  readonly onOpen: (from: HTMLElement) => void;
}) {
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return (
    <button
      className="pp-road-activity"
      data-zerops-surface="card-activity"
      onClick={(event) => {
        onOpen(event.currentTarget);
      }}
      type="button"
    >
      <span aria-hidden="true" className="pp-road-activity-face">
        {drawn(face) ? face : <GitMergeIcon className="size-3.5" />}
      </span>
      <span className="pp-road-activity-words">{words}</span>
      {when.length === 0 ? null : <span className="pp-road-activity-time">{when}</span>}
    </button>
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

type Listed<T> = Extract<FlowMateEntry<T>, { kind: "listed" }>;

/** A folded line of Mates: their faces and what they are, a press unfolds them. */
function MateFold<T>({
  mates,
  words,
  props,
  surface,
  onUnfold,
}: {
  readonly mates: ReadonlyArray<Listed<T>>;
  readonly words: string;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly surface: string;
  readonly onUnfold: () => void;
}) {
  return (
    <button className="ov-fold" data-zerops-surface={surface} onClick={onUnfold} type="button">
      <span className="ov-fold-faces">
        {mates.slice(0, 3).map((mate) => (
          <Fragment key={props.getKey(mate.item)}>{props.renderMateFace(mate.item, 20)}</Fragment>
        ))}
      </span>
      <span>{words}</span>
    </button>
  );
}

/**
 * A project's Mates as two-line rows, what waits on the viewer first — lifted by its own row onto
 * the card's one white sub-card. On a card the free Mates fold into one line ("Kai is free") under
 * the ones at work; on either, the automated ones fold into one line of what they do. A press unfolds a fold. On the
 * project's page each Mate stands as a small card of its own (`boxed`).
 */
function CardMates<T>({
  entry,
  props,
  all = false,
  liftTaken = false,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** Every Mate drawn, none folded as free: the project's page. */
  readonly all?: boolean;
  /** Something else is lifted on the card already: no Mate lifts. */
  readonly liftTaken?: boolean;
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(NO_FOLDS);
  const unfold = (fold: string) => setUnfolded((current) => new Set([...current, fold]));
  const { flow } = entry;
  const mates = matesOf(entry);
  const automated = mates.filter(
    (mate): mate is Listed<T> => mate.kind === "listed" && props.isAutomated?.(mate.item) === true,
  );
  const people = mates.filter((mate) => !automated.includes(mate as Listed<T>));
  const waits = (mate: FlowMateEntry<T>) =>
    mate.mate.waiting ||
    mate.mate.failed === true ||
    mateChangeForReview(flow, mate.mate.projectId) !== undefined;
  const quiet = people.filter(
    (mate): mate is Listed<T> => mate.kind === "listed" && !mateIsLoud(mate.mate, flow),
  );
  // Free Mates fold under the ones at work; where none is, the first few stand as rows, saying
  // what each did last, and the rest fold.
  const free = all ? [] : quiet.length === people.length ? quiet.slice(CARD_MATES_SHOWN) : quiet;
  // What waits on the viewer first, then the rest in the person's order.
  const shown = people
    .filter((mate) => !free.includes(mate as Listed<T>))
    .toSorted((left, right) => Number(waits(right)) - Number(waits(left)));
  // A card lifts one thing: production's trouble, else the first Mate that waits on the viewer.
  const lifted = all
    ? undefined
    : liftTaken
      ? null
      : shown.find((mate) => mate.kind === "listed" && waits(mate));
  const draw = (mate: FlowMateEntry<T>) => {
    const row =
      mate.kind === "coming" ? (
        <CardComingMate key={`coming:${mate.mate.projectId}`} mate={mate} />
      ) : (
        <Fragment key={props.getKey(mate.item)}>
          {props.renderMate(mate.item, {
            layout: "row",
            previews: mate.mate.previews,
            // A change is offered for review only once the project's changes are read and known.
            review:
              entry.changesAwaiting || entry.changesUnknown !== undefined
                ? undefined
                : mateChangeForReview(flow, mate.mate.projectId),
            lift: lifted === undefined || lifted === mate,
          })}
        </Fragment>
      );
    return all ? (
      <div className="pp-road-mate" key={mate.mate.projectId}>
        {row}
      </div>
    ) : (
      row
    );
  };
  const freeOpen = unfolded.has("free");
  const automatedOpen = unfolded.has("automated");
  if (mates.length === 0) return null;
  return (
    <section
      aria-label="Project Mates"
      className={all ? "pp-road-mates" : "ov-mates"}
      data-zerops-step="mates"
    >
      {shown.map(draw)}
      {freeOpen ? free.map(draw) : null}
      {free.length === 0 || freeOpen ? null : (
        <MateFold
          mates={free}
          onUnfold={() => unfold("free")}
          props={props}
          surface="mates-free"
          words={freeWords(free.map((mate) => mate.mate.name))}
        />
      )}
      {automatedOpen ? automated.map(draw) : null}
      {automated.length === 0 || automatedOpen ? null : (
        <MateFold
          mates={automated}
          onUnfold={() => unfold("automated")}
          props={props}
          surface="mates-automated"
          words={automatedWords(
            automated.map((mate) => ({
              name: mate.mate.name,
              working: mate.mate.working === true,
            })),
          )}
        />
      )}
    </section>
  );
}

const NO_FOLDS: ReadonlySet<string> = new Set();

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

/** "25m", "6d": how long ago, as a menu row says its time; nothing for no date. */
function ageOf(at: string | undefined, nowMs: number): string | undefined {
  if (at === undefined || Number.isNaN(Date.parse(at))) return undefined;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
}

/**
 * A project's places and its road, as its card and its page read them: production and every
 * stage's line (`placeLines`), its one state (`projectState`), and the road between them.
 */
function readRoad<T>(
  entry: ProjectsFlowGroup<T>,
  props: ZeropsProjectsFlowProps<T>,
  nowMs: number,
  long: boolean,
) {
  const { flow } = entry;
  // A stage being added says how far it has got on its own line, where the stage stands.
  const settingUp = props.stageSettingUp?.(entry);
  const facts = props.cardPlaces?.(entry);
  const lines = placeLines({ flow, ...facts, nowMs }).map((line) =>
    line.kind === "stage" && settingUp !== undefined ? settingUpLine(line, settingUp) : line,
  );
  const production = lines.find((line) => line.kind === "production") ?? lines.at(-1)!;
  const stages = lines.filter((line) => line.kind === "stage");
  const mainStop =
    flow.stages.find((stop) => stop.source === "main") ?? flow.stages[0] ?? undefined;
  const stage = stages.find((line) => line.projectId === mainStop?.projectId) ?? stages[0];
  // A release offered is drawn where the page's door draws it: Put it live releases the
  // production it makes, and the door withholds itself then.
  const ready = cardReady(flow);
  const readyLabel = ready === undefined ? "" : readyWords(ready.count, ready.atLeast, long);
  const releaseDoor =
    ready === undefined ? null : (props.renderReleaseVerb?.(entry, { label: readyLabel }) ?? null);
  const releaseShown = props.renderReleaseVerb === undefined || drawn(releaseDoor);
  const productionAbsent = flow.production.kind === "absent";
  const version =
    facts?.chip?.version ??
    (flow.production.kind === "absent" || flow.production.kind === "creating"
      ? undefined
      : flow.production.stop.version?.label);
  const road: RoadReading = {
    stage,
    production,
    productionAbsent,
    review: inReview(flow),
    segment: releaseSegment({
      production,
      failedTag: facts?.failedTag,
      ready: ready === undefined || !releaseShown ? undefined : ready,
      productionAbsent,
      notLive: flow.main.notLive,
    }),
    releaseDoor: drawn(releaseDoor) ? releaseDoor : null,
    stageUnder:
      stage === undefined
        ? undefined
        : stageUnder(stage, {
            source: mainStop?.source,
            age: ageOf(
              stage.projectId === undefined ? undefined : facts?.stageSince?.get(stage.projectId),
              nowMs,
            ),
          }),
    productionUnder: productionAbsent
      ? { words: ["not live"], tone: "muted" }
      : productionUnder(production, { version, up: ageOf(facts?.since, nowMs) }),
  };
  const state = projectState({
    production,
    waitsOnYou: props.waitsOnYou?.(entry) ?? false,
    mates: flow.mates,
  });
  // No stage yet: the way to add it — or that one is being set up.
  const stageSetUp =
    flow.stages.length > 0
      ? undefined
      : flow.creatingStages.length > 0 || settingUp !== undefined
        ? ("creating" as const)
        : props.setUpStage?.(entry);
  const putLive = productionAbsent ? props.setUpProduction?.(entry) : undefined;
  return { lines, production, stages, road, state, settingUp, stageSetUp, putLive };
}

/** *Put it live* where production can be made: kept, not to be pressed, while another is. */
function PutLive({ onPut }: { readonly onPut: (() => void) | "busy" }) {
  return (
    <Button
      disabled={onPut === "busy"}
      onClick={onPut === "busy" ? undefined : onPut}
      size="sm"
      variant="secondary"
    >
      Put it live
      <ChevronRightIcon aria-hidden="true" />
    </Button>
  );
}

/** Why production's setup waits, while another environment is being set up. */
function PutLiveWaits({ onPut }: { readonly onPut: (() => void) | "busy" | undefined }) {
  return onPut === "busy" ? (
    <p className="pp-road-note" role="status">
      {PUT_LIVE_AFTER_CREATION}
    </p>
  ) : null;
}

/** The people on the project and its automated Mates, as quiet chips beside or under its name. */
function ProjectChips<T>({
  entry,
  props,
  held = false,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** Its row's room is held where it says nothing: a page's header keeps one height. */
  readonly held?: boolean;
}) {
  const people = props.renderCardPeople?.(entry);
  const automated = [...entry.mates.values()].filter(
    (item) => props.isAutomated?.(item) === true,
  ).length;
  if (!drawn(people) && automated === 0)
    return held ? <div aria-hidden="true" className="pp-road-chips" /> : null;
  return (
    <div className="pp-road-chips">
      {people}
      {automated === 0 ? null : (
        <span className="pp-road-tag" data-zerops-surface="automated-count">
          {`${String(automated)} automated`}
        </span>
      )}
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
  const spendIds = useMemo(() => spendProjectIds(flow), [flow]);
  const detail = useDetailWhileSeen(group.groupId);
  const quiet = [entry.line, heldLine(flow.mates.length, entry.contents)].find(
    (line) => line !== undefined,
  );
  const { production, road, state, settingUp, stageSetUp, putLive } = readRoad(
    entry,
    props,
    nowMs,
    false,
  );
  // Why its changes are not known, said plainly where they are not.
  const unknown = projectRowLine({
    flow,
    lastMerged: entry.lastMerged,
    activities: entry.activities,
    settled: !entry.awaiting && !entry.changesAwaiting,
    changesUnknown: entry.changesUnknown,
  });
  if (!detail.answered)
    return <ProjectCardStandIn id={cardId(group.groupId)} label={group.name} ref={detail.ref} />;
  // Production's trouble is what waits first: lifted with its buttons, the card's one white thing.
  const trouble = production.trouble ? props.renderPlacePanel?.(entry, production, "lift") : null;
  return (
    <article
      aria-label={group.name}
      className="ov-card"
      data-focused={focused ? "true" : undefined}
      data-zerops-group={group.groupId}
      id={cardId(group.groupId)}
      ref={detail.ref}
      role="listitem"
    >
      <header className="ov-card-head">
        <div className="pp-road-top">
          <ProjectStateLine state={state} />
          <span className="ov-card-menu">{props.renderGroupMenu(entry)}</span>
        </div>
        <h2 className="ov-card-name">
          <GroupName entry={entry} />
        </h2>
        {quiet === undefined ? null : <p className="ov-card-site">{quiet}</p>}
        <ProjectChips entry={entry} held props={props} />
      </header>
      <CardRoad
        putLive={putLive === undefined ? null : <PutLive onPut={putLive} />}
        road={road}
        stageNote={
          stageSetUp === "creating" ? (
            <span className="pp-road-under" data-zerops-setting-up="true">
              {settingUpLine(NEW_STAGE, settingUp).words.join(" ")}
            </span>
          ) : (
            <span className="pp-road-under">not added</span>
          )
        }
      />
      <PutLiveWaits onPut={putLive} />
      {drawn(trouble) ? (
        <div className="pp-road-lift" data-zerops-place="production">
          {trouble}
        </div>
      ) : null}
      <CardMates entry={entry} liftTaken={drawn(trouble)} props={props} />
      <ProjectSpendLine appId={group.groupId} projectIds={spendIds} />
      {unknown.kind === "unread" ? (
        <p className="ov-card-note" data-zerops-row-line="unread">
          {unknown.text}
        </p>
      ) : null}
      {props.renderActivity?.(entry)}
      <StopReads entry={entry} />
    </article>
  );
}

/**
 * A project's own page: its header — state, name, people, Add Mate and its menu — and its road at
 * the page's width, each environment a column under its stop: Development its Mates, Stage and
 * Production their panels with their actions. The page's own cards (`aside`) follow at full width.
 */
export function ProjectPage<T>({
  entry,
  props,
  aside,
  onAddMate,
  addMateWhy = null,
  roadEnvironments,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly aside: ReactNode;
  /** Each tier's environments under its stop, from the page's reads (`RoadEnvironmentRows`). */
  readonly roadEnvironments?: ((tier: "stage" | "production") => ReactNode) | undefined;
  readonly onAddMate?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press. */
  readonly addMateWhy?: string | null;
}) {
  const nowMs = useNowMs();
  const { group, flow } = entry;
  const spendIds = useMemo(() => spendProjectIds(flow), [flow]);
  const spend = <ProjectSpendCard appId={group.groupId} projectIds={spendIds} />;
  const detail = useDetailWhileSeen(group.groupId);
  const { production, stages, road, state, settingUp, stageSetUp, putLive } = readRoad(
    entry,
    props,
    nowMs,
    true,
  );
  if (!detail.answered)
    return (
      <div className="ov-page" data-zerops-surface="project-page">
        <ProjectPageStandIn label={group.name} ref={detail.ref} />
        <ProjectPageSpend value={spend}>
          <div className="ov-page-aside">{aside}</div>
        </ProjectPageSpend>
      </div>
    );
  // Where the page reads its environments (`roadEnvironments`), each tier's rows say what stands
  // there or its slot with its Add, and its place's detail follows; else the flow says it.
  const look = roadEnvironments === undefined ? "column" : "detail";
  const panel = (line: PlaceLine) =>
    props.renderPlacePanel?.(entry, line, look) ?? <PlainPanel line={line} />;
  const stageColumn =
    roadEnvironments !== undefined ? (
      <>
        {roadEnvironments("stage")}
        {stages.map((line) => (
          <div data-zerops-place="stage" key={line.projectId ?? line.name}>
            {panel(line)}
          </div>
        ))}
      </>
    ) : stages.length > 0 ? (
      stages.map((line) => (
        <div
          data-zerops-place="stage"
          data-zerops-setting-up={settingUp === undefined ? undefined : "true"}
          key={line.projectId ?? line.name}
        >
          {panel(line)}
        </div>
      ))
    ) : stageSetUp === "creating" ? (
      <div className="pp-road-tile" data-zerops-place="stage" data-zerops-setting-up="true">
        <PlainPanel held line={settingUpLine(NEW_STAGE, settingUp)} />
      </div>
    ) : (
      <div className="pp-road-tile" data-ghost="" data-zerops-place="stage">
        <p className="pp-road-ghost-words">No stage yet: changes go straight to production.</p>
        {stageSetUp === undefined ? null : <SetUpPanel line={NEW_STAGE} onSetUp={stageSetUp} />}
      </div>
    );
  const productionColumn =
    roadEnvironments !== undefined ? (
      <>
        {roadEnvironments("production")}
        {road.productionAbsent ? null : (
          <div data-zerops-place="production">{panel(production)}</div>
        )}
      </>
    ) : road.productionAbsent ? (
      <div className="pp-road-tile" data-ghost="" data-zerops-place="production">
        <p className="pp-road-ghost-words">Not live yet.</p>
        {putLive === undefined ? null : <PutLive onPut={putLive} />}
        <PutLiveWaits onPut={putLive} />
      </div>
    ) : (
      <div data-zerops-place="production">{panel(production)}</div>
    );
  return (
    <div className="ov-page" data-zerops-group={group.groupId} data-zerops-surface="project-page">
      <header className="pp-road-card pp-road-header" ref={detail.ref}>
        <div className="pp-road-header-text">
          <ProjectStateLine state={state} />
          <h1 className="pp-road-title">
            <GroupName entry={entry} />
          </h1>
          <ProjectChips entry={entry} held props={props} />
        </div>
        <div className="pp-road-header-acts">
          {onAddMate === undefined ? null : (
            <Button
              aria-describedby={addMateWhy === null ? undefined : `${group.groupId}-add-why`}
              data-zerops-surface="add-mate"
              disabled={addMateWhy !== null}
              onClick={addMateWhy === null ? onAddMate : undefined}
              variant="secondary"
            >
              <PlusIcon aria-hidden="true" />
              Add Mate
            </Button>
          )}
          <span className="ov-card-menu">{props.renderGroupMenu(entry)}</span>
          {onAddMate === undefined || addMateWhy === null ? null : (
            <p className="pp-road-why" id={`${group.groupId}-add-why`}>
              {addMateWhy}
            </p>
          )}
        </div>
      </header>
      <div className="pp-road-card">
        <PageRoad
          columns={[
            <CardMates all entry={entry} key="development" props={props} />,
            <Fragment key="stage">{stageColumn}</Fragment>,
            <Fragment key="production">{productionColumn}</Fragment>,
          ]}
          road={road}
        />
        <StopReads entry={entry} />
      </div>
      <ProjectPageSpend value={spend}>
        <div className="ov-page-aside">{aside}</div>
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
  /** Its previews, one per service, each a door on its name's line by the service's name. */
  readonly previews?: ReadonlyArray<GroupFlowPreview> | undefined;
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
  previews = [],
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
          {previews.map((preview) => (
            <a
              aria-label={`Open ${name}'s ${preview.service} preview`}
              className="ov-mate-preview"
              href={preview.url}
              key={preview.service}
              rel="noreferrer"
              target="_blank"
            >
              {preview.service}
              <ArrowUpRightIcon aria-hidden="true" className="size-3" />
            </a>
          ))}
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
