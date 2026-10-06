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
  HqNavigationApp,
  HqNavigationProject,
  HqNavigationStatus,
  type HqOfficialVerdict,
  type HqPersonFacts,
} from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readHqParts, type HqBirth, type HqParts } from "../../zerops/hq/client.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** The organization's own record: its offers, its tools, and the Core its HQ runs. */
export interface HqOrganizationValue {
  readonly can: HqOffers;
  /** Each project HQ holds nowhere the reader reads, by id, with what it offers of it. */
  readonly unheld: Readonly<Record<string, HqOffers>>;
  readonly tools: ReadonlyArray<{ readonly projectId: string; readonly kind: "gitea" }>;
  /** The Core HQ runs. */
  readonly build: string;
}

/** How the organization's HQ stands (`HqNavigationStatus`): its check of Zerops, its parts. */
export interface HqStatusValue {
  /** HQ's last check of Zerops that it is the official HQ; `null` before its first. */
  readonly official: HqOfficialVerdict | null;
  readonly parts: HqParts;
}

export type HqAppValue = Omit<HqNavigationApp, "births"> & {
  /** The Mates on their way into it whose attach has not landed. */
  readonly births: ReadonlyArray<HqBirth>;
};

export type PlacementValue = HqNavigationProject;
export type { HqPersonFacts };

export interface HqPersonValue {
  readonly name: string;
  readonly clientUserId: string;
}

/** A press HQ holds, by its project: what it makes, where, and its import once Zerops took it. */
export interface HqPressValue {
  readonly kind: "mate" | "stage" | "production";
  readonly appId?: string;
  readonly importProcessId?: string;
}

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
  tools: Schema.Array(Schema.Struct({ projectId: Schema.String, kind: Schema.Literal("gitea") })),
  build: Schema.String,
});
const Birth = Schema.Struct({
  id: Schema.String,
  face: Schema.String,
  projectId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const Person = Schema.Struct({ name: Schema.String, clientUserId: Schema.String });
const Press = Schema.Struct({
  kind: Schema.Literals(["mate", "stage", "production"]),
  appId: Schema.optionalKey(Schema.String),
  importProcessId: Schema.optionalKey(Schema.String),
});

const decodeOrganization = Schema.decodeUnknownOption(Organization);
const decodeStatus = Schema.decodeUnknownOption(HqNavigationStatus);
const decodeApp = Schema.decodeUnknownOption(HqNavigationApp);
const decodeBirth = Schema.decodeUnknownOption(Birth);
const decodeProject = Schema.decodeUnknownOption(HqNavigationProject);
const decodePerson = Schema.decodeUnknownOption(Person);
const decodePress = Schema.decodeUnknownOption(Press);

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
        Option.map(decodeStatus(raw), ({ official, parts }) => ({
          official,
          parts: readHqParts(parts),
        })),
      ),
  },
};

export const hqAppFamily: FamilySpec<"hqApp"> = {
  family: "hqApp",
  authority: "hq",
  scope: navigation("hq-apps"),
  hq: {
    scope: "navigation",
    ...prefixed("app"),
    decode: (raw) =>
      Option.getOrNull(
        Option.map(decodeApp(raw), (app) => ({
          ...app,
          // A birth this build cannot read is none of the application's.
          births: app.births.flatMap((birth) => Option.toArray(decodeBirth(birth))),
        })),
      ),
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
