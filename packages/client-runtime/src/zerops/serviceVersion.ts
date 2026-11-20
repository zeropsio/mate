// What a service runs and where an app version came from, as values: the data layer's `serviceRuns`
// and `versionSource` projections derive them.

/**
 * What a service runs: its active version's id and source (`NONE` on a runtime nothing was
 * ever deployed to), each `null` when it has no active version — the source also where its row
 * leaves it unstated — and that version's name, `null` where nothing names it.
 */
export interface ZeropsServiceDeployedVersion {
  readonly activeId: string | null;
  readonly source: string | null;
  readonly name: string | null;
}

export type VersionSource =
  | { readonly kind: "known"; readonly source: string | null }
  /** Not held, and the active versions have not answered yet: their list may bring it. */
  | { readonly kind: "unknown" }
  /** Not held, though the active versions answered: it is to be read by id. */
  | { readonly kind: "awaited" }
  /** The read by id found none: the platform does not have it. */
  | { readonly kind: "not-listed" }
  /** The read by id answered a row its family cannot read: refused alone, said so. */
  | { readonly kind: "unreadable" }
  /** The organization's active versions were refused: nothing will state it. */
  | { readonly kind: "refused" };
