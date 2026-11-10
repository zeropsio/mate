/**
 * A project's own page, in the place page's frame: a header (its state beside its name where not
 * calm), a main column for what changes day to day — what waits on the person, going live or its
 * places, its Mates, its changes under their picture — and a side column of cards for what is set up once. It reads
 * the group the overview's flow reads and draws through the same slots and system components its
 * card does, so a place, a Mate and a change say the same on both; nothing on it is said twice.
 * Production's state is its Places card's; *Review release* is its `NextRelease`'s.
 */
import { useRouterState } from "@tanstack/react-router";
import { FileIcon, GlobeIcon, PlusIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type { CanonicalEnvironmentRow as EnvironmentRow } from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentSlotRow,
  FirstDeploy,
  FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { environmentDoorLabel } from "~/zerops/putLive.logic";
import { useNowMs } from "~/zerops/useNowMs";
import { useOpenReview } from "~/zerops/review";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useUiStateStore } from "~/uiStateStore";

import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { EmptyState } from "../../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { GitDeliveryStatus } from "../GitDeliveryStatus";
import { ENVIRONMENT_NOT_ADDED } from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
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
  ComingBirthRow,
  ProjectsFlowGroup,
  ZeropsProjectsFlowProps,
} from "../projects/ZeropsProjectsFlow";
import {
  ChangeList,
  ChangeRow,
  changeRowLine,
  ComingMateRow,
  lineChangeKey,
  NextRelease,
  nextReleaseView,
  PageHeader,
  PageRows,
  PlaceLine,
  ProjectLine,
  projectLine,
  projectLineFull,
  READY_FOR_REVIEW,
  SectionAction,
  SectionLabel,
  usePageTrail,
  type LineGroup,
  type NextReleaseView,
} from "../system";
import type { ReleaseOffer } from "../ZeropsReleaseVerb";
import { placeVaultOf } from "../vault/placeVault.logic";
import { PlaceDoors } from "../place/PlaceDoors";
import { placeSitesOf } from "../place/placeDoors.logic";
import { StopLine } from "../ZeropsGroupDetail";
import {
  BROUGHT_SHOWN,
  changeGroups,
  lineGroupOf,
  PAGE_CHANGES,
  pageAddresses,
  linesProductionFirst,
  productionFirst,
  waitingChanges,
} from "./projectPage.logic";
import { SetupCard, SetupRow } from "./SetupCard";

/** What the page reads beyond the overview's group: the project's environments and its release. */
export interface ProjectPageFacts {
  /** What production's live release brought (`liveBrought`). */
  readonly brought: ReadonlyArray<FlowPullRequest>;
  /** Its recent changes, open first (`pageChanges`). */
  readonly changes: ReadonlyArray<CardChange>;
  /** Why no change is listed, where HQ has not told them: reading, or its refusal. */
  readonly changesUnknown: string | undefined;
  /** Its repositories, as a git place's delivery names them. */
  readonly repos: ZeropsProjectFlow["repos"];
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
  /** Where a stage that runs nothing stands on its first deploy. */
  readonly firstDeployOf?: ((projectId: string) => FirstDeploy | undefined) | undefined;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  /** Reads that failed, each with its one retry. */
  readonly readFailures?: ReactNode;
  /**
   * HQ has told which environments the project has (`slots`); until then, or where it refuses to,
   * the places are the group's own lines, and nothing is offered as missing.
   */
  readonly declared: boolean;
  /** "Ask <Mate> to fix it" on a place that is not well, where the person has a Mate to ask. */
  readonly fixOf?: ((line: PlaceLineData) => PlaceFix | undefined) | undefined;
}

