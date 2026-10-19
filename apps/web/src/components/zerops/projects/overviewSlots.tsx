import { GitDeliveryStatus } from "../GitDeliveryStatus";
/**
 * What the overview's cards are handed from the page's reads: each project's places as the left
 * menu's chips read them (`productionChip`, `stageStopChip`), each place's panel with its facts and
 * its actions, and the people on a project.
 *
 * The chips are read from the same inputs the menu reads them from — the platform's deployments
 * and services, HQ's releases — so a card's foot and the menu say the same of one production.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import {
  addressOffered as addressOfferedBy,
  formatRunClock,
  stageMarks,
  stageStandings,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { deployActivatedAt, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { useNavigate } from "@tanstack/react-router";
import { EnvironmentId, ThreadId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatShortTimestamp } from "~/timestampFormat";
import { buildPlanImplementationPrompt } from "~/proposedPlan";
import { findLatestProposedPlan } from "~/session-logic";
import { useAskMateToFix } from "~/zerops/fixRequest";
import { useMateWrite } from "~/zerops/useMateWrite";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { useOpenReview } from "~/zerops/review";
import { mainStageOf } from "../review/reviewReads";
import { mateDecision } from "../mateDecision.logic";
import { PersonAvatar } from "../primitives";
import { SidebarMateAge } from "../SidebarMateAge";
import type { MateRowSlot } from "../SidebarMateRow.logic";
import {
  buildingOf,
  drawnChip,
  productionChip,
  productionMenu,
  releaseFailureOf,
  rollbacksOf,
  stageStopChip,
  stopServing,
  type ProductionChip,
  type ReleasesAnswer,
  type StopServing,
} from "../SidebarProductionChip.logic";
import { PlacePanel, type PlacePanelModel } from "./PlacePanel";
import { PlaceServiceTiles, RoadPlace } from "./RoadPlace";
import { ActionHeld, CardActivity, CardChanges, CardMateLiftActions } from "./ProjectCards";
import {
  broughtBy,
  historyOffered,
  panelAddresses,
  CARD_CHANGES,
  cardChanges,
  cardPeople,
  releaseLineOpens,
  rollBackTarget,
  type CardMateReading,
  type CardStage,
  type PlaceLine,
} from "./projectCard.logic";
import { CHANGES_UNKNOWN_LINE } from "./projectsView.logic";
import type { PlacePanelLook, ProjectsFlowGroup } from "./ZeropsProjectsFlow";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { EllipsisIcon } from "lucide-react";

/** What a card's places need of an environment: how its services stand and where they answer. */
export interface PlaceItem {
  readonly project: { readonly id: string; readonly status?: string | undefined };
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** Ports its public address would open that are not on yet; absent while its services are unread. */
  readonly routeOffers?: ReadonlyArray<unknown> | undefined;
  readonly services?:
    | {
        readonly hostnames: ReadonlyArray<string>;
        readonly deployedAt: string | undefined;
        readonly statuses: ReadonlyArray<{
          readonly hostname: string;
          readonly status: string;
          readonly runtime: boolean;
        }>;
      }
    | undefined;
}

const UNKNOWN: StopServing = { kind: "unknown" };
const NO_UNTOLD: ReadonlyArray<string> = [];

/** A Mate the person may ask to fix a place: theirs, in the project. */
export interface PlaceFixer {
  readonly projectId: string;
  readonly name: string;
}

