/**
 * The platform's integration tokens and their project grants, as this client reads them. A Mate's
 * key reaches its own project alone; HQ mints and keeps it (ADR 0003).
 *
 * @module groupReach
 */
/** The platform's project roles, as its own validation error enumerates them. */
export type ZeropsProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS";

export interface ZeropsProjectGrant {
  readonly projectId: string;
  readonly roleCode: ZeropsProjectRole;
}

export interface ZeropsIntegrationToken {
  readonly id: string;
  readonly name: string;
  /** The token's org role, round-tripped by any write to it. */
  readonly roleCode?: string | undefined;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant> | undefined;
  /** When the platform minted it. The start-up throwaway sweep dates rows by it. */
  readonly created?: string | undefined;
  /** Who minted it: besides an org owner, the one person who may write it. */
  readonly createdByUser?: string | undefined;
  /** A key that acts beyond its grants; every one minted before 2026-10-13 is (HQ: `key_too_wide`). */
  readonly sudo?: boolean | undefined;
}
