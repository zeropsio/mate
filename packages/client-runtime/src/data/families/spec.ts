/**
 * What a fact family declares about itself, so the reducer, the store and the adapters loop over
 * families instead of naming them: its owner, the scope its members are listed in and what leaving
 * that scope means, the index it keeps, and — for a Zerops family — how it registers, decodes and
 * tells a deletion from lost access. A family is one module that exports one spec and adds its value
 * to `FamilyValues`; `families/index.ts` lists the specs.
 *
 * @module data/families/spec
 */
import type { HqScope } from "@t3tools/shared/hqStream";

import type {
  Authority,
  Family,
  FamilyValues,
  MemberState,
  Revision,
  ScopeKey,
  Source,
} from "../model.ts";

export type SearchTerms = ReadonlyArray<Readonly<Record<string, unknown>>>;

/** A Zerops row as a family reads it; `null` for a row it cannot read. */
export interface ZeropsRow<Value> {
  readonly id: string;
  readonly value: Value;
  readonly version: number | null;
}

/**
 * Whom a registration observes: the organization, and for a detail family the entity it is
 * demanded for (a project, for one project's services); `null` for a navigation family.
 */
export interface ScopeOwner {
  readonly orgId: string;
  readonly ownerId: string | null;
}

/** How a family is observed on Zerops: a registration pair per scope, and a decoder. */
export interface ZeropsFamilySource<Value> {
  /** The REST entity: registrations and reads by id go to `/{entity}/search`. */
  readonly entity: string;
  /** The `listStream` whose answer is the scope's baseline and whose deltas are its membership. */
  readonly membership: (owner: ScopeOwner) => SearchTerms;
  /** The `updateStream` of whole rows. */
  readonly updates: (owner: ScopeOwner) => SearchTerms;
  readonly decode: (raw: unknown) => ZeropsRow<Value> | null;
  /** The owner's answer to "gone or not yours?" (404 / 403), where leaving the scope asks it. */
  readonly verifyPath?: (id: string) => string;
  /**
   * The organization the owner's answer to that read places the entity in: one that answers from
   * another organization left this one, though it exists and the viewer reads it.
   */
  readonly organizationOf?: (answer: unknown) => string | null;
}

/**
 * How a family is observed on HQ: the scope kind whose records it holds, which record keys are its
 * own, and how a record's value reads. A navigation family's records come with the organization's
 * one `navigation` scope; a detail family's with the scope a demand for one owner names.
 */
export interface HqFamilySource<Value> {
  readonly scope: HqScope["kind"];
  /** The id a record key names in this family; `null` for a key that is another family's. */
  readonly idOf: (key: string, owner: ScopeOwner) => string | null;
  /** The record key an id is held under: what a resume names as a retained key. */
  readonly keyOf: (id: string, owner: ScopeOwner) => string;
  /**
   * A record's value, its key naming which record it is (an application detail's `releases` or
   * `recipe:stage`); `null` for one this build cannot read, which then changes nothing.
   */
  readonly decode: (raw: unknown, key: string) => Value | null;
  /**
   * A detail family's scope for one owner (`DetailDemand.ownerId`). A family without one rides
   * the scope another family demands, from the records of the same kind of scope.
   */
  readonly wireScope?: (ownerId: string) => HqScope;
  /**
   * The value's own revision, for a family HQ only relays (a Mate's attention): its author's
   * ordering, which the reducer compares with the same value arriving on another path. Without
   * it a record carries its scope's HQ revision. `raw` is the record as HQ sent it, for what HQ
   * says of the value beside it.
   */
  readonly revisionOf?: (value: Value, raw: unknown) => Revision;
}

/**
 * A detail family Zerops observes as one query for its owner (one project's current use): a
 * registration whose answer is the scope's baseline. Its frames either list the whole scope again
 * (`listing`, `data.items`) or carry the rows that changed (`rows`, `data.update`). Its rows carry
 * no `_version`: each newer answer replaces the one before.
 */
export interface ZeropsQuerySource<Value> {
  readonly path: string;
  /** The search, without the receiver and the subscription the adapter adds. */
  readonly body: (owner: ScopeOwner) => Readonly<Record<string, unknown>>;
  readonly frames: "listing" | "rows";
  readonly decode: (raw: unknown) => ZeropsRow<Value> | null;
}

/**
 * A further listing of a family's members, observed only while a screen demands it for one owner
 * (one project's newest processes): its own scope under the link, `…:<suffix>:<ownerId>`. Its
 * baseline is one read; its members' later changes reach the family through its own scope's
 * updates, which observe them already.
 */
