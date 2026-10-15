import {
  buildZeropsGroupTree,
  groupFlow,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";

import { CardMate } from "~/components/zerops/projects/ProjectCards";
import { cardMateReading } from "~/components/zerops/projects/projectCard.logic";
import type {
  ProjectsFlowGroup,
  ZeropsProjectsFlowProps,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { MateFace } from "~/components/zerops/primitives";

/**
 * One project on the overview: two Mates and a stage, as `ProjectCards` draws it. Built from the
 * same pure pieces the page's own flow reads (`buildZeropsGroupTree`, `groupFlow`), with invented
 * names and no account behind them.
 */
interface KitItem {
  readonly project: ZeropsProject;
  readonly mate: boolean;
}

function item(id: string, name: string, kind: "mate" | "stage"): KitItem {
  return {
    project: {
      id,
      name,
      status: "ACTIVE",
      tagList: [],
      hq: { appId: "kit-shop", appName: "Acme Shop", kind, mate: null },
    },
    mate: kind === "mate",
  };
}

const ITEMS: ReadonlyArray<KitItem> = [
  item("kit-shop-wren", "Wren", "mate"),
  item("kit-shop-uma", "Uma", "mate"),
  item("kit-shop-stage", "stage", "stage"),
];

const ASKS: Readonly<Record<string, string>> = {
  "kit-shop-wren": "Add a size guide under the product photos",
  "kit-shop-uma": "Send the order mail from the shop's own address",
};

function kitGroups(): ReadonlyArray<ProjectsFlowGroup<KitItem>> {
  const tree = buildZeropsGroupTree(ITEMS, { order: "name" });
  return tree.groups.map(({ group, environments }) => {
    const members = environments.map(({ item: member }) => member);
    const mates = members.filter((member) => member.mate);
    return {
      group,
      flow: groupFlow({
        groupId: group.groupId,
        mates: mates.map((mate) => ({
          projectId: mate.project.id,
          name: mate.project.name,
          previews: [],
          waiting: false,
          talked: true,
        })),
        pullRequests: [],
        merged: [],
        stops: [],
        release: {
          gate: { allowed: false, reason: "Nothing is merged to release." },
          suggestion: "v0.1.0",
          waiting: 0,
          waitingAtLeast: false,
          untold: [],
        },
        mainHasCode: undefined,
        mainHead: undefined,
        pending: [],
      }),
      activities: [],
      awaiting: false,
      changesAwaiting: false,
      mates: new Map(mates.map((mate) => [mate.project.id, mate])),
      stops: new Map(),
      others: [],
      lastMerged: undefined,
      line: undefined,
      placeholder: false,
    };
  });
}

export const KIT_OVERVIEW_GROUPS = kitGroups();

export const KIT_OVERVIEW_PROPS: ZeropsProjectsFlowProps<KitItem> = {
  getKey: (value) => value.project.id,
  groups: KIT_OVERVIEW_GROUPS,
  isMate: (value) => value.mate,
  onRetryContainers: () => {},
  renderEnvironment: () => null,
  renderGroupMenu: () => null,
  renderMate: (value) => (
    <CardMate
      face={<MateFace size="md" state="working" tint="olive" />}
      name={value.project.name}
      onOpen={() => {}}
      reading={cardMateReading({
        view: { state: "working", ask: ASKS[value.project.id], reply: undefined },
        mine: false,
        review: undefined,
        status: undefined,
        read: true,
      })}
      time="2m"
    />
  ),
  renderMateFace: () => <MateFace size="sm" state="idle" tint="olive" />,
  openMate: () => undefined,
  hqCard: null,
  ungrouped: [],
};
