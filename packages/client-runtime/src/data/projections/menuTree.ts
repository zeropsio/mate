/**
 * The menu's one tree: HQ's records of the organization, each member naming its project id, by
 * which the menu's rows join the person's own Zerops roster. HQ decides what the person sees: its
 * applications are the groups, its environments, Mates and open births their members and, as their
 * presses, the stages and productions it holds a setup press of and lists no project of yet; its
 * Mates and births in no application are the ungrouped ones; a Chief is placed by HQ's own Chief
 * fields. A birth
 * and the Mate born of it are one member, keyed by the birth from its first frame to long after its
 * hello, so a new Mate's row is never drawn twice and never changes key. The roster never removes a
 * member: one whose project it does not list yet keeps its place. A roster project HQ names
 * nowhere, without HQ's birth tag, is a Platform project. HQ listing nothing for the person is the
 * account's first run (`listsNothing`), so the menu and the first run move at the same HQ frame
 * and a roster that lags HQ hides no member HQ lists. Every order is HQ's own times; no clock
 * of this tab, no press of its own. Until every record HQ lists is read, the tree holds nothing and
 * says where HQ's first answer stands (`MenuTreeState`): the menu paints at that answer, never
 * before it and never later.
 *
 * What a surface does with it — Mine first, the person's own order, folds, Platform shown — is the
 * surface's.
 *
 * @module data/projections/menuTree
 */
import type { HqHiddenEnvironment } from "@t3tools/shared/hqStream";

import { readBirthIntent, type BirthIntent } from "../../zerops/birthIntent.ts";
import {
  hqAppsScope,
  hqBirthsScope,
  hqPressesScope,
  placementsScope,
  type HqAppValue,
  type HqBirthValue,
  type PlacementValue,
} from "../families/hqNavigation.ts";
import { projectsScope, type ProjectValue } from "../families/project.ts";
import { linkKeys, type FamilyValues } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { streamTrouble } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";
import { hqLinkOf } from "./hqLink.ts";
import { mateVisibility } from "./mateVisibility.ts";

/** The tag HQ puts on the project of a birth it runs: `mb-` and the birth's id (mate-hq `birth.Tag`). */
const BIRTH_TAG_PREFIX = "mb-";

/** A Mate HQ holds, or one it is making: its open birth, its placement from the hello on, or both. */
export interface MenuMate {
  readonly kind: "mate";
  /** Its birth's id while it has one (`mate.birthId`, else the birth's own), else its project's. */
  readonly key: string;
  /** Its Zerops project, once HQ names one; `null` while its birth has none. */
  readonly projectId: string | null;
  /** HQ's `bornAt` of its Mate, or its birth's `startedAt`: one value, its one clock. */
  readonly bornAt: string | undefined;
  /** Its open birth; `null` once it ended, or for a Mate HQ recorded without one. */
  readonly birth: HqBirthValue | null;
  /** What its birth was asked to make, as HQ keeps it; absent without an open birth or unreadable. */
  readonly intent: BirthIntent | undefined;
  /** HQ's placement of its project; `null` before the hello. */
  readonly placement: PlacementValue | null;
  /** Whether the person may open it or only see it listed (`mateVisibility`); never a filter. */
  readonly visibility: "open" | "listed" | "unknown";
}

/** One of an application's environments, in HQ's order. */
export interface MenuEnvironment {
  readonly kind: "environment";
  /** Its environment id. */
  readonly key: string;
  readonly environment: NonNullable<HqAppValue["environments"]>[number];
  /** Its Zerops project; `null` for a Git or outside one. */
  readonly projectId: string | null;
  readonly placement: PlacementValue | null;
}

/** A project HQ places in an application that is neither one of its Mates nor its environments. */
export interface MenuPlaced {
  readonly kind: "placed";
  /** Its project id. */
  readonly key: string;
  readonly projectId: string;
  readonly placement: PlacementValue;
}

export type MenuMember = MenuEnvironment | MenuPlaced | MenuMate;