export interface DetailListing {
  readonly suffix: string;
  /** What leaving the listing says of a member. */
  readonly leaving: MemberState;
  /** Zerops: the `GET` whose answer is the listing's baseline, and the rows in that answer. */
  readonly zerops: {
    readonly path: (owner: ScopeOwner) => string;
    readonly items: (answer: unknown) => ReadonlyArray<unknown> | undefined;
  };
}

/**
 * A source without realtime (§10.5): the owner's whole value, one read while a screen demands it
 * for one owner, read again while it stays demanded on the stream machine's sampled cadence (unless
 * time never ages it), and at once after our own write. Its scope is never claimed live. Its one
 * fact is keyed by the owner it is read for.
 */
export interface SampledSource<Value> {
  readonly path: (owner: { readonly orgId: string; readonly ownerId: string }) => string;
  /** With a search, the read is a `POST` of it to the path, never a `GET`: only the rows asked. */
  readonly search?: (owner: {
    readonly orgId: string;
    readonly ownerId: string;
  }) => Readonly<Record<string, unknown>>;
  /** The value the answer says, stripped to what a screen needs; `null` for one it cannot read. */
  readonly decode: (answer: unknown) => Value | null;
  /**
   * A new demand reads it again once its last read is this old; `0`, on every new demand. `null`:
   * time never ages it — read once, and again only on our write or the person's again; no cadence.
   */
  readonly freshMs: number | null;
}

/** An index the reducer keeps for the family: under which key a fact counts now, if any. */
export interface FamilyIndex<Value> {
  readonly name: string;
  readonly keyOf: (value: Value, listed: MemberState | undefined) => string | null;
}

export interface FamilySpec<F extends Family> {
  readonly family: F;
  readonly authority: Authority;
  /**
   * The one kind of scope this family's members are listed in: what leaving it says of them, and
   * when it is observed — `navigation`, always, once per organization; `detail`, only while
   * demanded, once per owner id. Values may arrive through other scopes (HQ relays a Mate's
   * attention); the listing, its leaving and the index read this one alone.
   */
  readonly scope: {
    readonly source: Source;
    readonly suffix: string;
    readonly leaving: MemberState;
    readonly demand: "navigation" | "detail";
  };
  /**
   * The indexes the reducer keeps for it. A member's `listed` is how this family's own scope lists
   * it, whichever listing last delivered its value.
   */
  readonly indexes?: ReadonlyArray<FamilyIndex<FamilyValues[F]>>;
  readonly zerops?: ZeropsFamilySource<FamilyValues[F]>;
  readonly hq?: HqFamilySource<FamilyValues[F]>;
  /** For a detail family Zerops observes as one query per owner, instead of `zerops`. */
  readonly zeropsQuery?: ZeropsQuerySource<FamilyValues[F]>;
  /** A family read whole per owner, never registered: its scope's demand is `detail`. */
  readonly sampled?: SampledSource<FamilyValues[F]>;
  /**
   * Whether a value is its entity's end, after which it never changes (a process finished): an
   * end that a read or a baseline brings replaces a value that is no end, though the read carries
   * no revision to compare — the end is the evidence. A push never needs it: it carries one.
   */
  readonly ended?: (value: FamilyValues[F]) => boolean;
  /**
   * How a pushed row folds into the value held for it, where a push may name only part of a row
   * (a service's update frames, as recorded, carry its identity and status alone): the fields it
   * names replace the held ones, the rest stay. Without it, a push replaces the value whole.
   */
  readonly merge?: (held: FamilyValues[F], pushed: FamilyValues[F]) => FamilyValues[F];
  /**
   * The owner's own ordering of a read that carries no revision (a by-id read, or a detail
   * listing's baseline): whether the value it read is
   * newer than the one held (a service's `lastUpdate`, on Zerops' clock). Without it, such a read
   * never replaces a revisioned value.
   */
  readonly readIsNewer?: (held: FamilyValues[F], read: FamilyValues[F]) => boolean;
  readonly details?: ReadonlyArray<DetailListing>;
}

export type AnyFamilySpec = { readonly [F in Family]: FamilySpec<F> }[Family];

/**
 * The family's scope under a link (an organization, or a Mate's project), and for a detail family
 * the entity it observes: `zerops:org:projects`, `zerops:org:services:p1`. The first two parts
 * name the link the scope is a child of.
 */
export const scopeOf = (spec: AnyFamilySpec, linkOwner: string, ownerId?: string): ScopeKey =>
  ownerId === undefined
    ? `${spec.scope.source}:${linkOwner}:${spec.scope.suffix}`
    : `${spec.scope.source}:${linkOwner}:${spec.scope.suffix}:${ownerId}`;
