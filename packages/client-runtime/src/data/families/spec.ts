/**
 * What a fact family declares about itself, so the reducer, the store and the adapters loop over
 * families instead of naming them: its owner, the scope its members are listed in and what leaving
 * that scope means, the index it keeps, and — for a Zerops family — how it registers, decodes and
 * tells a deletion from lost access. A family is one module that exports one spec and adds its value
 * to `FamilyValues`; `families/index.ts` lists the specs.
 *
 * @module data/families/spec
 */
import type { Authority, Family, FamilyValues, MemberState, ScopeKey, Source } from "../model.ts";

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
  readonly index?: FamilyIndex<FamilyValues[F]>;
  readonly zerops?: ZeropsFamilySource<FamilyValues[F]>;
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
