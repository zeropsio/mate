/**
 * Whether a registered Zerops environment that cannot connect should be
 * forgotten.
 *
 * Two different things make a registration unreachable, and only one of them
 * used to be handled:
 *
 * - **its project is gone.** The account still owns the organization, the
 *   organization's projects have been read cleanly, and this one is not among
 *   them.
 * - **it belongs to a different account.** Signing in as somebody else leaves
 *   the previous account's containers registered. Their credential exchange
 *   answers "does not grant the required access" every time the repair runs,
 *   which is a toast about a container the signed-in user has never heard of.
 *
 * The organization a registration remembers is what separates them, and the
 * separation only works against the *account's* organizations rather than the
 * active one: a person with several organizations has candidates loaded for
 * one of them at a time, and an environment in another of their own
 * organizations must be left alone rather than reaped for being unrecognised.
 *
 * @module zerops/deadEnvironment
 */

export interface ZeropsEnvironmentProjectRef {
  readonly orgId: string;
  readonly projectId: string;
}

export function shouldForgetZeropsEnvironment(input: {
  /** What the client remembered about this environment, if anything. */
  readonly ref: ZeropsEnvironmentProjectRef | undefined;
  /** The organization whose projects `knownProjectIds` came from. */
  readonly activeOrgId: string;
  /** Every organization the signed-in account belongs to. */
  readonly accountOrgIds: ReadonlySet<string>;
  /** The active organization's projects, as the account can see them. */
  readonly knownProjectIds: ReadonlySet<string>;
}): boolean {
  const { accountOrgIds, activeOrgId, knownProjectIds, ref } = input;
  // Never learned which project this was: it may be perfectly alive.
  if (ref === undefined) return false;

  // No organizations yet means the account has not been read, not that it
  // belongs to none. Judging against an empty set would forget every
  // environment the moment that read is slow.
  if (accountOrgIds.size === 0) return false;

  // An organization this account is not a member of. No sign-in here will ever
  // reach it, and no later read can prove otherwise.
  if (!accountOrgIds.has(ref.orgId)) return true;

  // Another of this account's organizations: its projects have not been read,
  // so "not among them" means nothing.
  if (ref.orgId !== activeOrgId) return false;

  return !knownProjectIds.has(ref.projectId);
}