/** The one verb on a place that is not well: the person's Mate, asked with the problem written. */
export interface PlaceFix {
  readonly name: string;
  readonly onAsk: () => void;
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
          <ProjectPlaces entry={entry} facts={facts} lines={lines} props={props} />
          <ProjectMates
            entry={entry}
            props={props}
            waiting={new Set(waits.map(({ wait }) => wait.mate.projectId))}
          />
          <ProjectChanges
            entry={entry}
            facts={facts}
            lines={lines}
            props={props}
            waiting={waitingChangeKeys(entry, waits)}
          />
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
        <ChangeList page>
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

/**
 * One card per place, production first: its line (which opens it) ending in its Sites and its
 * Vault, and on a place that is not well the person's Mate to ask; on production what its live release brought, then what goes to it
 * next — the page's one *Review release*, ready, on its way or refused, whoever started it — or,
 * where nothing goes next, its own note and a Put it live run. A project not live yet has Going
 * live in their place (`GoingLive`), a missing stage its optional row; a half-made place offers
 * *Finish setup*. Until HQ has told which environments exist, the places are the group's own lines, their
 * room held while none is read, so Mates and Changes never move down.
 */
function ProjectPlaces<T>({
  entry,
  props,
  facts,
  lines,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly facts: ProjectPageFacts;
  readonly lines: ReadonlyArray<PlaceLineData>;
}) {
  const groupId = entry.group.groupId;
  const { slots, environments } = facts;
  const lineOf = (projectId: string) => lines.find((line) => line.projectId === projectId);
  const nextInput = {
    release: facts.release,
    ready: cardReady(entry.flow),
    onStage: props.cardPlaces?.(entry).releaseOnStage,
  };
  const view = nextReleaseView(nextInput);
  // A release ready to go is offered only where the page's door offers it: a Put it live run
  // releases the production it makes. One on its way, or refused, is said from the flow, whoever
  // started it.
  const next =
    view.kind === "none" ||
    (view.kind === "ready" &&
      props.renderReleaseVerb !== undefined &&
      !drawn(props.renderReleaseVerb(entry)))
      ? null
      : nextInput;
  /** Production's own lines below its place line: what it brought, then what goes next. */
  const productionTail = (line: PlaceLineData | undefined, note: string | undefined) => (
    <>
      {line === undefined || line.trouble ? null : (
        <Brought brought={facts.brought} version={liveVersion(entry)} />
      )}
      {next === null ? (
        <>
          {note === undefined ? null : <p className="pp-place-note">{note}</p>}
          {props.renderProductionRun?.(entry)}
        </>
      ) : (
        <NextRelease {...next} failureSaid={line?.trouble === true} />
      )}
    </>
  );
  const fixVerb = (line: PlaceLineData) => {
    const fix = line.trouble ? facts.fixOf?.(line) : undefined;
    return fix === undefined ? undefined : (
      <Button onClick={fix.onAsk} size="sm" variant="secondary">
        Ask {fix.name} to fix it
      </Button>
    );
  };
  /** A place line's end: its fix where it is not well, then its doors, Sites and Vault. */
  const placeEnd = (line: PlaceLineData) => {
    const fix = fixVerb(line);
    const open = props.openPlaceVault;
    const vault = open === undefined ? undefined : placeVaultOf(line);
    const sites = placeSitesOf(line, groupId);
    if (vault === undefined && sites === undefined) return fix;
    return (
      <span className="flex items-center gap-2">
        {fix}
        <PlaceDoors
          look={fix === undefined ? "line" : "beside-verb"}
          name={placeLabel(line)}
          sites={sites}
          vault={
            vault === undefined || open === undefined ? undefined : { onOpen: () => open(vault) }
          }
        />
      </span>
    );
  };
  // Not live yet: production's empty slot is the Going live card, an empty stage slot its
  // optional row; every other place keeps its own card under Places.
  const productionSlot = facts.declared
    ? facts.slots.find((slot) => slot.kind === "slot" && slot.tier === "production")
    : undefined;
  const stageSlot =
    productionSlot === undefined
      ? undefined
      : facts.slots.find((slot) => slot.kind === "slot" && slot.tier === "stage");
  const placeSlots = productionFirst(slots).filter(
    (slot) => slot !== productionSlot && slot !== stageSlot,
  );
  const placeCard = (slot: EnvironmentSlotRow) => {
    if (slot.kind === "slot")
      return (
        <div className="pp-card pp-place" data-zerops-place={slot.tier} key={slot.tier}>
          <PlaceLine
            density="row"
            line={{
              projectId: undefined,
              kind: slot.tier,
              name: slot.name,
              dot: "none",
              words: [slot.tier === "stage" ? STAGE_IS_FOR : slot.line],
              trouble: false,
              addresses: [],
            }}
            trailing={
              slot.add ? (
                <Button
                  onClick={() => {
                    facts.onAdd(slot.tier);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {environmentDoorLabel(slot.tier, slot.name)}
                </Button>
              ) : undefined
            }
          />
          {slot.tier === "production" ? props.renderProductionRun?.(entry) : null}
        </div>
      );
    if (slot.kind === "devstage" || slot.kind === "creating" || slot.kind === "half-made") {
      const tier = slot.kind === "devstage" ? "stage" : slot.tier;
      return (
        <div className="pp-card pp-place" data-zerops-place={tier} key={slot.id}>
          <PlaceLine
            density="row"
            line={{
              projectId: undefined,
              kind: tier,
              name: tier,
              dot: slot.kind === "creating" ? "releasing" : "none",
              words: [slot.line],
              trouble: false,
              addresses: [],
            }}
            trailing={
              slot.kind === "half-made" && slot.finish ? (
                <Button
                  disabled={facts.finishing}
                  onClick={() => {
                    facts.onFinish(slot.id);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Finish setup
                </Button>
              ) : undefined
            }
          />
          {/* A Put it live run stands under the production it is making, its failure and
              its one fixing verb included. */}
          {tier === "production" ? props.renderProductionRun?.(entry) : null}
        </div>
      );
    }
    const environment = environments.find((row) => row.id === slot.id);
    if (environment === undefined) return null;
    if (environment.target.kind === "git")
      return (
        <div className="pp-card pp-place" data-zerops-place={environment.tier} key={slot.id}>
          <StopLine environment={environment} groupId={groupId} notice={null} />
          <GitDeliveryStatus
            delivery={environment.git}
            environment={{ target: environment.target, tier: environment.tier }}
            repos={facts.repos}
            showExpiry={false}
          />
        </div>
      );
    const { projectId } = environment.target;
    const line = lineOf(projectId);
    const notice = facts.withheldNotice?.(projectId) ?? null;
    return (
      <div
        className="group/place pp-card pp-place"
        data-zerops-place={environment.tier}
        key={slot.id}
      >
        {line === undefined || notice !== null ? (
          <StopLine
            environment={environment}
            firstDeploy={facts.firstDeployOf?.(projectId)}
            groupId={groupId}
            notice={notice}
          />
        ) : (
          // Opened by its environment, as a bookmark names it: the same through a rename.
          <PlaceLine
            density="row"
            groupId={groupId}
            line={{ ...line, projectId: environment.id }}
            trailing={placeEnd(line)}
          />
        )}
        {notice !== null ? null : environment.tier === "production" ? (
          productionTail(line, slot.note?.text)
        ) : slot.note === undefined ? null : (
          <p className="pp-place-note">{slot.note.text}</p>
        )}
      </div>
    );
  };
  return (
    <>
      {productionSlot?.kind === "slot" ? (
        <GoingLive
          name={entry.group.name}
          onAdd={facts.onAdd}
          production={productionSlot}
          run={props.renderProductionRun?.(entry)}
          stage={stageSlot?.kind === "slot" ? stageSlot : undefined}
        />
      ) : null}
      {facts.declared && placeSlots.length === 0 ? null : (
        <section
          aria-labelledby="pp-places"
          className="pp-group"
          data-zerops-surface="project-places"
        >
          <SectionLabel id="pp-places">Places</SectionLabel>
          {!facts.declared ? (
            lines.length === 0 ? (
              <div aria-busy="true" className="pp-card pp-place" data-zerops-places-held="">
                <PlaceHeld />
              </div>
            ) : (
              lines.map((line) => (
                <div
                  className="group/place pp-card pp-place"
                  data-zerops-place={line.kind}
                  key={`${line.kind}:${line.projectId ?? line.name}`}
                >
                  <PlaceLine
                    density="row"
                    groupId={groupId}
                    line={line}
                    trailing={placeEnd(line)}
                  />
                  {line.kind === "production" ? productionTail(line, undefined) : null}
                </div>
              ))
            )
          ) : (
            placeSlots.map(placeCard)
          )}
        </section>
      )}
    </>
  );
}

/**
 * A project not live yet: what putting it live gives, and its one verb; under it, quiet and
 * optional, a stage to try a change on first. A Put it live run stands in the card while it goes.
 */
function GoingLive({
  name,
  production,
  stage,
  run,
  onAdd,
}: {
  readonly name: string;
  readonly production: Extract<EnvironmentSlotRow, { kind: "slot" }>;
  readonly stage: Extract<EnvironmentSlotRow, { kind: "slot" }> | undefined;
  readonly run: ReactNode;
  readonly onAdd: ProjectPageFacts["onAdd"];
}) {
  return (
    <section
      aria-labelledby="pp-golive"
      className="pp-group"
      data-zerops-surface="project-going-live"
    >
      <SectionLabel id="pp-golive">Going live</SectionLabel>
      <div className="pp-card pp-golive" data-zerops-place="production">
        <div className="pp-golive-hero">
          <span aria-hidden="true" className="pp-golive-icon">
            <GlobeIcon className="size-5" />
          </span>
          <div className="pp-golive-text">
            <p className="pp-golive-title">{name} isn’t live yet</p>
            <p className="pp-golive-why">
              Putting it live gives {name} a production of its own: its own address, and every
              release after it.
              {production.line === ENVIRONMENT_NOT_ADDED ? null : ` ${production.line}.`}
            </p>
          </div>
          {production.add ? (
            <Button
              onClick={() => {
                onAdd("production");
              }}
            >
              {environmentDoorLabel("production", production.name)}
            </Button>
          ) : null}
        </div>
        {drawn(run) ? <div className="pp-golive-run">{run}</div> : null}
        {stage === undefined ? null : (
          <div className="pp-golive-stage" data-zerops-place="stage">
            <span>
              <strong>{stage.name}</strong> · optional · {STAGE_IS_FOR.toLocaleLowerCase()}
            </span>
            {stage.add ? (
              <Button
                onClick={() => {
                  onAdd("stage");
                }}
                size="sm"
                variant="secondary"
              >
                {environmentDoorLabel("stage", stage.name)}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/** A place's line held while none is read: its room, and nothing that will be taken back. */
function PlaceHeld() {
  return (
    <div aria-hidden="true" className="flex min-h-8 items-center gap-2">
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

/** What a stage is for, where the project has none yet. */
const STAGE_IS_FOR = "A place to try a change before production";

/** What production runs, as its version names it. */
function liveVersion<T>(entry: ProjectsFlowGroup<T>): string | undefined {
  const { production } = entry.flow;
  return "stop" in production ? production.stop.version?.label : undefined;
}

/**
 * "v0.1.3 brought: … · … · + 3" — what production's live release brought, on one wrapped line; "+ N"
 * names the rest.
 */
function Brought({
  brought,
  version,
}: {
  readonly brought: ReadonlyArray<FlowPullRequest>;
  readonly version: string | undefined;
}) {
  const [all, setAll] = useState(false);
  if (brought.length === 0 || version === undefined) return null;
  const shown = all ? brought : brought.slice(0, BROUGHT_SHOWN);
  const more = brought.length - shown.length;
  return (
    <p className="pp-brought" data-zerops-surface="project-brought">
      {version} brought: {shown.map((pull) => pull.title).join(" · ")}
      {more > 0 ? (
        <>
          {" · "}
          <button
            className="pp-brought-more"
            onClick={() => {
              setAll(true);
            }}
            type="button"
          >
            + {more}
          </button>
        </>
      ) : null}
    </p>
  );
}

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
      <div className="pp-card pp-list ov-mates-page" role="list">
        {mates.length === 0 ? (
          <p className="pp-empty">No Mates yet. Add one to start work here.</p>
        ) : (
          <PageRows value>{mates.map(draw)}</PageRows>
        )}
      </div>
    </section>
  );
}

/** A Mate being created: waking, named, how far its birth has got; its row opens the birth's page. */
function ComingMate<T>({
  mate,
  birth,
}: {
  readonly mate: Extract<FlowMateEntry<T>, { kind: "coming" }>;
  readonly birth: ComingBirthRow | undefined;
}) {
  return (
    <ComingMateRow
      face={<ComingMateFace coming={mate.coming} size={24} />}
      line={birth?.line ?? comingMateLine(mate.coming)}
      menu={birth?.menu}
      name={mate.mate.name}
      onOpen={birth?.onOpen}
      stopped={birth?.stopped ?? false}
    />
  );
}

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

/** How long a group of the list stays lit after the picture's count led to it. */
const GROUP_LIT_MS = 1400;

/**
 * The project's recent changes. First their picture (`ProjectLine`): where each change is between
 * the Mates' work, `main`, the stage and production, a bead each, a count under each segment that
 * leads to its group below; the control in its corner grows it in place into the line in full
 * (`projectLineFull`: what each station is, each further place), which this device remembers per
 * project. Then the list, less the changes Waiting on you lists: open ones each
 * with what stops it, merged ones grouped by where they went — the group's label says it once, in
 * the picture's words ("On stage, ready for production · 12"), and with one group the section's
 * label is it ("On main, not live yet · 5") — setup files last, quiet. The group a release would
 * carry names no verb: *Review release* is production's, the page's one. *All history* opens its
 * releases in place, each with the changes it put live; with no history, *All changes* lists past
 * the first few.
 */
function ProjectChanges<T>({
  entry,
  props,
  facts,
  lines,
  waiting,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly props: ZeropsProjectsFlowProps<T>;
  readonly facts: ProjectPageFacts;
  readonly lines: ReadonlyArray<PlaceLineData>;
  /** The changes Waiting on you lists for review (`changeKey`): said there, not here. */
  readonly waiting: ReadonlySet<string>;
}) {
  const [history, setHistory] = useState(false);
  const [all, setAll] = useState(false);
  const openChange = useOpenChange();
  const door = releaseDoor(entry, props, facts);
  const listed = facts.changes.filter((change) => !waiting.has(changeKey(change.pull)));
  const changes = all ? listed : listed.slice(0, PAGE_CHANGES);
  const { open, groups, setup } = changeGroups(changes);
  // A group counts every change that went there, the rows past the first few too.
  const every = changeGroups(listed).groups;
  const countOf = (group: (typeof groups)[number]) =>
    every.find((each) => each.label === group.label)?.changes.length ?? group.changes.length;
  const mateName = (projectId: string) =>
    entry.flow.mates.find((mate) => mate.projectId === projectId)?.name;
  const faceOf = (projectId: string) => {
    const item = entry.mates.get(projectId);
    return item === undefined ? undefined : props.renderMateFace(item, 20);
  };
  const historyShown = history && facts.repo !== undefined;
  // One group alone, and nothing open beside it: its place is the section's label.
  const only = open.length === 0 && groups.length === 1 ? groups[0] : undefined;
  const groupId = entry.group.groupId;
  const pictureInput = {
    flow: entry.flow,
    places: lines,
    tintOf: (projectId: string) => {
      const item = entry.mates.get(projectId);
      return item === undefined ? undefined : props.mateTint?.(item);
    },
    changes: facts.changes,
    changesKnown: facts.changesUnknown === undefined && !entry.changesAwaiting,
    waiting,
    release: door,
  };
  const picture = projectLine(pictureInput);
  // The line in full, behind the picture: remembered per project on this device, so the page
  // opens as it was left.
  const fullOpen = useUiStateStore((state) => state.projectLineFullById[groupId] === true);
  const setFullOpen = useUiStateStore((state) => state.setProjectLineFull);
  const full = projectLineFull(
    {
      ...pictureInput,
      // A place the grant withholds says so in place of its state.
      places: lines.map((line) => {
        const notice =
          line.projectId === undefined ? null : (facts.withheldNotice?.(line.projectId) ?? null);
        return notice === null
          ? line
          : { ...line, dot: "unknown", words: [notice], trouble: false, addresses: [] };
      }),
      // Opened by its environment, as a bookmark names it: the same through a rename.
      placeId: (line) =>
        facts.environments.find(
          (row) => row.target.kind === "zerops" && row.target.projectId === line.projectId,
        )?.id ?? line.projectId,
      repos: (facts.repos ?? []).map((repo) => repo.name).filter((name) => name !== RECIPE_REPO),
      coming: facts.slots.flatMap((slot) =>
        slot.kind === "devstage" || (slot.kind === "creating" && slot.tier === "stage")
          ? [{ key: slot.id, name: placeLabel({ kind: "stage", name: "stage" }), line: slot.line }]
          : [],
      ),
    },
    picture,
  );
  // A count of the picture leads to the group it counts: the list shows it, and it is lit a moment.
  const list = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ readonly group: LineGroup } | null>(null);
  useEffect(() => {
    if (shown === null) return;
    const target = list.current?.querySelector(`[data-zerops-change-group="${shown.group}"]`);
    if (!(target instanceof HTMLElement)) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "nearest" });
    target.setAttribute("data-lit", "");
    const timer = setTimeout(() => {
      target.removeAttribute("data-lit");
    }, GROUP_LIT_MS);
    return () => {
      clearTimeout(timer);
      target.removeAttribute("data-lit");
    };
  }, [shown]);
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
      <div className="pp-picture">
        <ProjectLine
          full={{
            kind: "here",
            view: full,
            groupId,
            open: fullOpen,
            onOpen: (open) => {
              setFullOpen(groupId, open);
            },
          }}
          held={entry.awaiting}
          onOpenChange={(pull, from) => {
            openChange(entry.group.groupId, pull, from);
          }}
          onShowGroup={(group) => {
            // The group may stand past the first few rows, or behind the history.
            setHistory(false);
            setAll(true);
            setShown({ group });
          }}
          view={picture}
        />
      </div>
      <div className="pp-card pp-list" data-history={historyShown ? "" : undefined} ref={list}>
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
              <ChangeList page group="open" label="Open changes">
                {open.map((change) =>
                  row(change, changeRowLine(mateName(change.pull.mateProjectId), change.words)),
                )}
              </ChangeList>
            )}
            {only === undefined ? (
              groups.map((group) => (
                <div
                  className="pp-change-group"
                  data-zerops-change-group={lineGroupOf(group)}
                  key={group.label}
                >
                  <SectionLabel count={countOf(group)} level={3}>
                    {group.label}
                  </SectionLabel>
                  <ChangeList page>
                    {group.changes.map((change) => row(change, undefined))}
                  </ChangeList>
                </div>
              ))
            ) : (
              <ChangeList page group={lineGroupOf(only)} label={only.label}>
                {only.changes.map((change) => row(change, undefined))}
              </ChangeList>
            )}
            {setup.length === 0 ? null : (
              <ChangeList label="Setup files" page>
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
