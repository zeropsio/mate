/**
 * What HQ's one `navigation` scope holds of the organization, as fact families: the organization's
 * own record (`hqOrganization`), how its HQ stands (`hqStatus`, apart: it ticks), its applications (`hqApp`), where HQ places each project and what
 * it computed of the reader for it (`placement`), the people its records name (`hqPerson`), and the
 * presses it holds (`hqPress`). One delivery of the scope commits its records of every family
 * together. A record leaves only by HQ's explicit removal, with its reason; nothing is inferred
 * from a record missing.
 *
 * @module data/families/hqNavigation
 */
import { HqOffers } from "@t3tools/shared/hqOffers";
import {
  CanonicalHqNavigationApp,
  CanonicalHqNavigationEnvironment,
  HqGitNavigationEnvironment,
  HqNavigationProject,
  HqNavigationPerson,
  HqNavigationPress,
  HqNavigationStatus,
  HqPersonFacts as HqPersonFactsSchema,
  HqNavigationMate,
} from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readHqParts, type HqParts } from "../../zerops/hq/client.ts";
import type { ScopeKey } from "../model.ts";
import { navigationRecord } from "./navigationRecord.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** The organization's own record: its offers and the Core its HQ runs. */
export interface HqOrganizationValue {
  readonly can: HqOffers;
  /** Each project HQ holds nowhere the reader reads, by id, with what it offers of it. */
  readonly unheld: Readonly<Record<string, HqOffers>>;
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

const Birth = Schema.Struct({
  id: Schema.String,
  face: Schema.String,
  projectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
// The old outward reader remains Zerops-only; the account admits each target's own job contract.
const DeliveryEnvironments = Schema.Union([
  Schema.Array(
    Schema.Union([
      HqGitNavigationEnvironment,
      CanonicalHqNavigationEnvironment.check(
        Schema.makeFilter((row) =>
          row.target.kind === "zerops" ? undefined : "Expected Zerops deploy jobs",
        ),
      ),
    ]),
  ),
  Schema.Struct({ refused: Schema.String }),
]);
const App = navigationRecord({
  ...CanonicalHqNavigationApp.fields,
  environments: DeliveryEnvironments,
  births: Schema.Array(Birth),
});
const PersonFacts = navigationRecord(HqPersonFactsSchema.fields);
const Mate = navigationRecord(HqNavigationMate.fields);
const Project = navigationRecord({
  ...HqNavigationProject.fields,
  mate: Schema.NullOr(Mate),
  person: PersonFacts,
});
const Person = navigationRecord(HqNavigationPerson.fields);

export type HqAppValue = typeof App.Type;
export type PlacementValue = typeof Project.Type;
export type HqPersonFacts = typeof PersonFacts.Type;
export type HqPersonValue = typeof Person.Type;

/**
 * A press HQ holds, by its project: what it makes, where, its import once Zerops took it, and how
 * long its hold runs on from HQ's read (`heldForMs`) — renewed holds come with a new `until`.
 */
export type HqPressValue = HqNavigationPress;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqOrganization: HqOrganizationValue;
    readonly hqStatus: HqStatusValue;
    readonly hqApp: HqAppValue;
    readonly placement: PlacementValue;
    readonly hqPerson: HqPersonValue;
    readonly hqPress: HqPressValue;
  }
}

const Organization = Schema.Struct({
  can: HqOffers,
  unheld: Schema.Record(Schema.String, HqOffers),
  build: Schema.String,
});

const Viewer = Schema.Struct({
  firstSignedInAt: Schema.NullOr(Schema.String),
  founder: Schema.Boolean,
});

const decodeOrganizationRecord = Schema.decodeUnknownOption(Organization);
const decodeViewer = Schema.decodeUnknownOption(Viewer);

/** The record, its reader's first sign-in apart: one unreadable never loses the other. */
const decodeOrganization = (raw: unknown): Option.Option<HqOrganizationValue> =>
  Option.map(decodeOrganizationRecord(raw), (organization) => {
    const viewer =
      typeof raw === "object" && raw !== null && "viewer" in raw
        ? Option.getOrUndefined(decodeViewer(raw.viewer))
        : undefined;
    return viewer === undefined ? organization : { ...organization, viewer };
  });
const decodeStatus = Schema.decodeUnknownOption(HqNavigationStatus);
const decodeApp = Schema.decodeUnknownOption(App);
const decodeProject = Schema.decodeUnknownOption(Project);
const decodePerson = Schema.decodeUnknownOption(Person);
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
      ? { ...row, environments: held.environments }
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
  // A partial navigation record cannot erase setup evidence HQ previously proved.
  keepUnsaid: (held, row) => {
    if (held?.mate == null || row.mate == null) return row;
    return {
      ...row,
      mate: {
        ...row.mate,
        closedOff: row.mate.closedOff ?? held.mate.closedOff,
        setupMarker: row.mate.setupMarker ?? held.mate.setupMarker,
      },
    };
  },
  hq: {
    scope: "navigation",
    ...prefixed("project"),
    decode: (raw) => Option.getOrNull(decodeProject(raw)),
  },
};

export const hqPersonFamily: FamilySpec<"hqPerson"> = {
  family: "hqPerson",
  authority: "hq",
  scope: navigation("hq-people"),
  hq: {
    scope: "navigation",
    ...prefixed("person"),
    decode: (raw) => Option.getOrNull(decodePerson(raw)),
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
export const hqPeopleScope = (orgId: string): ScopeKey => scopeOf(hqPersonFamily, orgId);
export const hqPressesScope = (orgId: string): ScopeKey => scopeOf(hqPressFamily, orgId);