/**
 * A stage or a production HQ holds a setup press of (S13b) and lists its project neither as an
 * environment nor as a placement yet: one being set up now, which no birth stands for when no Mate
 * is born with it.
 */
export interface MenuPress {
  /** Its Zerops project. */
  readonly projectId: string;
  readonly tier: "stage" | "production";
}

export interface MenuGroup {
  /** HQ's application id. */
  readonly id: string;
  /** HQ's name; absent while unsaid. */
  readonly name: string | undefined;
  /** When HQ created it. */
  readonly createdAt: string | undefined;
  /** HQ holds nothing of it but its repository (`contents.empty`). */
  readonly empty: boolean;
  /** Its stages and productions the person's token does not reach: the ask-for-access line. */
  readonly hiddenEnvironments: ReadonlyArray<HqHiddenEnvironment>;
  /** Its environments (stage, then production, each in HQ's order), placed projects, then Mates. */
  readonly members: ReadonlyArray<MenuMember>;
  /** Its stages and productions being set up (`MenuPress`); a stopped press is half-made, none. */
  readonly presses: ReadonlyArray<MenuPress>;
}

/**
 * Where HQ's word on the organization stands for the menu: `known` from HQ's first navigation
 * answer on, and through HQ going away after it, since what it said stands. Before it: `loading`
 * while that answer is still coming, `refused` while HQ refuses it, and `unreachable` while HQ's
 * link or its navigation keeps failing past a first try's grace (`streamTrouble`).
 */
export type MenuTreeState = "loading" | "known" | "refused" | "unreachable";

export interface MenuTree {
  /** Until `known`, the tree holds no HQ members and names no Platform project. */
  readonly state: MenuTreeState;
  /** HQ's applications, newest first, each with its members. */
  readonly groups: ReadonlyArray<MenuGroup>;
  /**
   * HQ's Mates and births in no application, by their clock — and those whose application HQ no
   * longer lists, so a Mate is never lost with its application's record.
   */
  readonly ungrouped: ReadonlyArray<MenuMate>;
  /** Roster projects HQ names nowhere and that carry no birth tag, newest first. */
  readonly platform: ReadonlyArray<ProjectValue>;
  /** The roster's open or listed verdict by project; a project not judged yet is absent. */
  readonly projectVisibilities: Readonly<Record<string, "open" | "listed">>;
  /**
   * HQ's applications the tree draws no group for, once HQ said its whole list of them, so a page
   * opened on one says why instead of waiting; none while that list is partial.
   */
  readonly undrawn: ReadonlyArray<string>;
  /**
   * HQ lists nothing of the organization for the person — no application, no placement (their own
   * Chief's included), no birth — so nothing of Mate's is theirs there yet: the account's first run.
   * The roster never says it, as it never removes a member; only a `known` tree does.
   */
  readonly listsNothing: boolean;
}

/** The tree before HQ answered, or with no organization in view: nothing drawn from it. */
export const MENU_LOADING: MenuTree = {
  state: "loading",
  groups: [],
  ungrouped: [],
  platform: [],
  projectVisibilities: {},
  undrawn: [],
  listsNothing: false,
};
const MENU_REFUSED: MenuTree = { ...MENU_LOADING, state: "refused" };
const MENU_UNREACHABLE: MenuTree = { ...MENU_LOADING, state: "unreachable" };

/** The tree while nothing of HQ's navigation is delivered: where its first answer stands. */
function unanswered(read: ProjectionReads, orgId: string): MenuTree {
  const streams = [read.stream(linkKeys.hq(orgId)), read.stream(hqAppsScope(orgId))];
  if (streams.some((stream) => stream.phase === "refused")) return MENU_REFUSED;
  return hqLinkOf(read, orgId).kind !== "live" &&
    streams.some((stream) => streamTrouble(stream) !== null)
    ? MENU_UNREACHABLE
    : MENU_LOADING;
}

/**
 * The records a scope of HQ's lists, each with its value; `undefined` while one is not read yet, so
 * the tree is never drawn from part of HQ's word. One HQ withdrew (`withheld`) or removed is gone.
 */
