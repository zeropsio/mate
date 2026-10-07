/**
 * Where the organization's HQ places each project (ADR 0002): its application, its kind — a Mate,
 * a stage, the production — and a Mate's face. HQ is the structure's only writer; the client reads
 * it from HQ's stream and joins it onto the projects it reads from Zerops (`ZeropsProject.hq`),
 * where they enter the screen. A Mate HQ holds in no application is placed by its record alone; a
 * project HQ does not place at all is in no application, and no Mate's face is known for it. A
 * Mate's name is its project's in Zerops (D3), never HQ's.
 *
 * Pure: no network (rule R1).
 *
 * @module hq/placement
 */
import { type HqOfferState, hqOffer } from "@t3tools/shared/hqOffers";
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import { type RoleProjectKind, isMateKind } from "@t3tools/shared/zeropsRoles";

import type { CandidateRow } from "../projections/candidates.ts";
import type { ZeropsProject } from "../api.ts";

import type { Known } from "../knowledge/known.ts";
import type { HqMate, HqStructure } from "./client.ts";
import type { HqPressHold } from "./pressElsewhere.ts";

export type HqPlacement =
  | {
      readonly appId: string;
      readonly appName: string;
      readonly kind: RoleProjectKind | "unknown";
      /** A Mate's face as HQ records it (`readMateFace`). */
      readonly mate: HqMate | null | undefined;
      /**
       * Placed by an accepted birth or an environment press, before its registration.
       * The exact project is retained at HQ; Finish setup registers it in this application.
       */
      readonly unregistered?: true;
    }
  /** A Mate HQ holds in no application (`HqStructure.ungrouped`). */
  | { readonly appId: null; readonly appName: null; readonly kind: "mate"; readonly mate: HqMate };

/** HQ facts joined by project id: placement and account tool classification. */
export type HqPlacements = ReadonlyMap<string, HqPlacement> & {
  readonly tools?: ReadonlyMap<string, "gitea">;
};

/** Every kind this build reads: a kind HQ adds later places nothing here until it does. */
const PROJECT_KINDS: Readonly<Record<RoleProjectKind, true>> = {
  mate: true,
  devstage: true,
  stage: true,
  production: true,
};

/** Whether HQ's `kind` is one this build reads. */
export const isRoleProjectKind = (kind: string): kind is RoleProjectKind =>
  Object.hasOwn(PROJECT_KINDS, kind);

/**
 * Each project HQ places, by its id; a kind this build does not know places nothing. Each Mate's
 * record carries its logins as HQ's overview of it says them (`logins`, by project), where HQ
 * holds one for the reader. A project HQ places nowhere whose press record (`presses`) is a
 * stage's or a production's, into an application HQ holds, is placed there by that record —
 * `unregistered` — never read as a project nobody made: what HQ said of it is its press.
 */
export function placementsOf(
  structure: HqStructure,
  logins: ReadonlyMap<string, OverviewLogins> = new Map(),
  readyAgents: ReadonlyMap<string, boolean> = new Map(),
  presses: Readonly<Record<string, Pick<HqPressHold, "kind" | "appId">>> | null = null,
): HqPlacements {
  const withLogins = (projectId: string, mate: HqMate): HqMate => {
    const told =
      logins.get(projectId) ??
      (mate.signers === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(mate.signers).map(([key, by]) => [
              key,
              { signedInBy: null, lastSignedInBy: by, present: false, token: false },
            ]),
          ));
    const ready = readyAgents.get(projectId);
    return told === undefined && ready === undefined
      ? mate
      : {
          ...mate,
          ...(told === undefined ? {} : { logins: told }),
          ...(ready === undefined ? {} : { runsWithoutSignIn: ready }),
        };
  };
  const placements = new Map<string, HqPlacement>();
  for (const app of structure.apps) {
    for (const project of app.projects) {
      const { kind } = project;
      if (!isRoleProjectKind(kind) && kind !== "unknown") continue;
      placements.set(project.projectId, {
        appId: app.id,
        appName: app.name,
        kind,
        mate: project.mate == null ? project.mate : withLogins(project.projectId, project.mate),
      });
    }
  }
  for (const { projectId, mate } of structure.ungrouped) {
    placements.set(projectId, {
      appId: null,
      appName: null,
      kind: "mate",
      mate: withLogins(projectId, mate),
    });
  }
  // The accepting HQ retains the exact project before setup registers its Mate.
  for (const app of structure.apps) {
    for (const birth of app.births ?? []) {
      if (birth.projectId == null || placements.has(birth.projectId)) continue;
      placements.set(birth.projectId, {
        appId: app.id,
        appName: app.name,
        kind: "mate",
        mate: null,
        unregistered: true,
      });
    }
  }
  for (const [projectId, press] of Object.entries(presses ?? {})) {
    if (placements.has(projectId) || press.kind === "mate" || press.appId === undefined) continue;
    const app = structure.apps.find((entry) => entry.id === press.appId);
    if (app === undefined) continue;
    placements.set(projectId, {
      appId: app.id,
      appName: app.name,
      kind: press.kind,
      mate: null,
      unregistered: true,
    });
  }
  return Object.assign(placements, {
    tools: new Map((structure.tools ?? []).map((tool) => [tool.projectId, tool.kind] as const)),
  });
}

/**
 * What HQ holds a project as, from where it places it: `none` where it places it nowhere — placed
 * by a press's record alone included (`unregistered`).
 */
export function heldOf(project: {
  readonly hq?: HqPlacement | undefined;
}): RoleProjectKind | "none" | "unknown" {
  const placed = project.hq;
  if (placed === undefined || ("unregistered" in placed && placed.unregistered === true))
    return "none";
  return placed.appId === null ? "mate" : placed.kind;
}

