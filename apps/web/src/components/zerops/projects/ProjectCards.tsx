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
import { PackageIcon, PlusIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { REVIEW_LABEL } from "@t3tools/client-runtime/zerops";
import { Link } from "@tanstack/react-router";
import { useHqAppDetailHold, useHqAppDetails } from "~/zerops/useHqAppDetail";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { rememberOverviewCards } from "~/zerops/overviewCardCount";
import { useNowMs } from "~/zerops/useNowMs";
import { StopReadAgain } from "../StopReadAgain";
import { heldLine } from "./emptyApps.logic";
import { ProjectCardStandIn } from "./OverviewStandIn";
import { ComingMateFace, drawn, GroupName, matesOf, type FlowMateEntry } from "./flowSteps";
import {
  cardReady,
  foldMates,
  mateIsLoud,
  placeLines,
  placeFixWords,
  projectWaitLabel,
  projectWaitWords,
  type CardMateReading,
  type PlaceLine as PlaceLineData,
} from "./projectCard.logic";
import { comingMateLine, stopLine } from "./projectsView.logic";
import { nextReleaseTitle } from "../system/NextRelease.logic";
import { PlaceLine } from "../system/PlaceLine";
import { SectionAction, SectionLabel } from "../system/SectionLabel";
import type {
  ProjectsFlowGroup,
  StageSettingUp,
  ZeropsProjectsFlowProps,
} from "./ZeropsProjectsFlow";
import { Button } from "~/components/ui/button";

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
export function PlaceDot({ dot }: { readonly dot: PlaceLineData["dot"] }) {
  return <i aria-hidden="true" className="ov-dot" data-dot={dot} />;
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

/** A stage the project does not have yet, as its card names it where one would stand. */
const NEW_STAGE: PlaceLineData = {
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
function settingUpLine(line: PlaceLineData, settingUp: StageSettingUp | undefined): PlaceLineData {
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
function releaseClock(line: PlaceLineData, since: number | undefined): PlaceLineData {
  return line.dot === "releasing" && since !== undefined ? { ...line, clock: { since } } : line;
}

/**
 * What a card says where a place is not there to open: "Not live yet", "No stage" — a hollow dot
 * and quiet words, in a place line's room.
 */
function QuietPlace({ children }: { readonly children: string }) {
  return (
    <div
      className="flex min-h-6 min-w-0 items-center gap-2 text-body text-muted-foreground"
      data-zerops-place-quiet=""
    >
      <PlaceDot dot="none" />
      {children}
    </div>
  );
}

/** How long ago a change last moved, as a menu row says its time: "3h", "2d". */
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

const NO_PARTS: ReadonlyArray<never> = [];

/** At most this many Mates stand on a card; the rest are on the project's page. */
const CARD_MATES = 3;

/**
 * A card's Mates: up to three, the ones that need someone first, each as its menu row says it and
 * never lifted (what waits on the viewer is the card's Waiting on you); "+ N more" opens the
 * project's page, and *+ Add a Mate* is the label's action.
 */
function CardMates<T>({
  entry,
  props,
  onAdd,
  addWhy = null,
  moreLinked,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** Its "+ N more" opens the page, where no other link on the card already does. */
  readonly moreLinked: boolean;
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
    <section aria-label="Project Mates" className="ov-sec ov-mates" data-zerops-step="mates">
      <SectionLabel
        action={
          onAdd === undefined || addWhy !== null ? undefined : (
            <SectionAction onClick={onAdd}>+ Add a Mate</SectionAction>
          )
        }
        count={mates.length > 1 ? mates.length : undefined}
        level={3}
      >
        Mates
      </SectionLabel>
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
              // Its previews are the card's ··· (`renderGroupMenu`): the row is face, name, what
              // it is doing and when, as the menu's row says it.
              parts: NO_PARTS,
              quiet: true,
            })}
          </Fragment>
        ),
      )}
      {more > 0 ? (
        <MoreLink
          groupId={entry.group.groupId}
          label={`${String(more)} more Mates in ${entry.group.name}`}
          linked={moreLinked}
          more={more}
        />
      ) : null}
      {/* Standing off, Add a Mate says why under its words, where the label has no room. */}
      {onAdd === undefined || addWhy === null ? null : (
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

/**
 * "+ N more": the rest of a card's list, on the project's page, named for a screen reader by what
 * and where ("2 more waiting in Tea Shop"). A card holds one such link: where another already
 * opens the page, the count stands as words.
 */
function MoreLink({
  groupId,
  more,
  label,
  linked = true,
}: {
  readonly groupId: string;
  readonly more: number;
  readonly label: string;
  readonly linked?: boolean;
}) {
  if (!linked)
    return (
      <span className="ov-more" data-quiet="">
        + {more} more
      </span>
    );
  return (
    <Link aria-label={label} className="ov-more" params={{ groupId }} to="/group/$groupId/flow">
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
  project,
  waits,
}: {
  readonly groupId: string;
  readonly project: string;
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
      <SectionLabel level={3}>Waiting on you</SectionLabel>
      {waits.slice(0, CARD_WAITS).map((wait) => (
        <div className="ov-wait" data-zerops-wait={wait.key} key={wait.key}>
          <span aria-hidden="true" className="ov-wait-face">
            {wait.face}
          </span>
          <span className="ov-wait-text">{wait.text}</span>
          <span className="ov-wait-verb">{wait.verb}</span>
        </div>
      ))}
      {more > 0 ? (
        <MoreLink
          groupId={groupId}
          label={`${String(more)} more waiting in ${project}`}
          more={more}
        />
      ) : null}
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
  const releaseDoor = props.renderReleaseVerb?.(entry);
  // The page's door decides whether a release is offered here at all: it stands where the one
  // list says the release waits on the viewer (`releaseOffered`). Where the page gives none, the
  // card says what the flow says.
  const releaseShown =
    props.renderReleaseVerb === undefined ? ready !== undefined : drawn(releaseDoor);
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
  // A broken production first, the most urgent; then its Mates' asks; then its release; then its
  // changes to review.
  const broken =
    production !== undefined && (production.dot === "down" || production.dot === "failed")
      ? production
      : undefined;
  const fix = broken === undefined ? undefined : props.placeFix?.(entry);
  const fixWords =
    broken === undefined || fix === undefined
      ? undefined
      : placeFixWords(broken, fix.fixer, group.name);
  const verb = (label: string, words: string, onVerb: (from: HTMLElement) => void) => (
    <Button
      aria-label={label}
      onClick={(event) => {
        onVerb(event.currentTarget);
      }}
      size="sm"
      variant="secondary"
    >
      {words}
    </Button>
  );
  const mateWaits = (props.cardWaits?.(entry) ?? []).map((wait) => ({
    kind: wait.wait.kind,
    key: wait.wait.key,
    face: wait.face,
    text: projectWaitWords(wait.wait).text,
    verb: verb(
      projectWaitLabel(wait.wait, group.name),
      projectWaitWords(wait.wait).verb,
      wait.onVerb,
    ),
  }));
  const waits = [
    ...(fix === undefined || fixWords === undefined
      ? []
      : [
          {
            key: "place",
            face: <PlaceDot dot={broken?.dot ?? "failed"} />,
            text: fixWords.text,
            verb: verb(fixWords.label, fixWords.verb, fix.onVerb),
          },
        ]),
    ...mateWaits.filter((wait) => wait.kind === "ask"),
    ...(!releaseShown
      ? []
      : [
          {
            key: "release",
            face: <PackageIcon className="size-4" />,
            text: nextReleaseTitle(ready),
            verb: drawn(releaseDoor) ? releaseDoor : null,
          },
        ]),
    ...mateWaits.filter((wait) => wait.kind === "review"),
  ];
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
        {notLive || production === undefined ? (
          <QuietPlace>Not live yet</QuietPlace>
        ) : (
          <PlaceLine density="compact" groupId={group.groupId} line={production} />
        )}
        {/* A release or Put it live run is production's, never a Mate's conversation's. */}
        {props.renderProductionRun?.(entry)}
        {lines
          .filter((line) => line.kind === "stage")
          .map((line) =>
            settingUp === undefined ? (
              <PlaceLine
                density="compact"
                groupId={group.groupId}
                key={`stage:${line.projectId ?? line.name}`}
                line={line}
              />
            ) : (
              <div
                data-zerops-place="stage"
                data-zerops-setting-up="true"
                key={`stage:${line.projectId ?? line.name}`}
              >
                <PlaceLine density="compact" groupId={group.groupId} line={line} />
              </div>
            ),
          )}
        {devstage !== undefined ? (
          <PlaceLine density="compact" line={{ ...NEW_STAGE, words: [devstage] }} />
        ) : stageComing ? (
          <div data-zerops-place="stage" data-zerops-setting-up="true">
            <PlaceLine density="compact" line={settingUpLine(NEW_STAGE, settingUp)} />
          </div>
        ) : !notLive && flow.stages.length === 0 && (flow.unreadStages ?? []).length === 0 ? (
          <QuietPlace>No stage</QuietPlace>
        ) : null}
      </div>
      <CardWaits groupId={group.groupId} project={group.name} waits={waits} />
      <CardMates
        addWhy={addMate?.why ?? null}
        entry={entry}
        moreLinked={waits.length <= CARD_WAITS}
        onAdd={addMate?.onAdd}
        props={props}
      />
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
 * Every project with Mates, in the overview's order (`overviewOrder`: what waits on the person
 * first, then the menu's own order). `focusGroup` (`?group=`) scrolls its card into
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