function listed<F extends "hqApp" | "placement" | "hqBirth">(
  read: ProjectionReads,
  family: F,
  scope: Parameters<ProjectionReads["members"]>[0],
): ReadonlyArray<{ readonly id: string; readonly value: FamilyValues[F] }> | undefined {
  const records: Array<{ readonly id: string; readonly value: FamilyValues[F] }> = [];
  for (const id of read.members(scope).ids) {
    const fact = read.fact(family, id);
    switch (fact.kind) {
      case "known":
        records.push({ id, value: fact.value });
        break;
      case "unknown":
        return undefined;
      case "withheld":
      case "deleted":
        break;
    }
  }
  return records;
}

/** Older first by HQ's time, then by key: a time unsaid sorts as the earliest. */
const byClock = (left: MenuMate, right: MenuMate) =>
  (left.bornAt ?? "").localeCompare(right.bornAt ?? "") || left.key.localeCompare(right.key);

const TIER_RANK = { stage: 0, production: 1 } as const;

const NO_PRESSES: ReadonlyArray<MenuPress> = [];

/**
 * Each birth joined to the placement of its Mate (`mate.birthId`) or of its project, and each
 * placement no birth holds: one member each.
 */
function matesOf(
  births: ReadonlyArray<HqBirthValue>,
  placements: ReadonlyArray<{ readonly id: string; readonly value: PlacementValue }>,
  visibilityOf: (projectId: string | null) => MenuMate["visibility"],
): ReadonlyArray<MenuMate> {
  const taken = new Set<string>();
  const born = births.map((birth): MenuMate => {
    const placed = placements.find(
      ({ id, value }) =>
        value.mate?.birthId === birth.id || (birth.projectId != null && id === birth.projectId),
    );
    if (placed !== undefined) taken.add(placed.id);
    const projectId = placed?.id ?? birth.projectId ?? null;
    return {
      kind: "mate",
      key: birth.id,
      projectId,
      bornAt: birth.startedAt,
      birth,
      intent: readBirthIntent(birth.intent),
      placement: placed?.value ?? null,
      visibility: visibilityOf(projectId),
    };
  });
  const recorded = placements.flatMap(({ id, value }): ReadonlyArray<MenuMate> =>
    taken.has(id) || value.mate == null
      ? []
      : [
          {
            kind: "mate",
            key: value.mate.birthId ?? id,
            projectId: id,
            bornAt: value.mate.bornAt,
            birth: null,
            intent: undefined,
            placement: value,
            visibility: visibilityOf(id),
          },
        ],
  );
  return [...born, ...recorded].sort(byClock);
}

/**
 * Whether a member is a Chief no menu list holds, by HQ's Chief fields alone: the viewer's own Chief
 * (`person.chief: "mine"`, or a Chief birth the viewer made), which the menu's header draws, and
 * another person's placed Chief. Another person's Chief birth is a member where HQ places it: HQ
 * sends one only while it is unregistered, for whoever its project reaches to continue it. While the
 * viewer is unread, a Chief birth is held out: it may be their own.
 */
const heldOutChief = (member: MenuMate, viewer: string | undefined): boolean => {
  if (member.placement?.person?.chief === "mine") return true;
  if (member.birth?.chief === true) return viewer === undefined || member.birth.madeBy === viewer;
  return member.placement?.person?.chief !== undefined;
};

/** The signed-in person's Zerops user id, as their own `/user/info` names it. */
function viewerOf(read: ProjectionReads, orgId: string): string | undefined {
  const viewer = read.fact("organizationUser", orgId);
  switch (viewer.kind) {
    case "known":
      return viewer.value.id;
    case "unknown":
    case "withheld":
    case "deleted":
      return undefined;
  }
}