export function useOverviewSlots<T extends PlaceItem>(input: {
  readonly flows: ReadonlyMap<string, ZeropsProjectFlow>;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>>;
  /** The viewer's Mate in a project that would fix a place of it. */
  readonly fixerOf: (entry: ProjectsFlowGroup<T>) => PlaceFixer | undefined;
  /** A Mate's face, small: whose a change is, beside it. */
  readonly mateFace: (item: T) => ReactNode;
  readonly nowMs: number;
  /** Drawn on the project's own page, whose column already holds its history. */
  readonly onPage?: boolean | undefined;
}) {
  const { flows, deployments, nowMs } = input;
  const people = useAtomValue(shownHqProjectPeopleAtom);
  const askToFix = useAskMateToFix();
  const openReview = useOpenReview();
  const navigate = useNavigate();

  const itemOf = (entry: ProjectsFlowGroup<T>, projectId: string | undefined) =>
    projectId === undefined ? undefined : entry.stops.get(projectId)?.item;
  const servingOf = (item: T | undefined): StopServing =>
    item === undefined
      ? UNKNOWN
      : stopServing({
          projectStatus: item.project.status,
          services: item.services?.statuses,
          routes: item.routes ?? [],
        });
  const downOf = (serving: StopServing) => (serving.kind === "down" ? serving.services : []);

  /** Every place of a project as the menu's chips say it. */
  const placesOf = (entry: ProjectsFlowGroup<T>) => {
    const read = flows.get(entry.group.groupId);
    const releases: ReleasesAnswer =
      read !== undefined && read.releasesKnown
        ? {
            kind: "answered",
            failure: releaseFailureOf({
              releases: read.releases,
              environmentInputs: read.environmentInputs,
            }),
            rollbacks: rollbacksOf(read.releases),
          }
        : { kind: "waiting" };
    const deploymentsOf = (id: string) => {
      const row = read?.environments.find((environment) => environment.id === id);
      const projectId =
        row === undefined
          ? entry.stops.get(id)?.item?.project.id
          : row.target.kind === "zerops"
            ? row.target.projectId
            : undefined;
      return projectId === undefined ? undefined : deployments.get(projectId);
    };
    const { production } = entry.flow;
    const prodStop = "stop" in production ? production.stop : undefined;
    const prodItem = itemOf(entry, prodStop?.projectId);
    const prodServing = servingOf(prodItem);
    const chip = drawnChip(
      productionChip({
        production,
        building:
          prodStop === undefined ? undefined : buildingOf(deploymentsOf(prodStop.projectId)),
        waiting: entry.flow.main.notLive,
        waitingAtLeast: entry.flow.main.notLiveAtLeast,
        untold: read?.release.untold ?? NO_UNTOLD,
        serving: prodServing,
        releases,
      }),
    );
    const stageChips = new Map<string, ProductionChip | undefined>();
    const down = new Map<string, ReadonlyArray<string>>();
    const addressOffered = new Map<string, boolean>();
    if (prodStop !== undefined) down.set(prodStop.projectId, downOf(prodServing));
    for (const stop of entry.flow.stages) {
      const item = itemOf(entry, stop.projectId);
      const serving = servingOf(item);
      down.set(stop.projectId, downOf(serving));
      const offered = item === undefined ? undefined : addressOfferedBy(item);
      if (offered !== undefined) addressOffered.set(stop.projectId, offered);
      stageChips.set(stop.projectId, drawnChip(stageStopChip({ stop, serving, releases })));
    }
    const since =
      prodStop === undefined
        ? undefined
        : (deployActivatedAt(deploymentsOf(prodStop.projectId)) ?? prodItem?.services?.deployedAt);
    // When each stage last took a deploy, as its services say it.
    const stageSince = new Map<string, string>();
    for (const stop of entry.flow.stages) {
      const at =
        deployActivatedAt(deploymentsOf(stop.projectId)) ??
        itemOf(entry, stop.projectId)?.services?.deployedAt;
      if (at !== undefined) stageSince.set(stop.projectId, at);
    }
    // The release on its way, where it is a roll back: production's line says what it goes back to.
    const rollsBackTo = chip?.rollsBackTo;
    return {
      read,
      releases,
      chip,
      stageChips,
      down,
      addressOffered,
      rollsBackTo,
      since,
      stageSince,
      prodItem,
      prodStop,
    };
  };

  /**
   * What the stage that follows `main` runs, as HQ's deploys say it, and whether it runs every
   * change a release would carry — `undefined` while either is unread.
   */
  const stageOf = (entry: ProjectsFlowGroup<T>) => {
    const read = flows.get(entry.group.groupId);
    const environment = read === undefined ? undefined : mainStageOf(read);
    if (read === undefined || environment === undefined) return undefined;
    const standings = stageStandings(environment);
    const mainHeads = new Map(
      (read.repos ?? []).flatMap(({ name, mainHead }) =>
        mainHead === null ? [] : [[name, mainHead] as const],
      ),
    );
    const marks = stageMarks({ contents: read.release.contents, stage: standings, mainHeads });
    const stage: CardStage = {
      runs: [...standings.runs.values()].filter((sha) => sha !== undefined),
      deploying: [...standings.deploying.values()],
      mainHeads,
    };
    return {
      stage,
      runsRelease:
        marks.size === 0 ? undefined : [...marks.values()].every((mark) => mark === "on-stage"),
    };
  };

  const cardPlaces = (entry: ProjectsFlowGroup<T>) => {
    const { chip, stageChips, down, addressOffered, rollsBackTo, since, stageSince, releases } =
      placesOf(entry);
    return {
      chip,
      stageChips,
      down,
      addressOffered,
      rollsBackTo,
      since,
      stageSince,
      failedTag: releases.kind === "answered" ? releases.failure?.tag : undefined,
      releaseOnStage: stageOf(entry)?.runsRelease,
    };
  };

  const renderPlacePanel = (
    entry: ProjectsFlowGroup<T>,
    line: PlaceLine,
    look?: PlacePanelLook,
  ): ReactNode => {
    const places = placesOf(entry);
    const { read, chip } = places;
    const groupId = entry.group.groupId;
    const fixer = input.fixerOf(entry);
    const stop =
      line.kind === "production"
        ? places.prodStop
        : entry.flow.stages.find((stage) => stage.projectId === line.projectId);
    const gitEnvironment = read?.environments.find(
      (environment) => environment.id === line.projectId,
    );
    if (gitEnvironment?.target.kind === "git")
      return (
        <div className="ov-panel">
          <GitDeliveryStatus
            environment={{ target: gitEnvironment.target, tier: gitEnvironment.tier }}
            delivery={gitEnvironment.git}
            repos={read?.repos}
          />
          <Button
            onClick={() => {
              void navigate({
                to: "/group/$groupId/$projectId",
                params: { groupId, projectId: gitEnvironment.id },
              });
            }}
            variant="secondary"
          >
            Details and history
          </Button>
        </div>
      );
    const item = itemOf(entry, line.projectId);
    const menu =
      line.kind === "production" && chip !== undefined
        ? productionMenu({
            chip,
            projectId: line.projectId,
            failure: places.releases.kind === "answered" ? places.releases.failure : undefined,
            down: places.down.get(line.projectId ?? "") ?? [],
            routes: item?.routes ?? [],
            nowMs,
          }).stops[0]
        : undefined;
    const note =
      menu?.note !== undefined
        ? {
            text: menu.note,
            tone: menu.tone === "red" ? ("failed" as const) : ("attention" as const),
          }
        : line.trouble
          ? {
              text: line.words.join(" · "),
              tone: line.dot === "down" ? ("failed" as const) : ("attention" as const),
            }
          : undefined;
    const releases = read?.releasesKnown === true ? read.releases : [];
    const back = line.kind === "production" && !line.trouble ? rollBackTarget(releases) : undefined;
    const down = places.down.get(line.projectId ?? "") ?? [];
    const model: PlacePanelModel = {
      line,
      version: stop?.version?.label,
      note,
      // What the release brought is the card's Changes, under its tag: an overview card says it
      // once (the onboarding run listed it twice); the project's own page names it in full.
      brought:
        line.kind === "production" && !line.trouble && input.onPage === true
          ? broughtBy(read?.merged ?? [], releases).map((pull) => ({
              key: `${pull.repository}#${String(pull.number)}`,
              title: `#${String(pull.number)} ${pull.title}`,
            }))
          : [],
      services: (item?.services?.statuses ?? []).map((service) => ({
        hostname: service.hostname,
        state: down.includes(service.hostname)
          ? ("down" as const)
          : service.status === "STOPPED"
            ? ("stopped" as const)
            : ("up" as const),
      })),
    };
    const problem = menu?.fix;
    const openStop =
      line.projectId === undefined
        ? undefined
        : () => {
            void navigate({
              to: "/group/$groupId/$projectId",
              params: { groupId, projectId: line.projectId ?? "" },
            });
          };
    const actions = line.trouble ? (
      <>
        {fixer === undefined ? null : (
          <Button
            onClick={() => {
              askToFix(
                fixer.projectId,
                problem ?? {
                  what: `The ${line.name} ${line.words.join(", ").toLowerCase()}`,
                  ask: "Find out why and fix it.",
                },
              );
            }}
          >
            Ask {fixer.name} to fix it
          </Button>
        )}
        {openStop === undefined ? null : (
          <Button onClick={openStop} variant="secondary">
            Open logs
          </Button>
        )}
      </>
    ) : line.kind === "production" ? (
      <>
        {back === undefined ? null : (
          <Button
            onClick={(event) => {
              openReview({ kind: "rollback", groupId, tag: back }, { from: event.currentTarget });
            }}
            variant="secondary"
          >
            Roll back to {back}
          </Button>
        )}
        {/* Its releases, once it runs one (`historyOffered`) — and on the project's own page its
            history stands beside the card. Its first release on its way holds History's room, so
            the release lands moving nothing (the run's card grew 42 px as it landed) — through the
            beat production's chip names what it runs before the flow's releases say it. */}
        {input.onPage === true ? null : historyOffered({
            releases: releases.length,
            runs: stop?.version !== undefined,
          }) ? (
          <Button
            onClick={() => {
              void navigate({ to: "/group/$groupId/flow", params: { groupId } });
            }}
            variant="secondary"
          >
            History
          </Button>
        ) : entry.flow.production.kind === "releasing" ||
          (line.dot === "running" && (chip?.version ?? stop?.version) !== undefined) ? (
          <ActionHeld>History</ActionHeld>
        ) : null}
      </>
    ) : null;
    if (look === "detail") {
      return (
        <RoadPlace
          actions={line.trouble ? actions : null}
          menu={
            back === undefined ? null : (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      aria-label={`More for ${line.kind === "production" ? "production" : line.name}`}
                      size="icon-sm"
                      variant="ghost"
                    />
                  }
                >
                  <EllipsisIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    onClick={(event) => {
                      openReview(
                        { kind: "rollback", groupId, tag: back },
                        { from: event.currentTarget },
                      );
                    }}
                  >
                    Roll back to {back}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            )
          }
          model={{ line, note: line.trouble ? note : undefined }}
          tiles={<PlaceServiceTiles projectId={line.projectId} />}
        />
      );
    }
    // A release on its way is production's line alone: the line opens its review, as the card's
    // own block of it did — a roll back's by the release it goes back to.
    const opens = releaseLineOpens(line, entry.flow.production, places.rollsBackTo);
    return (
      <PlacePanel
        actions={actions}
        groupId={groupId}
        look={look}
        model={model}
        onOpenLine={
          opens === undefined
            ? undefined
            : (from) => {
                openReview(
                  opens.kind === "release"
                    ? { kind: "release", groupId }
                    : { kind: "rollback", groupId, tag: opens.tag },
                  { from },
                );
              }
        }
        roomy={input.onPage === true}
      />
    );
  };

  /**
   * A project's latest changes (`cardChanges`): its open ones, read for every project, and — while
   * the card holds its detail — the merged ones, each with where it went. A click opens its review.
   */
  const renderChanges = (entry: ProjectsFlowGroup<T>): ReactNode => {
    const read = flows.get(entry.group.groupId);
    const changes = cardChanges({
      open: entry.flow.pullRequests.map((change) => change.pull),
      merged: read?.merged ?? [],
      releases: read?.releasesKnown === true ? read.releases : [],
      // A stage whose deploys are unread runs nothing this can tell.
      stage:
        entry.flow.stages.length === 0
          ? undefined
          : (stageOf(entry)?.stage ?? { runs: [], deploying: [], mainHeads: new Map() }),
      production: entry.flow.production.kind !== "absent",
      limit: CARD_CHANGES,
    });
    const mateName = (projectId: string) =>
      entry.flow.mates.find((mate) => mate.projectId === projectId)?.name;
    const releases =
      read?.releasesKnown === true
        ? read.releases.map((release) => ({
            tag: release.tag,
            taggedAt: release.taggedAt,
            live: release.standing === "live",
          }))
        : [];
    return (
      <CardChanges
        changes={changes}
        changesFailure={read?.changesFailure}
        changesKnown={read?.changesKnown === true}
        face={(projectId) => {
          const item = entry.mates.get(projectId);
          return item === undefined ? undefined : input.mateFace(item);
        }}
        mateName={mateName}
        releases={releases}
        unknown={
          entry.changesUnknown === undefined
            ? undefined
            : CHANGES_UNKNOWN_LINE[entry.changesUnknown]
        }
        onOpen={(change, from) => {
          openReview(
            {
              kind: "change",
              groupId: entry.group.groupId,
              repository: change.pull.repository,
              number: change.pull.number,
            },
            { from },
          );
        }}
        onShowAll={
          input.onPage === true
            ? undefined
            : () => {
                void navigate({
                  to: "/group/$groupId/flow",
                  params: { groupId: entry.group.groupId },
                });
              }
        }
      />
    );
  };

  /** The people on a project — its Mates' owners — beside its name, where more than one. */
  const renderCardPeople = (entry: ProjectsFlowGroup<T>): ReactNode => {
    const owners = cardPeople(
      [...entry.mates.values()].map((item) => people[item.project.id]?.owner ?? null),
    );
    if (owners.length === 0) return null;
    return (
      <span className="ov-card-people">
        {owners.map((owner) => (
          <PersonAvatar
            key={owner.userId}
            name={owner.name}
            picture={owner.avatarUrl ?? null}
            size={20}
          />
        ))}
      </span>
    );
  };

  /**
   * The newest event a card does not say above: the latest merged change, with its Mate's face,
   * whose it is, and how long ago — none where nothing merged is read.
   */
  const renderActivity = (entry: ProjectsFlowGroup<T>): ReactNode => {
    const latest = (flows.get(entry.group.groupId)?.merged ?? [])
      .filter((pull) => pull.kind === "code" && pull.mergedAt !== undefined)
      .toSorted((left, right) => (right.mergedAt ?? "").localeCompare(left.mergedAt ?? ""))[0];
    if (latest === undefined) return null;
    const item = entry.mates.get(latest.mateProjectId);
    const by = entry.flow.mates.find((mate) => mate.projectId === latest.mateProjectId)?.name;
    return (
      <CardActivity
        at={latest.mergedAt}
        face={item === undefined ? undefined : input.mateFace(item)}
        nowMs={nowMs}
        onOpen={(from) => {
          openReview(
            {
              kind: "change",
              groupId: entry.group.groupId,
              repository: latest.repository,
              number: latest.number,
            },
            { from },
          );
        }}
        words={`${by ?? "A Mate"} merged “${latest.title}”`}
      />
    );
  };

  return { cardPlaces, renderPlacePanel, renderChanges, renderCardPeople, renderActivity };
}

