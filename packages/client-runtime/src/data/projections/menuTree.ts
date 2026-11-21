/**
 * The menu's one tree: HQ's records of the organization, each member naming its project id, by
 * which the menu's rows join the person's own Zerops roster. HQ decides what the person sees: its
 * applications are the groups, its environments, Mates and open births their members, its Mates and
 * births in no application the ungrouped ones; a Chief is placed by HQ's own Chief fields. A birth
 * and the Mate born of it are one member, keyed by the birth from its first frame to long after its
 * hello, so a new Mate's row is never drawn twice and never changes key. The roster never removes a
 * member: one whose project it does not list yet keeps its place. A roster project HQ names
 * nowhere, without HQ's birth tag, is a Platform project. Every order is HQ's own times; no clock
 * of this tab, no press. Until every record HQ lists is read, the tree is not answered.
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
import type { FamilyValues } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

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
}

export interface MenuTree {
  /**
   * HQ's navigation said the organization's applications. Until then, and where HQ refuses or the
   * organization has none, the tree holds nothing and names no Platform project.
   */
  readonly answered: boolean;
  /** HQ's applications, newest first, each with its members. */
  readonly groups: ReadonlyArray<MenuGroup>;
  /** HQ's Mates and births in no application, by their clock. */
  readonly ungrouped: ReadonlyArray<MenuMate>;
  /** The Chiefs HQ names (a placement's `person.chief`, a birth's `chief`): placed in no group. */
  readonly chiefs: ReadonlyArray<MenuMate>;
  /** Roster projects HQ names nowhere and that carry no birth tag, newest first. */
  readonly platform: ReadonlyArray<ProjectValue>;
}

/** The tree before HQ answered, or with no organization in view: nothing drawn from it. */
export const MENU_UNANSWERED: MenuTree = {
  answered: false,
  groups: [],
  ungrouped: [],
  chiefs: [],
  platform: [],
};

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

/**
 * Each birth joined to the placement of its Mate (`mate.birthId`) or of its project, and each
 * placement no birth holds: one member each.
 */
function matesOf(
  read: ProjectionReads,
  births: ReadonlyArray<HqBirthValue>,
  placements: ReadonlyArray<{ readonly id: string; readonly value: PlacementValue }>,
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
          },
        ],
  );
  return [...born, ...recorded].sort(byClock);
}

const isChief = (member: MenuMate) =>
  member.birth?.chief === true || member.placement?.person?.chief !== undefined;

export const menuTree: Projection<string, MenuTree> = {
  name: "menuTree",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const appsScope = hqAppsScope(orgId);
    if (read.coverage(appsScope) !== "complete" && read.members(appsScope).ids.length === 0)
      return MENU_UNANSWERED;
    const placements = listed(read, "placement", placementsScope(orgId));
    const apps = listed(read, "hqApp", appsScope);
    const births = listed(read, "hqBirth", hqBirthsScope(orgId));
    if (placements === undefined || apps === undefined || births === undefined)
      return MENU_UNANSWERED;
    const ungroupedBirths = births.map(({ value }) => value);
    // Every project HQ's navigation names, whatever it says of it.
    const named = new Set<string>([
      ...placements.map(({ id }) => id),
      ...read.members(hqPressesScope(orgId)).ids,
      ...ungroupedBirths.flatMap((birth) => (birth.projectId == null ? [] : [birth.projectId])),
    ]);
    const chiefs: MenuMate[] = [];
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
        read,
        app.births ?? [],
        inApp.filter((placed) => !targets.has(placed.id)),
      );
      chiefs.push(...mates.filter(isChief));
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
        ...mates.filter((member) => !isChief(member)),
      ];
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
        },
      ];
    });
    groups.sort(
      (left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? "") ||
        left.id.localeCompare(right.id),
    );
    const loose = matesOf(
      read,
      ungroupedBirths,
      placements.filter(({ value }) => value.appId === null),
    );
    chiefs.push(...loose.filter(isChief));
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
    return {
      answered: true,
      groups,
      ungrouped: loose.filter((member) => !isChief(member)),
      chiefs: chiefs.sort(byClock),
      platform,
    };
  },
  equals: sameValue,
};

/** Every project id the tree's members hold HQ's placement of: the rows HQ places. */
export function menuPlacedProjectIds(tree: MenuTree): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const member of [
    ...tree.groups.flatMap((group) => group.members),
    ...tree.ungrouped,
    ...tree.chiefs,
  ])
    if (member.placement !== null && member.projectId !== null) ids.add(member.projectId);
  return ids;
}
