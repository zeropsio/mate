/**
 * What the overview's cards are handed from the page's reads: each project's places as the left
 * menu's chips read them (`productionChip`, `stageStopChip`), each place's panel with its facts and
 * its actions, and the people on a project.
 *
 * The chips are read from the same inputs the menu reads them from — the platform's deployments
 * and services, HQ's releases — so a card's foot and the menu say the same of one production.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsProjectFlow } from "@t3tools/client-runtime/data";
import { shownHqProjectPeopleAtom } from "@t3tools/client-runtime/data";
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
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
import { mateDecision } from "../mateDecision.logic";
import { Avatar } from "../primitives";
import { SidebarMateAge } from "../SidebarMateAge";
import type { MateRowSlot } from "../SidebarMateRow.logic";
import { formatWorkingTime } from "../SidebarZeropsTree.logic";
import {
  buildingOf,
  drawnChip,
  productionChip,
  productionMenu,
  releaseFailureOf,
  stageStopChip,
  stopServing,
  type ProductionChip,
  type ReleasesAnswer,
  type StopServing,
} from "../SidebarProductionChip.logic";
import { PlacePanel, type PlacePanelModel } from "./PlacePanel";
import { CardChanges, CardMateLiftActions } from "./ProjectCards";
import {
  broughtBy,
  CARD_CHANGES,
  cardChanges,
  cardPeople,
  rollBackTarget,
  type CardMateReading,
  type PlaceLine,
} from "./projectCard.logic";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

/** What a card's places need of an environment: how its services stand and where they answer. */
export interface PlaceItem {
  readonly project: { readonly id: string; readonly status?: string | undefined };
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
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
  readonly nowMs: number;
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
          }
        : { kind: "waiting" };
    const { production } = entry.flow;
    const prodStop = "stop" in production ? production.stop : undefined;
    const prodItem = itemOf(entry, prodStop?.projectId);
    const prodServing = servingOf(prodItem);
    const chip = drawnChip(
      productionChip({
        production,
        building:
          prodStop === undefined ? undefined : buildingOf(deployments.get(prodStop.projectId)),
        waiting: entry.flow.main.notLive,
        waitingAtLeast: entry.flow.main.notLiveAtLeast,
        untold: read?.release.untold ?? NO_UNTOLD,
        serving: prodServing,
        releases,
      }),
    );
    const stageChips = new Map<string, ProductionChip | undefined>();
    const down = new Map<string, ReadonlyArray<string>>();
    if (prodStop !== undefined) down.set(prodStop.projectId, downOf(prodServing));
    for (const stop of entry.flow.stages) {
      const serving = servingOf(itemOf(entry, stop.projectId));
      down.set(stop.projectId, downOf(serving));
      stageChips.set(stop.projectId, drawnChip(stageStopChip({ stop, serving, releases })));
    }
    const since =
      prodStop === undefined
        ? undefined
        : (deployActivatedAt(deployments.get(prodStop.projectId)) ??
          prodItem?.services?.deployedAt);
    return { read, releases, chip, stageChips, down, since, prodItem, prodStop };
  };

  const cardPlaces = (entry: ProjectsFlowGroup<T>) => {
    const { chip, stageChips, down, since } = placesOf(entry);
    return { chip, stageChips, down, since };
  };

  const renderPlacePanel = (entry: ProjectsFlowGroup<T>, line: PlaceLine): ReactNode => {
    const places = placesOf(entry);
    const { read, chip } = places;
    const groupId = entry.group.groupId;
    const fixer = input.fixerOf(entry);
    const stop =
      line.kind === "production"
        ? places.prodStop
        : entry.flow.stages.find((stage) => stage.projectId === line.projectId);
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
      brought:
        line.kind === "production" && !line.trouble
          ? broughtBy(read?.merged ?? [], releases).map((pull) => ({
              key: `${pull.repository}#${String(pull.number)}`,
              title: `#${String(pull.number)} ${pull.title}`,
            }))
          : [],
      route: stop?.route,
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
          <button
            className="ov-btn"
            data-main="true"
            onClick={() => {
              askToFix(
                fixer.projectId,
                problem ?? {
                  what: `The ${line.name} ${line.words.join(", ").toLowerCase()}`,
                  ask: "Find out why and fix it.",
                },
              );
            }}
            type="button"
          >
            Ask {fixer.name} to fix it
          </button>
        )}
        {openStop === undefined ? null : (
          <button className="ov-btn" onClick={openStop} type="button">
            Open logs
          </button>
        )}
      </>
    ) : line.kind === "production" ? (
      <>
        {back === undefined ? null : (
          <button
            className="ov-btn"
            onClick={(event) => {
              openReview({ kind: "rollback", groupId, tag: back }, { from: event.currentTarget });
            }}
            type="button"
          >
            Roll back to {back}
          </button>
        )}
        {/* Its releases, where it has any: nothing released has no history to open. */}
        {releases.length === 0 ? null : (
          <button
            className="ov-btn"
            onClick={() => {
              void navigate({ to: "/group/$groupId/flow", params: { groupId } });
            }}
            type="button"
          >
            History
          </button>
        )}
      </>
    ) : null;
    return <PlacePanel actions={actions} model={model} />;
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
      stage: entry.flow.stages.length > 0,
      production: entry.flow.production.kind !== "absent",
      limit: CARD_CHANGES,
    });
    if (changes.length === 0) return null;
    const mateName = (projectId: string) =>
      entry.flow.mates.find((mate) => mate.projectId === projectId)?.name;
    return (
      <CardChanges
        changes={changes}
        mateName={mateName}
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
          <Avatar
            className="size-5 text-3xs"
            initials={initialsOf(owner.name)}
            key={owner.userId}
            src={owner.avatarUrl ?? null}
          />
        ))}
      </span>
    );
  };

  return { cardPlaces, renderPlacePanel, renderChanges, renderCardPeople };
}

/** "Ada Lovelace" → "AL"; one name → its first letter. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u);
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join("");
}

/** A working Mate's clock, a step a second (R6). */
function CardClock({ since }: { readonly since: string }) {
  const nowMs = useSecondsNowMs(true);
  return <>{formatWorkingTime(nowMs - Date.parse(since))}</>;
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