/**
 * The project with where HQ places it now: a project it does not place carries no placement — one
 * it placed before and no longer does loses its. The same object where nothing changes.
 */
export function placeProject<
  P extends { readonly id: string; readonly hq?: HqPlacement; readonly hqTool?: "gitea" },
>(project: P, placements: HqPlacements): P {
  const placement = placements.get(project.id);
  const tool = placements.tools?.get(project.id);
  if (project.hq === placement && project.hqTool === tool) return project;
  const { hq: _placement, hqTool: _tool, ...rest } = project;
  return {
    ...rest,
    ...(placement === undefined ? {} : { hq: placement }),
    ...(tool === undefined ? {} : { hqTool: tool }),
  } as P;
}

/** The projects, each with where HQ places it now (`placeProject`). */
export function placeProjects<
  P extends { readonly id: string; readonly hq?: HqPlacement; readonly hqTool?: "gitea" },
>(projects: ReadonlyArray<P>, placements: HqPlacements): ReadonlyArray<P> {
  return projects.map((project) => placeProject(project, placements));
}

/**
 * A listing's rows, each with its project where HQ places it now (`placeProject`): the same listing
 * where it holds no rows, and the same row where its project's place did not change.
 */
export function placeListing<
  R extends {
    readonly project: { readonly id: string; readonly hq?: HqPlacement; readonly hqTool?: "gitea" };
  },
>(listing: Known<ReadonlyArray<R>>, placements: HqPlacements): Known<ReadonlyArray<R>> {
  if (listing.state !== "known") return listing;
  return {
    ...listing,
    value: listing.value.map((row) => {
      const project = placeProject(row.project, placements);
      return project === row.project ? row : { ...row, project };
    }),
  };
}

/**
 * Where a Mate born under intent `birthId` goes, and with which face (`HqBirth`): its application
 * and its face, while HQ holds the intent open — none once its attach closed it, or where HQ's
 * structure is not known.
 */
export function birthIntentOf(
  structure: HqStructure | null,
  birthId: string,
): { readonly appId: string; readonly face: string } | undefined {
  for (const app of structure?.apps ?? []) {
    const birth = app.births?.find((entry) => entry.id === birthId);
    if (birth !== undefined) return { appId: app.id, face: birth.face };
  }
  return undefined;
}

/**
 * The menu's rows HQ places, each enriched with the platform's facts by project id: a project HQ
 * places that no inventory row or store fact names yet is drawn by HQ's name for it, its presence
 * unknown.
 */
export function placedMenuRows(input: {
  readonly organizationId: string;
  /** Where HQ places each project (`placementsOf`). */
  readonly placements: HqPlacements;
  /** HQ's name for each project it places. */
  readonly names: ReadonlyMap<string, string>;
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly candidates: ReadonlyArray<CandidateRow>;
  readonly gone: ReadonlySet<string>;
}): ReadonlyArray<CandidateRow> {
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const candidates = new Map<string, CandidateRow>();
  for (const row of input.candidates) {
    if (!candidates.has(row.project.id) || row.group === "connected")
      candidates.set(row.project.id, row);
  }
  return [...input.placements].flatMap(([id, placement]): ReadonlyArray<CandidateRow> => {
    // A press's record alone places no row: HQ holds the project nowhere yet.
    if (input.gone.has(id) || ("unregistered" in placement && placement.unregistered === true))
      return [];
    const row = candidates.get(id);
    const project = projects.get(id) ??
      row?.project ?? {
        id,
        name: input.names.get(id) ?? id,
        status: "UNKNOWN",
        clientId: input.organizationId,
      };
    return [
      {
        ...(row ?? { key: id, group: "unavailable", presence: "unknown" }),
        project: { ...project, hq: placement },
      },
    ];
  });
}

/** HQ's name for each project its structure places. */
export function placedNames(structure: HqStructure): ReadonlyMap<string, string> {
  return new Map([
    ...structure.apps.flatMap((app) =>
      app.projects.map((project) => [project.projectId, project.name] as const),
    ),
    ...structure.ungrouped.map((project) => [project.projectId, project.name] as const),
  ]);
}

/**
 * What HQ offers the reader of a project (`can`, `@t3tools/shared/hqOffers`): of a Mate it holds,
 * following it, its record and leaving its application — none while HQ does not answer; of a
 * project it holds nowhere, writing its Mate's record. HQ decides each, and decides the
 * write again at the press.
 */
export type HqMateOfferStates =
  | {
      readonly held: true;
      readonly observe: HqOfferState;
      readonly edit: HqOfferState;
      readonly detach: HqOfferState;
    }
  | { readonly held: false; readonly createRecord: HqOfferState };

export function hqMateOffers(
  structure: HqStructure,
  projectId: string,
  hq: { readonly current: boolean; readonly unavailableSince: number | null },
): HqMateOfferStates {
  const mate =
    structure.ungrouped.find((entry) => entry.projectId === projectId) ??
    structure.apps
      .flatMap((app) => app.projects)
      .find((entry) => entry.projectId === projectId && isMateKind(entry.kind));
  if (mate === undefined) {
    return {
      held: false,
      createRecord: hqOffer(structure.unheld?.[projectId], "create_mate_record", hq),
    };
  }
  return {
    held: true,
    observe: hqOffer(mate.can, "observe_mate", hq),
    edit: hqOffer(mate.can, "edit_mate_record", hq),
    detach: hqOffer(mate.can, "detach", hq),
  };
}