export const menuTree: Projection<string, MenuTree> = {
  name: "menuTree",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const visibilities = new Map<string, MenuMate["visibility"]>();
    // Each member reads through the projection, so its inputs remain dependencies of the tree.
    const visibilityOf = (projectId: string | null): MenuMate["visibility"] => {
      const visibility =
        projectId === null ? "unknown" : mateVisibility.derive(read, { orgId, projectId });
      if (projectId !== null) visibilities.set(projectId, visibility);
      return visibility;
    };
    const withVisibilities = (tree: Omit<MenuTree, "projectVisibilities">): MenuTree => {
      // Environment and platform rows also need the roster's verdict, even before HQ answers.
      for (const projectId of read.members(projectsScope(orgId)).ids)
        if (!visibilities.has(projectId)) visibilityOf(projectId);
      return {
        ...tree,
        projectVisibilities: Object.fromEntries(
          [...visibilities].flatMap(([id, visibility]) =>
            visibility === "unknown" ? [] : [[id, visibility] as const],
          ),
        ),
      };
    };
    const appsScope = hqAppsScope(orgId);
    if (read.coverage(appsScope) !== "complete" && read.members(appsScope).ids.length === 0)
      return withVisibilities(unanswered(read, orgId));
    const placements = listed(read, "placement", placementsScope(orgId));
    const apps = listed(read, "hqApp", appsScope);
    const births = listed(read, "hqBirth", hqBirthsScope(orgId));
    if (placements === undefined || apps === undefined || births === undefined)
      return withVisibilities(unanswered(read, orgId));
    const ungroupedBirths = births.map(({ value }) => value);
    const viewer = viewerOf(read, orgId);
    const listedApps = new Set(apps.map(({ id }) => id));
    const pressIds = read.members(hqPressesScope(orgId)).ids;
    // Every project HQ's navigation names, whatever it says of it.
    const named = new Set<string>([
      ...placements.map(({ id }) => id),
      ...pressIds,
      ...ungroupedBirths.flatMap((birth) => (birth.projectId == null ? [] : [birth.projectId])),
    ]);
    const placedIds = new Set(placements.map(({ id }) => id));
    // The stages and productions being set up, by application; a Mate's press is its birth's.
    const pressesByApp = new Map<string, Array<MenuPress>>();
    for (const projectId of [...pressIds].sort()) {
      const press = read.fact("hqPress", projectId);
      if (press.kind !== "known") continue;
      const { appId, held, kind } = press.value;
      if (!held || kind === "mate" || appId === undefined) continue;
      const inApp = pressesByApp.get(appId) ?? [];
      inApp.push({ projectId, tier: kind });
      pressesByApp.set(appId, inApp);
    }
    const groups = apps.flatMap(({ id, value: app }): ReadonlyArray<MenuGroup> => {
      const inApp = placements.filter(({ value }) => value.appId === id);
      for (const birth of app.births ?? []) if (birth.projectId != null) named.add(birth.projectId);
      for (const hidden of app.hiddenEnvironments ?? []) named.add(hidden.id);
      const environments = (app.environments ?? [])
        .map((environment, index) => ({ environment, index }))
        .sort(
          (left, right) =>
            TIER_RANK[left.environment.tier] - TIER_RANK[right.environment.tier] ||
            left.index - right.index,
        )
        .map(({ environment }): MenuEnvironment => {
          const projectId =
            environment.target.kind === "zerops" ? environment.target.projectId : null;
          if (projectId !== null) named.add(projectId);
          return {
            kind: "environment",
            key: environment.id,
            environment,
            projectId,
            placement: inApp.find((placed) => placed.id === projectId)?.value ?? null,
          };
        });
      const targets = new Set(environments.flatMap(({ projectId }) => projectId ?? []));
      const mates = matesOf(
        app.births ?? [],
        inApp.filter((placed) => !targets.has(placed.id)),
        visibilityOf,
      );
      const held = new Set(mates.flatMap(({ projectId }) => projectId ?? []));
      const others = inApp
        .filter(({ id: projectId }) => !targets.has(projectId) && !held.has(projectId))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id: projectId, value }): MenuPlaced => ({
          kind: "placed",
          key: projectId,
          projectId,
          placement: value,
        }));
      const members: ReadonlyArray<MenuMember> = [
        ...environments,
        ...others,
        ...mates.filter((member) => !heldOutChief(member, viewer)),
      ];
      // A press whose project HQ lists, as an environment or a placement, is set up as far as
      // HQ holds it: its member stands for it, never both.
      const listedNow = (press: MenuPress) =>
        targets.has(press.projectId) || placedIds.has(press.projectId);
      const presses = (pressesByApp.get(id) ?? NO_PRESSES).filter((press) => !listedNow(press));
      const hiddenEnvironments = app.hiddenEnvironments ?? [];
      const empty = app.contents?.empty === true;
      // An application with nothing the person sees is drawn only to be filled or asked into.
      if (members.length === 0 && !empty && hiddenEnvironments.length === 0) return [];
      return [
        {
          id,
          name: app.name,
          createdAt: app.createdAt,
          empty,
          hiddenEnvironments,
          members,
          presses,
        },
      ];
    });
    groups.sort(
      (left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? "") ||
        left.id.localeCompare(right.id),
    );
    const loose = matesOf(
      ungroupedBirths,
      placements.filter(({ value }) => value.appId == null || !listedApps.has(value.appId)),
      visibilityOf,
    );
    const scope = projectsScope(orgId);
    const platform: ProjectValue[] = [];
    for (const projectId of read.members(scope).ids) {
      if (named.has(projectId)) continue;
      const project = read.fact("project", projectId);
      switch (project.kind) {
        case "known":
          if (project.value.tagList?.some((tag) => tag.startsWith(BIRTH_TAG_PREFIX)) !== true)
            platform.push(project.value);
          break;
        // Not read yet, or no longer the person's: nothing of it to offer.
        case "unknown":
        case "withheld":
        case "deleted":
          break;
      }
    }
    platform.sort(
      (left, right) =>
        (right.created ?? "").localeCompare(left.created ?? "") || left.id.localeCompare(right.id),
    );
    const drawn = new Set(groups.map((group) => group.id));
    return withVisibilities({
      state: "known",
      groups,
      ungrouped: loose.filter((member) => !heldOutChief(member, viewer)),
      platform,
      undrawn:
        read.coverage(appsScope) === "complete"
          ? apps.flatMap(({ id }) => (drawn.has(id) ? [] : [id]))
          : [],
      listsNothing: apps.length === 0 && placements.length === 0 && births.length === 0,
    });
  },
  equals: sameValue,
};

