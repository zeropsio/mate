/**
 * A project's own page, in the place page's frame: a header (its state beside its name where not
 * calm), a main column for what changes day to day — what waits on the person, its places as the
 * line, its Mates, its changes — and a side column of cards for what is set up once. It reads
 * the group the overview's flow reads and draws through the same slots and system components its
 * card does, so a place, a Mate and a change say the same on both; nothing on it is said twice.
 * Production's state is the line's Production station's; *Review release* is the line's.
 */
import { useRouterState } from "@tanstack/react-router";
import { FileIcon, PlusIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type { CanonicalEnvironmentRow as EnvironmentRow } from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentSlotRow,
  FlowPullRequest,
  ReleaseFailure,
} from "@t3tools/client-runtime/zerops";
import { ENVIRONMENT_NOT_ADDED, REVIEW_RELEASE_LABEL } from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { useNowMs } from "~/zerops/useNowMs";
import { useOpenReview } from "~/zerops/review";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { Button, InlineButton } from "../../ui/button";
import { EmptyState } from "../../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ComingMateFace, drawn, matesOf, type FlowMateEntry } from "../projects/flowSteps";
import {
  cardReady,
  mateChangeForReview,
  placeLabel,
  placeLines,
  projectWaitWords,
  type CardChange,
  type PlaceLine as PlaceLineData,
  type ProjectWait,
} from "../projects/projectCard.logic";
import { comingMateLine } from "../projects/projectsView.logic";
import type {
  CardWait,
  ProjectsFlowGroup,
  ZeropsProjectsFlowProps,
} from "../projects/ZeropsProjectsFlow";
import {
  ChangeList,
  ChangeRow,
  changeRowLine,
  lineChangeKey,
  nextReleaseView,
  PageHeader,
  ProjectLine,
  projectLine,
  READY_FOR_REVIEW,
  SectionAction,
  SectionLabel,
  usePageTrail,
  type LineCopy,
  type NextReleaseView,
} from "../system";
import { placeVaultOf } from "../vault/placeVault.logic";
import { PlaceVaultButton } from "../vault/StopVault";
import type { ReleaseOffer } from "../ZeropsReleaseVerb";
import {
  changeGroups,
  PAGE_CHANGES,
  pageAddresses,
  linesProductionFirst,
  releaseGroup,
  waitingChanges,
} from "./projectPage.logic";
import { SetupCard, SetupRow } from "./SetupCard";

/** What the page reads beyond the overview's group: the project's environments and its release. */
export interface ProjectPageFacts {
  /** Its recent changes, open first (`pageChanges`). */
  readonly changes: ReadonlyArray<CardChange>;
  /** Why no change is listed, where HQ has not told them: reading, or its refusal. */
  readonly changesUnknown: string | undefined;
  /** Its repositories: the line names the code ones under `main`. */
  readonly repos: ZeropsProjectFlow["repos"];
  /** Its copies elsewhere that are not calm (`lineCopies`): each a row under the line's `main`. */
  readonly copies: ReadonlyArray<LineCopy>;
  /** How its last release did not go live (`releaseFailureOf`); none where it did. */
  readonly releaseFailure: ReleaseFailure | undefined;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  /** Its places: what exists, and a slot for each tier that does not (`environmentSlots`). */
  readonly slots: ReadonlyArray<EnvironmentSlotRow>;
  readonly release: ReleaseOffer;
  /** *Add stage* or *Put it live*, pressed on a missing tier. */
  readonly onAdd: (tier: EnvironmentRow["tier"]) => void;
  /** *Finish setup*, pressed on a half-made environment, by its project. */
  readonly onFinish: (id: string) => void;
  /** An environment of this application is being finished now. */
  readonly finishing: boolean;
  /** What a place says in place of its content while the grant withholds it; `null` while shown. */
  readonly withheldNotice?: ((projectId: string) => string | null) | undefined;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  /** Reads that failed, each with its one retry. */
  readonly readFailures?: ReactNode;
  /**
   * HQ has told which environments the project has (`slots`); until then, or where it refuses to,
   * nothing is offered as missing.
   */
  readonly declared: boolean;
}

