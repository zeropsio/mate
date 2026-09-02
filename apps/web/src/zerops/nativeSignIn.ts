/**
 * The renderer half of the native (system-browser) Zerops sign-in: pure
 * orchestration, no React and no DOM, so the whole state machine can be
 * driven and asserted directly in a test rather than through a rendered
 * component.
 *
 * `apps/desktop/src/zerops/DesktopZeropsSignIn.ts` owns the main-process
 * half — opening the browser, listening on the loopback port, and resolving
 * with the callback fragment or `cancelled`. This file starts there and
 * finishes exactly where the in-tab flow does: `completeZeropsHandover` for
 * verification, `adoptHandover` (the same `ZeropsSessionProvider` method
 * `/zerops_/authorized` uses) for adoption.
 */
import type { DesktopBridge } from "@t3tools/contracts";
import type { ZeropsHandoverOutcome } from "@t3tools/client-runtime/zerops/handover";

import { completeZeropsHandover, mintZeropsHandoverNonce } from "./handover";
import { zeropsErrorMessage } from "./ZeropsSessionProvider";

export type ZeropsNativeSignInState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The bridge method, or `null` when this build has no native sign-in to
 * offer — an older desktop build, or a plain browser. `window` itself is
 * guarded rather than assumed: this app never runs server-side in
 * production, but its component tests render outside a DOM.
 */
export function readZeropsNativeSignInBridge(): NonNullable<DesktopBridge["zeropsSignIn"]> | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.zeropsSignIn ?? null;
}

export interface ZeropsNativeSignInDeps {
  readonly zeropsSignIn: NonNullable<DesktopBridge["zeropsSignIn"]>;
  readonly adoptHandover: (input: {
    readonly token: string;
    readonly clientId: string | null;
    readonly zcpClaimed: boolean;
  }) => Promise<void>;
  /**
   * Defaults to the real `completeZeropsHandover` (nonce verification against
   * `sessionStorage`, unchanged from the in-tab flow). Injectable so this
   * state machine can be exercised in a test without a DOM to back the store.
   */
  readonly completeHandover?: (input: { readonly fragment: string }) => ZeropsHandoverOutcome;
}

/**
 * Mirrors the copy `/zerops_/authorized` shows for the same two outcomes —
 * kept here rather than imported so this file stays independent of that
 * route (which has its own component-level concerns: `beforeLoad`, redirect
 * timing) while agreeing with it on what the user reads.
 */
function outcomeErrorMessage(
  outcome: Extract<ZeropsHandoverOutcome, { kind: "mismatched" | "declined" }>,
): string {
  if (outcome.kind === "mismatched") {
    return "That sign-in did not come from this window. Start again from Zerops Mate.";
  }
  return outcome.code === "access_denied"
    ? "Sign-in was cancelled."
    : "Zerops could not complete that sign-in.";
}

/**
 * Runs one attempt end to end and reports every state transition through
 * `setState`. `isCurrent` is checked before each update that follows an
 * `await`: the Cancel button lets the caller abandon a run that is still
 * pending on the main-process side (it keeps listening until it times out,
 * the window closes, or the browser comes back), and a late resolution must
 * not resurrect a UI the user already moved on from.
 */
export async function runZeropsNativeSignIn(
  deps: ZeropsNativeSignInDeps,
  input: { readonly intent?: "register" },
  setState: (state: ZeropsNativeSignInState) => void,
  isCurrent: () => boolean,
  mintNonce: () => string = mintZeropsHandoverNonce,
): Promise<void> {
  setState({ kind: "busy" });
  const state = mintNonce();

  let result;
  try {
    result = await deps.zeropsSignIn({ state, ...(input.intent ? { intent: input.intent } : {}) });
  } catch (cause) {
    if (isCurrent()) setState({ kind: "error", message: zeropsErrorMessage(cause) });
    return;
  }
  if (!isCurrent()) return;

  if (result.kind === "cancelled") {
    setState({ kind: "idle" });
    return;
  }

  const completeHandover = deps.completeHandover ?? completeZeropsHandover;
  const outcome = completeHandover({ fragment: result.fragment });
  if (outcome.kind === "absent") {
    setState({ kind: "idle" });
    return;
  }
  if (outcome.kind !== "session") {
    setState({ kind: "error", message: outcomeErrorMessage(outcome) });
    return;
  }

  try {
    await deps.adoptHandover({
      token: outcome.token,
      clientId: outcome.clientId,
      zcpClaimed: outcome.zcpClaimed,
    });
  } catch (cause) {
    if (isCurrent()) setState({ kind: "error", message: zeropsErrorMessage(cause) });
    return;
  }
  if (isCurrent()) setState({ kind: "idle" });
}
