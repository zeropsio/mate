/**
 * The overview's cards: a card per project with Mates, in a grid that wraps.
 *
 * A card carries the project's state and what waits on the viewer, never lists or rare verbs: its
 * name and menu, a line per place, its waits lifted, its Mates (`ProjectCard`).
 *
 * Structural like the list it replaced: a Mate's row, the project's menu, the release's door and
 * its waits' verbs are the page's slots (`ZeropsProjectsFlowProps`).
 */
import { environmentDoorLabel, PUT_LIVE_AFTER_CREATION } from "~/zerops/putLive.logic";
import { ArrowUpRightIcon, PackageIcon, PlusIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  recipeReach,
  REVIEW_LABEL,
  type FlowPullRequest,
  type RecipeReach,
} from "@t3tools/client-runtime/zerops";
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { Link } from "@tanstack/react-router";
import { useHqAppDetailHold, useHqAppDetails } from "~/zerops/useHqAppDetail";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { rememberOverviewCards } from "~/zerops/overviewCardCount";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { mergedMain, useZeropsChangeDetail } from "~/zerops/useZeropsChangeDetail";
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
  mateIsLoud,
  placeLabel,
  placeLines,
  projectWaitWords,
  readyTitle,
  setupChangeWords,
  siteOf,
  type CardChange,
  type CardMateReading,
  type PlaceLine,
} from "./projectCard.logic";
import { comingMateLine, stopLine } from "./projectsView.logic";
import { ChangeRow } from "./ChangeRow";
import type {
  ProjectsFlowGroup,
  StageSettingUp,
  ZeropsProjectsFlowProps,
} from "./ZeropsProjectsFlow";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export const cardId = (groupId: string) => `project-${groupId}`;

/**
 * How far past the window's edge a card's detail is read ahead: about one card's height, so the
 * next row down is read before it scrolls into sight.
 */
const READ_AHEAD_PX = 400;

/**
 * The cards: a grid of one width each that wraps — four across at the owner's 1786 px with the menu
 * open, three at 1280, one in a conversation's panel — each as tall as what it holds. The page
 * scrolls down, never sideways (P1: a sideways row showed 3½ of 25 projects).
 */
