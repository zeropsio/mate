import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * What opening a Mate does now: nothing while it is on its way off Zerops; its own view while its
 * conversation cannot be opened yet; the conversation it has or HQ names; or a new one in its
 * environment's project.
 */
export type MateOpening<Project> =
  | { readonly kind: "going" }
  | { readonly kind: "own-view" }
  | { readonly kind: "conversation"; readonly conversation: ScopedThreadRef }
  | { readonly kind: "new-conversation"; readonly project: Project };

export function mateOpening<Project>(input: {
  readonly going: boolean;
  /** The listing holds its row, and that row is not still coming up. */
  readonly settled: boolean;
  /** The registered environment its row opens in. */
  readonly linked: boolean;
  /** Its main chat in that environment, as this page holds its conversations. */
  readonly primary: ScopedThreadRef | undefined;
  /** The main chat HQ names for it. */
  readonly told: ScopedThreadRef | undefined;
  /** Its project in that environment, once its conversations are read here. */
  readonly project: Project | undefined;
}): MateOpening<Project> {
  if (input.going) return { kind: "going" };
  if (!input.settled) return { kind: "own-view" };
  const conversation = input.linked ? (input.primary ?? input.told) : input.told;
  if (conversation !== undefined) return { kind: "conversation", conversation };
  if (!input.linked || input.project === undefined) return { kind: "own-view" };
  return { kind: "new-conversation", project: input.project };
}
