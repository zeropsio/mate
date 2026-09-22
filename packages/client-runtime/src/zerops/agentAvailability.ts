/**
 * One client answer to "can this viewer run this agent right now" — folding
 * `classifyZeropsAgentAuth` (`@t3tools/shared/zeropsAgentAuth`, the one
 * classification every surface reads for "is this agent signed in on the
 * project at all"), a server-driven login session in progress, and D6
 * ownership (whose signer it is) into a single answer the composer and the
 * model picker both read.
 *
 * ## Why a new module rather than `agentLogin.ts`
 *
 * `agentLogin.ts` classifies the same `ZeropsAgentAuth` row for the Zerops
 * panel card, but stops at "is there something to sign in" — it never looks
 * at D6 ownership, so an agent signed in by a colleague reads as fully
 * `authorized` there. The composer and the picker need the ownership-aware
 * answer instead, and this module is kept separate (rather than folded into
 * `agentLogin.ts`) so the two can evolve without a merge conflict.
 *
 * ## Agreement with the server gate
 *
 * The server refuses a turn-starting command with `turnRefusal`
 * (`apps/server/src/zerops/ZeropsProjectSigners.ts`), which answers in the
 * same order this module does: is the agent signed in at all
 * (`classifyZeropsAgentAuth`), then whose login it is. This module's
 * ownership branch is a direct port of `turnRefusal`'s — including the one
 * case that is not what `agentOwnership.ts`'s `resolveAgentOwnership` says:
 * a session whose subject could not be identified is `someone-else` here
 * (never `unrecorded`), because that is what the server refuses it as.
 *
 * `flagToken` and the `authorized`/`registering` branches match `turnRefusal`
 * exactly; a not-signed-in agent is `needs-sign-in`, never `ready` — nothing
 * runs there either way, and offering it would just relocate the refusal
 * from the gate to the turn itself.
 *
 * ## No more `checking`
 *
 * `classifyZeropsAgentAuth` no longer has a "the provider check hasn't
 * answered yet" limbo: the platform sign-in flag decides the moment it is
 * set, full stop. `agentOwnership.ts`'s `record-failed` still has no slot in
 * the composer/picker's action table, so it folds into `unrecorded` — the
 * one recovery offered either way is running the sign-in flow again, which
 * re-attempts the record write on success.
 *
 * @module agentAvailability
 */
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
  type ZeropsAgentAuthKind,
} from "@t3tools/shared/zeropsAgentAuth";
import type { ZeropsAgentLoginPhase } from "@t3tools/contracts";

import type { ZeropsAgentAuthorizer } from "./agentOwnership.ts";

/** The auth kind behind a `needs-sign-in` answer — what button copy to show. */
export type ZeropsAgentSignInKind = Exclude<
  ZeropsAgentAuthKind["kind"],
  "authorized" | "registering"
>;

export type ZeropsAgentAvailability =
  | { readonly kind: "ready" }
  /** Signed in inside this container, the project flag seconds away — the CLI works, only ownership decides. */
  | { readonly kind: "registering" }
  /** A server-driven login session is actively running (or just finished) for this agent. */
  | { readonly kind: "signing-in" }
  | { readonly kind: "needs-sign-in"; readonly signInKind: ZeropsAgentSignInKind }
  /** Someone else signed this agent in — or the viewer could not be identified (turnRefusal treats both alike). */
  | { readonly kind: "someone-else"; readonly signerId: string | undefined }
  /** Signed in on the project, but no signer was recorded for it (or this browser's own record write failed, H13). */
  | { readonly kind: "unrecorded" };

const IN_PROGRESS_LOGIN_PHASES: ReadonlySet<ZeropsAgentLoginPhase> = new Set([
  "starting",
  "menu",
  "awaiting-browser",
  "awaiting-code",
]);

export interface ZeropsAgentAvailabilityInput extends ZeropsAgentAuthFields {
  readonly flagToken: boolean;
  /** Only the phase matters here — the rest of the login session is presentation. */
  readonly loginPhase?: ZeropsAgentLoginPhase | undefined;
  readonly authorizedBy?: ZeropsAgentAuthorizer | undefined;
  /** The signed-in Zerops user's id, or `undefined` when nobody is signed in. */
  readonly viewerSubject: string | undefined;
  /** This browser's own signer-record write for this agent has failed and not yet succeeded (H13). */
  readonly recordFailed?: boolean | undefined;
}

export function resolveZeropsAgentAvailability(
  input: ZeropsAgentAvailabilityInput,
): ZeropsAgentAvailability {
  // classifyZeropsAgentAuth decides FIRST, exactly like `turnRefusal`: a
  // token agent whose own CLI probe says unauthenticated is refused as
  // not-signed-in before `flagToken` is ever consulted — the token bypasses
  // ownership, never the sign-in check itself.
  const auth = classifyZeropsAgentAuth(input).kind;

  const otherwise: ZeropsAgentAvailability =
    auth !== "authorized" && auth !== "registering"
      ? { kind: "needs-sign-in", signInKind: auth }
      : input.flagToken
        ? { kind: "ready" }
        : resolveZeropsAgentOwnership(input, auth);

  // A server-driven login session in progress only matters when this viewer
  // could not otherwise run the agent: the server does not care that
  // somebody — possibly the viewer themself, re-authorizing — is mid-login,
  // only who the recorded signer is. Without this, any in-progress re-login
  // would read as `signing-in` for every viewer, hiding that their own turn
  // would still go through.
  if (
    !zeropsAgentAvailabilityIsRunnable(otherwise) &&
    input.loginPhase !== undefined &&
    IN_PROGRESS_LOGIN_PHASES.has(input.loginPhase)
  ) {
    return { kind: "signing-in" };
  }

  return otherwise;
}

/**
 * Ownership, ported from `turnRefusal` rather than `resolveAgentOwnership`:
 * an unidentified viewer is `someone-else`, not `unrecorded` — the server
 * refuses it as somebody else's either way. `recordFailed` (this browser's
 * own just-attempted write, H13) only matters when nothing is recorded at
 * all; an `authorizedBy` tag the server already carries — naming the viewer
 * or somebody else — is the truth regardless of a stale local failure flag.
 */
function resolveZeropsAgentOwnership(
  input: Pick<ZeropsAgentAvailabilityInput, "authorizedBy" | "viewerSubject" | "recordFailed">,
  auth: Extract<ZeropsAgentAuthKind["kind"], "authorized" | "registering">,
): ZeropsAgentAvailability {
  const signer = input.authorizedBy?.subject;
  if (signer === undefined || signer.length === 0) return { kind: "unrecorded" };
  if (input.viewerSubject !== signer) return { kind: "someone-else", signerId: signer };
  return auth === "authorized" ? { kind: "ready" } : { kind: "registering" };
}

/** Whether the composer may select this agent: `ready` now, or `registering` on its way there. */
export function zeropsAgentAvailabilityIsRunnable(availability: ZeropsAgentAvailability): boolean {
  return availability.kind === "ready" || availability.kind === "registering";
}