/** The side column's rows past Addresses, and the sections their *Manage* opens. */
export interface ProjectPageSetup {
  /** Code, Automation, Who has access and Spend, in that order; each given its *Manage*. */
  readonly rows: (open: {
    readonly access: () => void;
    readonly automation: () => void;
  }) => ReactNode;
  /** Who has access where: opened from People, or by a place's link to its column. */
  readonly access: ReactNode;
  /** The whole Automation section: opened from its row. */
  readonly automation: ReactNode;
}

export function ProjectPageBody<T>({
  entry,
  props,
  addMateWhy,
  onAddMate,
  facts,
  setup,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** Why the project takes no Mate now, known before the press. */
  readonly addMateWhy: string | null;
  readonly onAddMate: () => void;
  readonly facts: ProjectPageFacts;
  readonly setup: ProjectPageSetup;
}) {
  const { group, flow } = entry;
  const nowMs = useNowMs();
  const placeFacts = props.cardPlaces?.(entry);
  const lines = linesProductionFirst(placeLines({ flow, ...placeFacts, nowMs }));
  const trail = usePageTrail({ project: { groupId: group.groupId, name: group.name } });
  const [open, setOpen] = useOpenDetails();
  const waits = props.cardWaits?.(entry) ?? NO_WAITS;
  const waiting = waitingChangeKeys(entry, waits);
  const door = releaseDoor(entry, props, facts);
  return (
    <div className="pp" data-zerops-surface="project-page">
      <PageHeader
        actions={
          <>
            <AddMateButton onAdd={onAddMate} why={addMateWhy} />
            {props.renderGroupMenu(entry, { page: true })}
          </>
        }
        placeholder={entry.placeholder}
        tag={
          // Its state where it is not calm; a live project's places say theirs.
          flow.production.kind === "absent" ? (
            <span className="pp-state" data-zerops-project-state="">
              Not live yet
            </span>
          ) : undefined
        }
        title={group.name}
        trail={trail}
      />
      <div className="pp-cols">
        <div className="pp-main">
          {facts.readFailures}
          <ProjectWaits entry={entry} waits={waits} />
          <ProjectPlaces
            door={door}
            entry={entry}
            facts={facts}
            lines={lines}
            props={props}
            waiting={waiting}
          />
          <ProjectMates
            entry={entry}
            props={props}
            waiting={new Set(waits.map(({ wait }) => wait.mate.projectId))}
          />
          <ProjectChanges door={door} entry={entry} facts={facts} props={props} waiting={waiting} />
          {open.access ? (
            <DetailSection
              label="Who has access"
              onClose={() => {
                setOpen((now) => ({ ...now, access: false }));
              }}
            >
              {setup.access}
            </DetailSection>
          ) : null}
          {open.automation ? (
            <DetailSection
              label="Automation"
              onClose={() => {
                setOpen((now) => ({ ...now, automation: false }));
              }}
            >
              {setup.automation}
            </DetailSection>
          ) : null}
        </div>
        <div className="pp-side">
          <SetupCard>
            <AddressesRow lines={lines} />
            {setup.rows({
              access: () => {
                setOpen((now) => ({ ...now, access: true }));
              },
              automation: () => {
                setOpen((now) => ({ ...now, automation: true }));
              },
            })}
          </SetupCard>
        </div>
      </div>
    </div>
  );
}

/**
 * Which of the main column's foot sections stand open. A place's page links to its column of who
 * has access (`#access-<projectId>`): that opens it.
 */
function useOpenDetails() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  return useState(() => ({ access: hash.startsWith("access-"), automation: false }));
}

function AddMateButton({
  onAdd,
  why,
}: {
  readonly onAdd: () => void;
  readonly why: string | null;
}) {
  const button = (
    <Button
      data-zerops-surface="add-mate"
      disabled={why !== null}
      onClick={onAdd}
      size="sm"
      variant="secondary"
    >
      <PlusIcon aria-hidden="true" />
      Add a Mate
    </Button>
  );
  if (why === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{button}</TooltipTrigger>
      <TooltipPopup side="bottom">{why}</TooltipPopup>
    </Tooltip>
  );
}