function CardGrid({ children }: { readonly children: ReactNode }) {
  return (
    <div aria-label="Projects" className="ov-grid" data-zerops-surface="project-cards" role="list">
      {children}
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
      { rootMargin: `${String(READ_AHEAD_PX)}px 0px` },
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

/** Production before it is added, as its card says it: "Not live yet". */
const NEW_PRODUCTION: PlaceLine = {
  projectId: undefined,
  kind: "production",
  name: "prod",
  dot: "none",
  words: [],
  trouble: false,
  addresses: [],
};

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
 * A place on a card, one line: its dot, its name and what it says — a line that opens the place's
 * page where it has one, and its address beside it, opened beside the page.
 */
function CardPlace({
  groupId,
  line,
  label,
}: {
  readonly groupId: string;
  readonly line: PlaceLine;
  /** In place of its name, where the card says it plainly ("No stage", "Not live yet"). */
  readonly label?: string | undefined;
}) {
  const name = label ?? placeLabel(line);
  const words = (
    <>
      <PlaceDot dot={line.dot} />
      <span className="ov-place-name">{name}</span>
      {label === undefined && line.words.length > 0 ? <PlaceWords line={line} /> : null}
    </>
  );
  const address = label === undefined ? line.addresses[0] : undefined;
  return (
    <div className="ov-place" data-quiet={label === undefined ? undefined : ""}>
      {line.projectId === undefined ? (
        <span className="ov-place-line">{words}</span>
      ) : (
        <Link
          className="ov-place-line"
          params={{ groupId, projectId: line.projectId }}
          to="/group/$groupId/$projectId"
        >
          {words}
        </Link>
      )}
      {address?.url === undefined ? null : (
        <a
          aria-label={`Open ${name}`}
          className="ov-place-host"
          href={address.url}
          rel="noreferrer"
          target="_blank"
        >
          <span className="truncate">{siteOf(address.url) ?? address.url}</span>
          <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
        </a>
      )}
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
  setupReview,
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
  /** What a waiting setup change's review is read by, so its row says what it changes. */
  readonly setupReview?: SetupReview | undefined;
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
            const key = `${change.pull.repository}#${String(change.pull.number)}`;
            if (change.setup === true && setupReview !== undefined)
              return (
                <SetupChangeRow
                  by={by}
                  change={change}
                  face={face?.(change.pull.mateProjectId)}
                  key={key}
                  onOpen={(from) => {
                    onOpen(change, from);
                  }}
                  review={setupReview}
                />
              );
            return (
              <ChangeRow
                at={change.at}
                face={face?.(change.pull.mateProjectId)}
                key={key}
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

/** The project a card's setup changes are reviewed in, as their review reads them. */
export interface SetupReview {
  readonly appId: string;
  /** Each repository's `main` as the flow last told it (`mergedMain`). */
  readonly repos:
    | ReadonlyArray<{ readonly name: string; readonly mainHead?: string | null | undefined }>
    | undefined;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  readonly environments: Parameters<typeof recipeReach>[0]["environments"];
}

/**
 * A setup change waiting for a person: what it changes, read as its review reads it — the files HQ
 * recorded (`recipeReach`) — and the project's setup until they are read.
 */
function SetupChangeRow({
  change,
  review,
  by,
  face,
  onOpen,
}: {
  readonly change: CardChange;
  readonly review: SetupReview;
  readonly by: string | undefined;
  readonly face: ReactNode;
  readonly onOpen: (from: HTMLElement) => void;
}) {
  const { pull } = change;
  const detail = useZeropsChangeDetail({
    link: { appId: review.appId, repo: pull.repository, number: pull.number },
    head: pull.headSha,
    main:
      review.repos?.find((repo) => repo.name === pull.repository)?.mainHead ??
      mergedMain(pull.repository, review.merged),
  });
  const read = detail.readout.kind === "read" ? detail.readout.value : undefined;
  const reach: RecipeReach | undefined =
    read?.filesKnown === true
      ? recipeReach({
          files: read.files.map((file) => ({ filename: file.path })),
          environments: review.environments,
        })
      : undefined;
  const words = setupChangeWords(reach);
  return (
    <ChangeRow
      at={change.at}
      face={face}
      line={by === undefined ? words : `${by} · ${words}`}
      onOpen={onOpen}
      open={change.open}
      pull={pull}
      tone={change.tone}
    />
  );
}

/** A Mate being created: waking, named, how far its birth has got, nothing to press. */
function CardComingMate<T>({
  mate,
  birth,
}: {
  readonly mate: Extract<FlowMateEntry<T>, { kind: "coming" }>;
  readonly birth: { readonly line: string; readonly menu: ReactNode } | undefined;
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
        <span className="ov-mate-l2">{birth?.line ?? comingMateLine(mate.coming)}</span>
      </span>
      {birth?.menu}
    </div>
  );
}

/** At most this many Mates stand on a card; the rest are on the project's page. */
const CARD_MATES = 3;

/**
 * A card's Mates: up to three, the ones that need someone first, each as its menu row says it and
 * never lifted (what waits on the viewer is the card's Waiting on you); "+ N more" opens the
 * project's page, and *Add a Mate* closes the list.
 */
function CardMates<T>({
  entry,
  props,
  onAdd,
  addWhy = null,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly onAdd?: (() => void) | undefined;
  /** Why the project takes no Mate now, known before the press: *Add a Mate* stands off with it. */
  readonly addWhy?: string | null;
}) {
  const mates = matesOf(entry);
  const shown = foldMates(
    mates,
    (mate) => mateIsLoud(mate.mate, entry.flow),
    CARD_MATES,
  ).shown.slice(0, CARD_MATES);
  const more = mates.length - shown.length;
  return (
    <section aria-label="Mates" className="ov-sec ov-mates" data-zerops-step="mates">
      <h3 className="ov-sec-name">
        Mates
        {mates.length > 1 ? <span className="ov-sec-count"> · {mates.length}</span> : null}
      </h3>
      {shown.map((mate) =>
        mate.kind === "coming" ? (
          <CardComingMate
            birth={props.renderComingBirth?.(mate.mate.projectId)}
            key={`coming:${mate.mate.projectId}`}
            mate={mate}
          />
        ) : (
          <Fragment key={props.getKey(mate.item)}>
            {props.renderMate(mate.item, {
              layout: "row",
              parts: mate.mate.parts ?? [],
              quiet: true,
            })}
          </Fragment>
        ),
      )}
      {more > 0 ? <MoreLink groupId={entry.group.groupId} more={more} /> : null}
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

/** "+ N more": the rest of a card's list, on the project's page. */
function MoreLink({ groupId, more }: { readonly groupId: string; readonly more: number }) {
  return (
    <Link className="ov-more" params={{ groupId }} to="/group/$groupId/flow">
      + {more} more
    </Link>
  );
}

/** At most this many waits stand on a card; the rest are on the project's page. */
const CARD_WAITS = 2;

/**
 * What waits on the viewer in a project, lifted: its Mates' asks, its release, its changes to
 * review — at most two, each in a sentence with its one verb, and "+ N more" to the project's page.
 */
function CardWaits({
  groupId,
  waits,
}: {
  readonly groupId: string;
  readonly waits: ReadonlyArray<{
    readonly key: string;
    readonly face: ReactNode;
    readonly text: string;
    readonly verb: ReactNode;
  }>;
}) {
  if (waits.length === 0) return null;
  const more = waits.length - CARD_WAITS;
  return (
    <section aria-label="Waiting on you" className="ov-waits" data-zerops-surface="card-waits">
      <h3 className="ov-waits-name">Waiting on you</h3>
      {waits.slice(0, CARD_WAITS).map((wait) => (
        <div className="ov-wait" data-zerops-wait={wait.key} key={wait.key}>
          <span aria-hidden="true" className="ov-wait-face">
            {wait.face}
          </span>
          <span className="ov-wait-text">{wait.text}</span>
          <span className="ov-wait-verb">{wait.verb}</span>
        </div>
      ))}
      {more > 0 ? <MoreLink groupId={groupId} more={more} /> : null}
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

/**
 * A project's card, top to bottom: its name, which opens its page, and its ···; production and
 * each stage, one line each, which open the place — or "Not live yet"; what waits on the viewer,
 * lifted; its Mates; and *Put it live* while it has no production. Its changes, its history and
 * production's rarer verbs are on its pages and in its ··· (P2).
 */
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
  const detail = useDetailWhileSeen(group.groupId);
  const quiet = [entry.line, heldLine(flow.mates.length, entry.contents)].find(
    (line) => line !== undefined,
  );
  const ready = cardReady(flow);
  const releaseDoor = ready === undefined ? null : props.renderReleaseVerb?.(entry);
  // The page's door decides whether a release is offered here at all (Put it live releases the
  // production it makes); where the page gives none, the card says what the flow says.
  const releaseShown =
    ready !== undefined && (props.renderReleaseVerb === undefined || drawn(releaseDoor));
  // A stage being added says how far it has got on its own line, where the stage stands.
  const settingUp = props.stageSettingUp?.(entry);
  const placeFacts = props.cardPlaces?.(entry);
  const devstage = flow.stages.length > 0 ? undefined : props.stageDevstage?.(entry);
  const stageComing =
    flow.stages.length === 0 &&
    devstage === undefined &&
    (flow.creatingStages.length > 0 || settingUp !== undefined);
  const addMate = props.addMate?.(entry);
  const lines = placeLines({ flow, ...placeFacts, nowMs }).map((line) =>
    line.kind === "stage" && settingUp !== undefined
      ? settingUpLine(line, settingUp)
      : line.kind === "production"
        ? releaseClock(line, placeFacts?.releaseSince)
        : line,
  );
  const production = lines.find((line) => line.kind === "production");
  const notLive = flow.production.kind === "absent";
  const putLive = notLive ? props.setUpProduction?.(entry) : undefined;
  // Its Mates' asks first, the most urgent; then its release; then its changes to review.
  const mateWaits = props.cardWaits?.(entry) ?? [];
  const waits = [
    ...mateWaits.filter((wait) => wait.wait.kind === "ask"),
    ...(ready === undefined || !releaseShown
      ? []
      : [
          {
            key: "release",
            face: <PackageIcon className="size-4" />,
            text: readyTitle(ready),
            verb: drawn(releaseDoor) ? releaseDoor : null,
          },
        ]),
    ...mateWaits.filter((wait) => wait.wait.kind === "review"),
  ].map((wait) =>
    "wait" in wait
      ? {
          key: wait.wait.key,
          face: wait.face,
          text: projectWaitWords(wait.wait).text,
          verb: (
            <Button
              onClick={(event) => {
                wait.onVerb(event.currentTarget);
              }}
              size="sm"
              variant="secondary"
            >
              {projectWaitWords(wait.wait).verb}
            </Button>
          ),
        }
      : wait,
  );
  if (!detail.answered)
    return <ProjectCardStandIn id={cardId(group.groupId)} label={group.name} ref={detail.ref} />;
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
        <div className="ov-card-h1">
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
          <span className="ov-card-menu">{props.renderGroupMenu(entry)}</span>
        </div>
        {quiet === undefined ? null : <p className="ov-card-site">{quiet}</p>}
      </header>
      <div className="ov-places" data-zerops-surface="card-places">
        <div data-zerops-place="production">
          {notLive || production === undefined ? (
            <CardPlace
              groupId={group.groupId}
              label="Not live yet"
              line={production ?? NEW_PRODUCTION}
            />
          ) : (
            <CardPlace groupId={group.groupId} line={production} />
          )}
          {/* A release or Put it live run is production's, never a Mate's conversation's. */}
          {props.renderProductionRun?.(entry)}
        </div>
        {notLive
          ? null
          : lines
              .filter((line) => line.kind === "stage")
              .map((line) => (
                <CardPlace
                  groupId={group.groupId}
                  key={`stage:${line.projectId ?? line.name}`}
                  line={line}
                />
              ))}
        {notLive ? null : devstage !== undefined ? (
          <CardPlace groupId={group.groupId} line={{ ...NEW_STAGE, words: [devstage] }} />
        ) : stageComing ? (
          <CardPlace groupId={group.groupId} line={settingUpLine(NEW_STAGE, settingUp)} />
        ) : flow.stages.length === 0 && (flow.unreadStages ?? []).length === 0 ? (
          <CardPlace groupId={group.groupId} label="No stage" line={NEW_STAGE} />
        ) : null}
      </div>
      <CardWaits groupId={group.groupId} waits={waits} />
      <CardMates addWhy={addMate?.why ?? null} entry={entry} onAdd={addMate?.onAdd} props={props} />
      {putLive === undefined ? null : (
        <div className="ov-card-foot" data-zerops-place-setup="production">
          <Button
            disabled={putLive === "busy"}
            onClick={putLive === "busy" ? undefined : putLive}
            size="sm"
            variant="secondary"
          >
            {environmentDoorLabel("production", "production")}
          </Button>
          {putLive === "busy" ? (
            <p className="ov-card-note" role="status">
              {PUT_LIVE_AFTER_CREATION}
            </p>
          ) : null}
        </div>
      )}
      <StopReads entry={entry} />
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
    document.getElementById(cardId(focusGroup))?.scrollIntoView({ block: "nearest" });
  }, [focusGroup, shown, orderKey]);
  // What the next load's stand-in draws (`OverviewCardsStandIn`).
  useEffect(() => {
    rememberOverviewCards(groups.length);
  }, [groups.length]);
  if (groups.length === 0) return null;
  return (
    <CardGrid>
      {groups.map((entry) => (
        <ProjectCard
          entry={entry}
          focused={pulsed === entry.group.groupId}
          key={entry.group.groupId}
          props={props}
        />
      ))}
    </CardGrid>
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
   * Its parts (`mateParts`), each a chip on its name's line by its real hostname: a door to its
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
 * A part's chip on a Mate's row: a door to its preview, else to its dev, by that service's real
 * hostname; muted, with why in its title, where it has neither address.
 */
function CardMatePart({ mate, part }: { readonly mate: string; readonly part: MatePart }) {
  const door =
    part.preview?.url === undefined
      ? part.dev.find((entry) => entry.url !== undefined)
      : part.preview;
  const url = door?.url;
  const service = door?.service ?? part.preview?.service ?? part.devService;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          url === undefined ? (
            <span className="ov-mate-preview" data-off="" />
          ) : (
            <a
              aria-label={`Open ${mate}'s ${service}`}
              className="ov-mate-preview"
              href={url}
              rel="noreferrer"
              target="_blank"
            />
          )
        }
      >
        {service}
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