const membersOf = (tree: MenuTree): ReadonlyArray<MenuMember> => [
  ...tree.groups.flatMap((group) => group.members),
  ...tree.ungrouped,
];

/** Every project id the tree's members hold HQ's placement of: the rows HQ places. */
export function menuPlacedProjectIds(tree: MenuTree): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const member of membersOf(tree))
    if (member.placement !== null && member.projectId !== null) ids.add(member.projectId);
  return ids;
}

/** Each Mate member's key by its project: the key its row is drawn under, its birth's while it has one. */
export function menuMateKeys(tree: MenuTree): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const member of membersOf(tree))
    if (member.kind === "mate" && member.projectId !== null) keys.set(member.projectId, member.key);
  return keys;
}

/**
 * The application's hidden stages and productions its page asks read access to: all HQ names
 * while the person reaches none of its Zerops stages and productions, else none, since Who has
 * access already asks them in context. Mates, placed projects and outside productions reach none.
 */
export function accessAsksOf(group: MenuGroup): ReadonlyArray<HqHiddenEnvironment> {
  const reachesOne = group.members.some(
    (member) => member.kind === "environment" && member.environment.target.kind !== "outside",
  );
  return reachesOne ? NO_ASKS : group.hiddenEnvironments;
}

const NO_ASKS: ReadonlyArray<HqHiddenEnvironment> = [];

/** Open or listed by roster project, including environments and Platform; unknown is absent. */
export function menuMateVisibilities(tree: MenuTree): ReadonlyMap<string, "open" | "listed"> {
  return new Map(Object.entries(tree.projectVisibilities));
}
/** HQ is making a Mate no row draws yet: a member its birth alone holds. */
export const menuComing = (tree: MenuTree): boolean =>
  membersOf(tree).some((member) => member.kind === "mate" && member.placement === null);