const changeKey = lineChangeKey;

/** The changes Waiting on you lists, each Mate's that wait for the person's review. */
function waitingChangeKeys<T>(
  entry: ProjectsFlowGroup<T>,
  waits: ReadonlyArray<CardWait>,
): ReadonlySet<string> {
  return new Set(
    waits.flatMap(({ wait }) =>
      wait.kind === "review" ? waitingChanges(entry.flow, wait.mate.projectId).map(changeKey) : [],
    ),
  );
}

/** A change's review, from the row it was opened on. */
function useOpenChange() {
  const openReview = useOpenReview();
  return (groupId: string, pull: FlowPullRequest, from: HTMLElement) => {
    openReview(
      { kind: "change", groupId, repository: pull.repository, number: pull.number },
      { from },
    );
  };
}

const NO_WAITS: ReadonlyArray<CardWait> = [];

/** How many rows of one Mate's changes to review stand before "+ N more from …". */
const WAITS_SHOWN = 2;

/**
 * What waits on the person here: Mates' questions, plans and errors, each with its one verb, then
 * each Mate's changes to review, a row each. The release is not here: it is Production's. Not drawn
 * while nothing waits.
 */
function ProjectWaits<T>({
  entry,
  waits,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly waits: ReadonlyArray<CardWait>;
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const openChange = useOpenChange();
  if (waits.length === 0) return null;
  // One per thing to act on, as the menu's badge counts: a Mate's changes are one.
  return (
    <section aria-labelledby="pp-waits" className="pp-group" data-zerops-surface="project-waits">
      <SectionLabel count={waits.length} id="pp-waits">
        Waiting on you
      </SectionLabel>
      <div className="pp-card pp-list">
        <ChangeList>
          {waits.map(({ wait, face, onVerb }) => {
            if (wait.kind === "ask")
              return (
                <ChangeRow
                  face={face}
                  key={wait.key}
                  line={changeRowLine(wait.mate.name, ASK_LINE[wait.ask])}
                  title={projectWaitWords(wait).text}
                  verb={
                    <Button
                      onClick={(event) => {
                        onVerb(event.currentTarget);
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      {projectWaitWords(wait).verb}
                    </Button>
                  }
                />
              );
            const changes = waitingChanges(entry.flow, wait.mate.projectId);
            const all = unfolded.has(wait.key);
            const shown = all ? changes : changes.slice(0, WAITS_SHOWN);
            const more = changes.length - shown.length;
            if (changes.length === 0)
              return (
                <ChangeRow
                  face={face}
                  key={wait.key}
                  line={changeRowLine(wait.mate.name, READY_FOR_REVIEW)}
                  onOpen={onVerb}
                  open
                  title={projectWaitWords(wait).text}
                />
              );
            return (
              <Fragment key={wait.key}>
                {shown.map((pull) => (
                  <ChangeRow
                    at={pull.updatedAt}
                    face={face}
                    key={`${pull.repository}#${String(pull.number)}`}
                    line={changeRowLine(wait.mate.name, READY_FOR_REVIEW)}
                    onOpen={(from) => {
                      openChange(entry.group.groupId, pull, from);
                    }}
                    open
                    pull={pull}
                  />
                ))}
                {more > 0 ? (
                  <li className="pp-more">
                    <SectionAction
                      onClick={() => {
                        setUnfolded((now) => new Set([...now, wait.key]));
                      }}
                    >
                      + {more} more from {wait.mate.name}
                    </SectionAction>
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ChangeList>
      </div>
    </section>
  );
}

const ASK_LINE: Record<Extract<ProjectWait, { kind: "ask" }>["ask"], string> = {
  question: "Asks you",
  plan: "Has a plan for you",
  failed: "Stopped on an error",
  "sign-in": "Waiting for your sign-in",
};

/** The page's release door: the next release where the page offers it, else none. */
function releaseDoor<T>(
  entry: ProjectsFlowGroup<T>,
  props: ZeropsProjectsFlowProps<T>,
  facts: ProjectPageFacts,
): { readonly view: NextReleaseView; readonly ready: ReturnType<typeof cardReady> } {
  const ready = cardReady(entry.flow);
  const view = nextReleaseView({
    release: facts.release,
    ready,
    onStage: props.cardPlaces?.(entry).releaseOnStage,
  });
  // A release ready to go is offered only where the page's door offers it: a Put it live run
  // releases the production it makes. One on its way, or refused, is said from the flow, whoever
  // started it.
  const withheld =
    view.kind === "ready" &&
    props.renderReleaseVerb !== undefined &&
    !drawn(props.renderReleaseVerb(entry));
  return { view: withheld ? { kind: "none" } : view, ready };
}

/**
 * The project's places as its line (`ProjectLine`): Mates' work, `main`, its stage, production,
 * the changes between them as beads, and under `main` each further place or copy that is not calm.
 * *Review release* and *Put it live* are the line's; a Put it live run stands under it while it
 * goes. Under the line, on one quiet line each: what going live gives a project not live yet, the
 * stage it may add, a half-made place's *Finish setup*.
 */
function ProjectPlaces<T>({
  entry,
  props,
  facts,
  lines,
  waiting,
  door,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly facts: ProjectPageFacts;
  readonly lines: ReadonlyArray<PlaceLineData>;
  /** The changes that wait for the person's review (`lineChangeKey`): their beads say so. */
  readonly waiting: ReadonlySet<string>;
  readonly door: ReturnType<typeof releaseDoor>;
}) {
  const { group, flow } = entry;
  const openChange = useOpenChange();
  const slotOf = (tier: EnvironmentRow["tier"]) => {
    const slot = facts.declared
      ? facts.slots.find((each) => each.kind === "slot" && each.tier === tier)
      : undefined;
    return slot?.kind === "slot" ? slot : undefined;
  };
  const productionSlot = slotOf("production");
  const stageSlot = slotOf("stage");
  const productionNote = facts.slots.find(
    (slot) => slot.kind === "environment" && slot.tier === "production",
  );
  const withheld = (line: PlaceLineData) =>
    line.projectId === undefined
      ? undefined
      : (facts.withheldNotice?.(line.projectId) ?? undefined);
  // Opened by its environment, as a bookmark names it: the same through a rename.
  const placeId = (line: PlaceLineData) =>
    facts.environments.find(
      (row) => row.target.kind === "zerops" && row.target.projectId === line.projectId,
    )?.id ?? line.projectId;
  const openVault = props.openPlaceVault;
  const view = projectLine({
    flow,
    // A place the grant withholds says so in place of its state.
    places: lines.map((line) => {
      const notice = withheld(line);
      return notice === undefined
        ? line
        : { ...line, dot: "unknown", words: [notice], trouble: false, addresses: [] };
    }),
    placeId,
    tintOf: (projectId) => {
      const item = entry.mates.get(projectId);
      return item === undefined ? undefined : props.mateTint?.(item);
    },
    repos: (facts.repos ?? []).map((repo) => repo.name).filter((name) => name !== RECIPE_REPO),
    copies: facts.copies,
    changes: facts.changes,
    changesKnown: facts.changesUnknown === undefined && !entry.changesAwaiting,
    waiting,
    release: {
      view: door.view,
      failure: facts.releaseFailure,
      ready: door.ready,
      note:
        productionNote?.kind === "environment" && door.view.kind === "none"
          ? productionNote.note?.text
          : undefined,
    },
    putLive:
      productionSlot?.add === true
        ? environmentDoorLabel("production", productionSlot.name)
        : undefined,
    coming: facts.slots.flatMap((slot) =>
      slot.kind === "devstage" || (slot.kind === "creating" && slot.tier === "stage")
        ? [{ key: slot.id, name: placeLabel({ kind: "stage", name: "stage" }), line: slot.line }]
        : [],
    ),
  });
  const halfMade = facts.slots.flatMap((slot) => (slot.kind === "half-made" ? [slot] : []));
  const run = props.renderProductionRun?.(entry);
  return (
    <section aria-labelledby="pp-places" className="pp-group" data-zerops-surface="project-places">
      <SectionLabel id="pp-places">Places</SectionLabel>
      <ProjectLine
        groupId={group.groupId}
        held={entry.awaiting}
        onOpenChange={(pull, from) => {
          openChange(group.groupId, pull, from);
        }}
        onOpenMates={() => {
          const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          document
            .getElementById("pp-mates")
            ?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
        }}
        onPutLive={() => {
          facts.onAdd("production");
        }}
        onReviewRelease={facts.release.onReview}
        // A place's vault, at the end of its station's name: shown while the station is pointed at
        // or holds focus, always where nothing hovers.
        stationEnd={
          openVault === undefined
            ? undefined
            : (station) => {
                const line =
                  station.projectId === undefined
                    ? undefined
                    : lines.find((each) => placeId(each) === station.projectId);
                const vault =
                  line === undefined || withheld(line) !== undefined
                    ? undefined
                    : placeVaultOf(line);
                return vault === undefined ? null : (
                  <PlaceVaultButton name={vault.name} onOpen={() => openVault(vault)} />
                );
              }
        }
        view={view}
      />
      {/* A Put it live run stands under the line while it goes, its failure and its one fixing
          verb included. */}
      {drawn(run) ? <div className="pp-line-run">{run}</div> : null}
      {productionSlot === undefined ? (
        stageSlot?.add === true ? (
          <p className="pp-line-note" data-zerops-place="stage">
            <span>
              <strong>{stageSlot.name}</strong> · optional · {STAGE_IS_FOR.toLocaleLowerCase()}
            </span>
            <AddPlace onAdd={facts.onAdd} slot={stageSlot} />
          </p>
        ) : null
      ) : (
        <p className="pp-line-note" data-zerops-surface="project-going-live">
          <span>
            Putting it live gives {group.name} a production of its own: its own address, and every
            release after it.
            {productionSlot.line === ENVIRONMENT_NOT_ADDED ? null : ` ${productionSlot.line}.`}
          </span>
          {stageSlot?.add === true ? (
            <span data-zerops-place="stage">
              {stageSlot.name} · optional <AddPlace onAdd={facts.onAdd} slot={stageSlot} />
            </span>
          ) : null}
        </p>
      )}
      {halfMade.map((slot) => (
        <p className="pp-line-note" data-zerops-place={slot.tier} key={slot.id}>
          <span>
            <strong>{placeLabel({ kind: slot.tier, name: slot.tier })}</strong> · {slot.line}
          </span>
          {slot.finish ? (
            <InlineButton
              disabled={facts.finishing}
              onClick={() => {
                facts.onFinish(slot.id);
              }}
            >
              Finish setup
            </InlineButton>
          ) : null}
        </p>
      ))}
    </section>
  );
}

/** *Add stage*, a word at the end of the line that says what a stage is for. */
function AddPlace({
  slot,
  onAdd,
}: {
  readonly slot: Extract<EnvironmentSlotRow, { kind: "slot" }>;
  readonly onAdd: ProjectPageFacts["onAdd"];
}) {
  return (
    <InlineButton
      onClick={() => {
        onAdd(slot.tier);
      }}
    >
      {environmentDoorLabel(slot.tier, slot.name)}
    </InlineButton>
  );
}

/** What a stage is for, where the project has none yet. */
const STAGE_IS_FOR = "A place to try a change before production";

/**
 * Every Mate of the project, as the menu says each; what one waits on the person for is Waiting on
 * you's, so its row stays quiet. *Add a Mate* is the header's.
 */
function ProjectMates<T>({
  entry,
  props,
  waiting,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  /** The Mates whose wait on the person Waiting on you says: their rows stay quiet. */
  readonly waiting: ReadonlySet<string>;
}) {
  const mates = matesOf(entry);
  const draw = (mate: FlowMateEntry<T>) =>
    mate.kind === "coming" ? (
      <ComingMate
        birth={props.renderComingBirth?.(mate.mate.projectId)}
        key={`coming:${mate.mate.projectId}`}
        mate={mate}
      />
    ) : (
      <Fragment key={props.getKey(mate.item)}>
        {props.renderMate(mate.item, {
          layout: "row",
          parts: mate.mate.parts ?? [],
          quiet: waiting.has(mate.mate.projectId),
          // A change is offered for review only once the project's changes are read and known.
          review:
            entry.changesAwaiting || entry.changesUnknown !== undefined
              ? undefined
              : mateChangeForReview(entry.flow, mate.mate.projectId),
        })}
      </Fragment>
    );
  return (
    <section aria-labelledby="pp-mates" className="pp-group" data-zerops-step="mates">
      <SectionLabel count={mates.length > 1 ? mates.length : undefined} id="pp-mates">
        Mates
      </SectionLabel>
      <div className="pp-card pp-list" role="list">
        {mates.length === 0 ? (
          <p className="pp-empty">No Mates yet. Add one to start work here.</p>
        ) : (
          mates.map(draw)
        )}
      </div>
    </section>
  );
}

/** A Mate being created: waking, named, how far its birth has got, nothing to press. */
function ComingMate<T>({
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

/**
 * The project's recent changes, less those Waiting on you lists: open ones each with what stops it,
 * merged ones grouped by where they went — the group's label says it once, as the line's segment
 * does ("On stage, ready for production · 12"), and with one group the section's label is it ("On
 * main, not live yet · 5") — setup files last, quiet. The group a release would carry ends in a
 * quiet *Review release*, the line's own verb. *All history* opens its releases in place, each with
 * the changes it put live; with no history, *All changes* lists past the first few.
 */
function ProjectChanges<T>({
  entry,
  props,
  facts,
  waiting,
  door,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly facts: ProjectPageFacts;
  /** The changes Waiting on you lists for review (`changeKey`): said there, not here. */
  readonly waiting: ReadonlySet<string>;
  readonly door: ReturnType<typeof releaseDoor>;
}) {
  const [history, setHistory] = useState(false);
  const [all, setAll] = useState(false);
  const openChange = useOpenChange();
  const listed = facts.changes.filter((change) => !waiting.has(changeKey(change.pull)));
  const changes = all ? listed : listed.slice(0, PAGE_CHANGES);
  const { open, groups, setup } = changeGroups(changes);
  // A group counts every change that went there, the rows past the first few too.
  const every = changeGroups(listed).groups;
  const countOf = (group: (typeof groups)[number]) =>
    every.find((each) => each.label === group.label)?.changes.length ?? group.changes.length;
  // The changes a release would carry: their group carries its verb.
  const carried =
    door.view.kind === "ready" || door.view.kind === "failed" ? releaseGroup(groups) : undefined;
  const reviewRelease = (
    <SectionAction onClick={facts.release.onReview}>{REVIEW_RELEASE_LABEL} →</SectionAction>
  );
  const mateName = (projectId: string) =>
    entry.flow.mates.find((mate) => mate.projectId === projectId)?.name;
  const faceOf = (projectId: string) => {
    const item = entry.mates.get(projectId);
    return item === undefined ? undefined : props.renderMateFace(item, 20);
  };
  const historyShown = history && facts.repo !== undefined;
  // One group alone, and nothing open beside it: its place is the section's label, unless it
  // carries the release's verb beside the section's own.
  const only =
    open.length === 0 && groups.length === 1 && groups[0] !== carried ? groups[0] : undefined;
  const row = (change: CardChange, line: string | undefined) => (
    <ChangeRow
      at={change.at}
      face={
        change.pull.kind === "recipe" && !change.open ? (
          <FileIcon aria-hidden="true" className="pp-setup-file" />
        ) : (
          faceOf(change.pull.mateProjectId)
        )
      }
      key={`${change.pull.repository}#${String(change.pull.number)}`}
      line={line}
      onOpen={(from) => {
        openChange(entry.group.groupId, change.pull, from);
      }}
      open={change.open}
      pull={change.pull}
      tone={change.tone}
    />
  );
  const action =
    facts.repo !== undefined ? (
      <SectionAction
        onClick={() => {
          setHistory((now) => !now);
        }}
      >
        {history ? "Recent changes" : "All history"}
      </SectionAction>
    ) : listed.length > PAGE_CHANGES ? (
      <SectionAction
        onClick={() => {
          setAll((now) => !now);
        }}
      >
        {all ? "Fewer changes" : "All changes"}
      </SectionAction>
    ) : undefined;
  return (
    <section
      aria-labelledby="pp-changes"
      className="pp-group"
      data-zerops-surface="project-changes"
    >
      <SectionLabel
        action={action}
        count={historyShown || only === undefined ? undefined : countOf(only)}
        id="pp-changes"
      >
        {historyShown ? "History" : (only?.label ?? "Changes")}
      </SectionLabel>
      <div className="pp-card pp-list" data-history={historyShown ? "" : undefined}>
        {historyShown ? (
          props.renderHistory?.(entry)
        ) : changes.length === 0 ? (
          facts.repo === undefined ? (
            <EmptyState size="row">
              No repository is declared for this project’s services yet.
            </EmptyState>
          ) : (
            <p className="pp-empty">
              {facts.changesUnknown ?? "No changes yet — a Mate opens one as it works."}
            </p>
          )
        ) : (
          <>
            {open.length === 0 ? null : (
              <ChangeList label="Open changes">
                {open.map((change) =>
                  row(change, changeRowLine(mateName(change.pull.mateProjectId), change.words)),
                )}
              </ChangeList>
            )}
            {only === undefined ? (
              groups.map((group) => (
                <div className="pp-change-group" key={group.label}>
                  <SectionLabel
                    action={group === carried ? reviewRelease : undefined}
                    count={countOf(group)}
                    level={3}
                  >
                    {group.label}
                  </SectionLabel>
                  <ChangeList>{group.changes.map((change) => row(change, undefined))}</ChangeList>
                </div>
              ))
            ) : (
              <ChangeList label={only.label}>
                {only.changes.map((change) => row(change, undefined))}
              </ChangeList>
            )}
            {setup.length === 0 ? null : (
              <ChangeList label="Setup files">
                {setup.map((change) => row(change, change.words))}
              </ChangeList>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Every public address the project serves at, production's first, each opened beside the page.
 * Where more than one place serves, each says whose it is: a stage's subdomain beside production's
 * domain otherwise reads as production's.
 */
function AddressesRow({ lines }: { readonly lines: ReadonlyArray<PlaceLineData> }) {
  const addresses = pageAddresses(lines);
  if (addresses.length === 0) return null;
  const places = new Set(addresses.map((address) => address.place)).size;
  return (
    <SetupRow label="Addresses" surface="project-addresses">
      <ul className="pp-addresses">
        {addresses.map((address) => (
          <li key={address.url}>
            <a className="pp-site" href={address.url} rel="noreferrer" target="_blank">
              <span className="truncate">{address.host}</span>
              <span aria-hidden="true">↗</span>
            </a>
            {places > 1 ? <span className="pp-site-place">{address.place}</span> : null}
          </li>
        ))}
      </ul>
    </SetupRow>
  );
}

/** A section opened at the main column's foot from a side row: brought into view, closed by its own word. */
function DetailSection({
  label,
  onClose,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "nearest" });
  }, []);
  return (
    <section aria-label={label} className="pp-group" ref={ref}>
      <SectionLabel action={<SectionAction onClick={onClose}>Close</SectionAction>}>
        {label}
      </SectionLabel>
      <div className="pp-card pp-detail">{children}</div>
    </section>
  );
}
