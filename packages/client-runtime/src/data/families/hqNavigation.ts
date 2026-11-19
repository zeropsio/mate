/**
 * What HQ's one `navigation` scope holds of the organization, as fact families: the organization's
 * own record (`hqOrganization`), how its HQ stands (`hqStatus`, apart: it ticks), its applications (`hqApp`), where HQ places each project and what
 * it computed of the reader for it (`placement`), and the presses it holds (`hqPress`). HQ names
 * people by Zerops user id alone; an older HQ's `person:<id>` records are read by no family. One delivery of the scope commits its records of every family
 * together. A record leaves only by HQ's explicit removal, with its reason; nothing is inferred
 * from a record missing.
 *
 * @module data/families/hqNavigation
 */
import {
  HqNavigationApp,
  HqNavigationProject,
  HqNavigationPress,
  HqNavigationStatus,
  HqPersonFacts as HqPersonFactsSchema,
  HqNavigationMate,
} from "@t3tools/shared/hqStream";
import type { HqOutsideEnvironment } from "@t3tools/shared/hqEnvironment";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { HqBirthRun, readHqParts, type HqParts } from "../../zerops/hq/client.ts";
import {
  readDeliveryEnvironments,
  type HqDeliveryEnvironment,
  type UnreadEnvironment,
} from "../../zerops/hq/environments.ts";
import type { ScopeKey } from "../model.ts";
import { navigationRecord } from "./navigationRecord.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** The organization's own record: the Core its HQ runs. */
export interface HqOrganizationValue {
  /** The Core HQ runs. */
  readonly build: string;
  /**
   * The reader at this HQ: when they first signed in to it, and whether they were its first
   * person — the one who set it up. Absent from an older HQ, or sent unreadably.
   */
  readonly viewer?: HqOrganizationViewer;
}

export interface HqOrganizationViewer {
  /** ISO 8601; `null` where HQ holds no sign-in of theirs. */
  readonly firstSignedInAt: string | null;
  readonly founder: boolean;
}

/** How the organization's HQ stands (`HqNavigationStatus`): its parts. */
export interface HqStatusValue {
  readonly parts: HqParts;
}

const BirthAttempt = Schema.Struct({
  by: Schema.String,
  at: Schema.String,
  refused: Schema.optionalKey(Schema.Struct({ at: Schema.String, reason: Schema.String })),
  unsent: Schema.optionalKey(Schema.Struct({ at: Schema.String, reason: Schema.String })),
});

const Birth = Schema.Struct({
  run: Schema.optionalKey(HqBirthRun),
  id: Schema.String,
  face: Schema.String,
  madeBy: Schema.optionalKey(Schema.String),
  chief: Schema.optionalKey(Schema.Boolean),
  chiefRegistered: Schema.optionalKey(Schema.Boolean),
  adopted: Schema.optionalKey(Schema.Boolean),
  intent: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  attempts: Schema.optionalKey(
    Schema.Struct({
      create: Schema.optionalKey(BirthAttempt),
      import: Schema.optionalKey(BirthAttempt),
    }),
  ),
  projectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  importProcessId: Schema.optionalKey(Schema.String),
});
// The environments arrive raw: the family reads each on its own (`readDeliveryEnvironments`), so
// one this build cannot read is said beside the readable ones, never taking them down.
const App = navigationRecord({
  ...HqNavigationApp.fields,
  environments: Schema.Array(Schema.Unknown),
  births: Schema.Array(Birth),
});
const PersonFacts = navigationRecord(HqPersonFactsSchema.fields);
const Mate = navigationRecord(HqNavigationMate.fields);
const Project = navigationRecord({
  ...HqNavigationProject.fields,
  mate: Schema.NullOr(Mate),
  person: PersonFacts,
});

export type HqAppValue = Omit<typeof App.Type, "environments"> & {
  /** The readable environments in HQ's order, the outside production among them; absent while unsaid. */
  readonly environments?: ReadonlyArray<HqDeliveryEnvironment | HqOutsideEnvironment>;
  /** The environments HQ sent that this build cannot read; absent when none. */
  readonly unreadEnvironments?: ReadonlyArray<UnreadEnvironment>;
};
export type PlacementValue = typeof Project.Type;
export type HqPersonFacts = typeof PersonFacts.Type;

/**
 * A press HQ holds, by its project: what it makes, where, its import once Zerops took it, and
 * whether its hold runs on (a stopped press keeps its record with `held: false`). HQ removes or
 * rewrites it when the hold ends: no reader times it out.
 */
export type HqPressValue = HqNavigationPress;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqOrganization: HqOrganizationValue;
    readonly hqStatus: HqStatusValue;
    readonly hqApp: HqAppValue;
    readonly placement: PlacementValue;
    readonly hqPress: HqPressValue;
  }
}

const Organization = Schema.Struct({ build: Schema.String });

const Viewer = Schema.Struct({
  firstSignedInAt: Schema.NullOr(Schema.String),
  founder: Schema.Boolean,
});