/** A working Mate's clock, a step a second (R6). */
function CardClock({ since }: { readonly since: string }) {
  const nowMs = useSecondsNowMs(true);
  return <>{formatRunClock(nowMs - Date.parse(since))}</>;
}

/**
 * The right of a Mate's name on a card, as its menu row says it: when it last did something, the
 * run's clock while it works, or when it picks up again after a usage limit.
 */
export function CardMateSlot({
  slot,
  at,
}: {
  readonly slot: MateRowSlot;
  readonly at: string | undefined;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  switch (slot.kind) {
    case "none":
      return null;
    case "clock":
      return <CardClock since={slot.since} />;
    case "paused":
      return <>{formatShortTimestamp(slot.until, timestampFormat)}</>;
    case "age":
      return <SidebarMateAge at={at} />;
  }
}

/**
 * A lifted Mate's buttons, answered in place as the menu's Waiting on you list answers them
 * (`useMateWrite`): Approve plan sends its plan to be built, Change it… asks for another; a
 * question's options and Answer… answer it; an approval's choices decide it. What cannot be
 * answered here — several questions at once, a Mate with no conversation open — opens it.
 */
export function CardMateWrite({
  name,
  lift,
  environmentId,
  threadId,
  onOpen,
  onAsk,
  onFix,
  onReview,
}: {
  readonly name: string;
  readonly lift: NonNullable<CardMateReading["lift"]>;
  readonly environmentId: string | undefined;
  readonly threadId: string | undefined;
  /** Opens its conversation. */
  readonly onOpen: () => void;
  /** Asks it in words through its conversation, where nothing answers in place. */
  readonly onAsk: (text: string) => void;
  readonly onFix: () => void;
  readonly onReview: (from: HTMLElement) => void;
}) {
  const write = useMateWrite(
    environmentId === undefined ? null : EnvironmentId.make(environmentId),
    threadId === undefined ? null : ThreadId.make(threadId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { detail, requests } = write;
  const settle = (pending: ReturnType<typeof write.send>) => {
    if (pending === undefined) {
      setError("Not sent: its conversation is still being read.");
      return;
    }
    setBusy(true);
    setError(undefined);
    void pending.then((result) => {
      setBusy(false);
      if (result._tag !== "Success" && !isAtomCommandInterrupted(result))
        setError("Not sent. Try again.");
    });
  };
  const shared = { name, lift, onFix, onReview, busy, error };
  const inPlace = environmentId !== undefined && threadId !== undefined;
  if (lift.kind === "plan") {
    const plan =
      detail === undefined
        ? null
        : findLatestProposedPlan(detail.proposedPlans, detail.latestTurn?.turnId ?? null);
    return (
      <CardMateLiftActions
        {...shared}
        onApprove={
          !inPlace
            ? onOpen
            : plan === null
              ? undefined
              : () =>
                  settle(write.send(buildPlanImplementationPrompt(plan.planMarkdown), "default"))
        }
        onReply={(text) => (inPlace ? settle(write.send(text, "plan")) : onAsk(text))}
      />
    );
  }
  if (lift.kind !== "question") {
    return <CardMateLiftActions {...shared} onApprove={undefined} onReply={onAsk} />;
  }
  const decision = mateDecision({
    name,
    kind: requests.approvals.length > 0 ? "approval" : "input",
    read: detail !== undefined,
    approvals: requests.approvals,
    userInputs: requests.userInputs,
    failure: undefined,
  });
  if (decision?.kind === "approval")
    return (
      <CardMateLiftActions
        {...shared}
        allowText={false}
        choices={decision.choices.map((choice) => ({
          label: choice.label,
          primary: choice.primary,
          onPick: () =>
            settle(write.decide(decision.requestId, choice.value as ProviderApprovalDecision)),
        }))}
        onApprove={undefined}
        onReply={onAsk}
      />
    );
  if (decision?.kind === "question")
    return (
      <CardMateLiftActions
        {...shared}
        allowText={decision.allowText}
        choices={decision.choices.map((choice) => ({
          label: choice.label,
          primary: false,
          onPick: () => settle(write.answer(decision.requestId, decision.questionId, choice.value)),
        }))}
        onApprove={undefined}
        onReply={(text) => settle(write.answer(decision.requestId, decision.questionId, text))}
      />
    );
  // Still being read, several questions at once, or nothing open to answer in: its conversation.
  return (
    <CardMateLiftActions
      {...shared}
      busy={busy || (inPlace && decision?.kind === "reading")}
      onApprove={undefined}
      onReply={(text) => (decision?.kind === "questions" ? onOpen() : onAsk(text))}
    />
  );
}