const decodeOrganizationRecord = Schema.decodeUnknownOption(Organization);
const decodeViewer = Schema.decodeUnknownOption(Viewer);

/** The record, its reader's first sign-in apart: one unreadable never loses the other. */
const decodeOrganization = (raw: unknown): Option.Option<HqOrganizationValue> =>
  Option.map(decodeOrganizationRecord(raw), ({ build }) => {
    const organization = { build };
    const viewer =
      typeof raw === "object" && raw !== null && "viewer" in raw
        ? Option.getOrUndefined(decodeViewer(raw.viewer))
        : undefined;
    return viewer === undefined ? organization : { ...organization, viewer };
  });
const decodeStatus = Schema.decodeUnknownOption(HqNavigationStatus);
const decodeAppRecord = Schema.decodeUnknownOption(App);
const idOfSent = (row: unknown): unknown =>
  typeof row === "object" && row !== null ? Reflect.get(row, "id") : undefined;
const decodeApp = (raw: unknown): Option.Option<HqAppValue> =>
  Option.map(decodeAppRecord(raw), ({ environments, ...app }): HqAppValue => {
    if (environments === undefined) return app;
    const sent = readDeliveryEnvironments(environments);
    const order = environments.map(idOfSent);
    const readable = [...sent.environments, ...(sent.outside === undefined ? [] : [sent.outside])];
    // The outside production is read apart: put back in HQ's order.
    readable.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return {
      ...app,
      environments: readable,
      ...(sent.unread.length === 0 ? {} : { unreadEnvironments: sent.unread }),
    };
  });
const decodeProject = Schema.decodeUnknownOption(Project);
const decodePress = Schema.decodeUnknownOption(HqNavigationPress);

/** The id a `<prefix>:<id>` key names; `null` for another prefix. */
const prefixed = (prefix: string) => ({
  idOf: (key: string) => (key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : null),
  keyOf: (id: string) => `${prefix}:${id}`,
});

const navigation = (suffix: string) =>
  ({ source: "hq", suffix, leaving: "removed", demand: "navigation" }) as const;

export const hqOrganizationFamily: FamilySpec<"hqOrganization"> = {
  family: "hqOrganization",
  authority: "hq",
  scope: navigation("hq-organization"),
  hq: {
    scope: "navigation",
    // The organization's one record, held under its own id.
    idOf: (key, { orgId }) => (key === "org" ? orgId : null),
    keyOf: () => "org",
    decode: (raw) => Option.getOrNull(decodeOrganization(raw)),
  },
};

export const hqStatusFamily: FamilySpec<"hqStatus"> = {
  family: "hqStatus",
  authority: "hq",
  scope: navigation("hq-status"),
  hq: {
    scope: "navigation",
    // The organization's HQ stands one way at a time, held under the organization's id.
    idOf: (key, { orgId }) => (key === "status" ? orgId : null),
    keyOf: () => "status",
    decode: (raw) =>
      Option.getOrNull(
        Option.map(decodeStatus(raw), ({ parts }) => ({
          parts: readHqParts(parts),
        })),
      ),
  },
};

export const hqAppFamily: FamilySpec<"hqApp"> = {
  family: "hqApp",
  authority: "hq",
  scope: navigation("hq-apps"),
  // Incomplete newer data never erases the environments HQ already proved.
  keepUnsaid: (held, row) =>
    row.environments === undefined && held?.environments !== undefined
      ? {
          ...row,
          environments: held.environments,
          ...(held.unreadEnvironments === undefined
            ? {}
            : { unreadEnvironments: held.unreadEnvironments }),
        }
      : row,
  hq: {
    scope: "navigation",
    ...prefixed("app"),
    decode: (raw) => Option.getOrNull(decodeApp(raw)),
  },
};

export const placementFamily: FamilySpec<"placement"> = {
  family: "placement",
  authority: "hq",
  scope: navigation("hq-placements"),
  hq: {
    scope: "navigation",
    ...prefixed("project"),
    decode: (raw) => Option.getOrNull(decodeProject(raw)),
  },
};

export const hqPressFamily: FamilySpec<"hqPress"> = {
  family: "hqPress",
  authority: "hq",
  scope: navigation("hq-presses"),
  hq: {
    scope: "navigation",
    ...prefixed("press"),
    decode: (raw) => Option.getOrNull(decodePress(raw)),
  },
};

export const hqOrganizationScope = (orgId: string): ScopeKey =>
  scopeOf(hqOrganizationFamily, orgId);
export const hqStatusScope = (orgId: string): ScopeKey => scopeOf(hqStatusFamily, orgId);
export const hqAppsScope = (orgId: string): ScopeKey => scopeOf(hqAppFamily, orgId);
export const placementsScope = (orgId: string): ScopeKey => scopeOf(placementFamily, orgId);
export const hqPressesScope = (orgId: string): ScopeKey => scopeOf(hqPressFamily, orgId);
