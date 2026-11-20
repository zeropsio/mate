import type { AgentAdmissionRefusal, ZeropsAgentId } from "@t3tools/contracts";
import {
  zeropsAgentUnavailableReason,
  zeropsLoginTitle,
  zeropsLoginUnavailableReason,
} from "@t3tools/shared/zeropsAgentAuth";

import { AUTOMATED_MATE_SIGNS_NOBODY_IN } from "../ZeropsAutomation.ts";
import type { MateLogin } from "../ZeropsLogins.ts";
import type { GateRefusal } from "../ZeropsProjectSigners.ts";
import type { SignerStanding } from "../ZeropsSignerStanding.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";

/** The login a turn would spend, as the service found it. */
export type AdmissionTarget =
  /** No instance named, or none that resolves to an agent: nothing to judge. */
  | { readonly kind: "none" }
  /** An agent the auth feed does not list: passes unjudged, yet it is a sign-in where only the key may run. */
  | { readonly kind: "unlisted-agent" }
  /** A login beyond the defaults, and HQ's map of signers on it (`ZeropsProjectSigners.loginRefusal`). */
  | {
      readonly kind: "login";
      readonly login: Pick<MateLogin, "id" | "agent" | "kind" | "label">;
      readonly refusal: GateRefusal | undefined;
    }
  /** An agent's own login, whether a project token authorizes it, and the map's answer (`turnRefusal`). */
  | {
      readonly kind: "agent";
      readonly agentId: ZeropsAgentId;
      readonly token: boolean;
      readonly refusal: GateRefusal | undefined;
    };

export interface AdmissionFacts {
  readonly principal: TurnPrincipal;
  readonly target: AdmissionTarget;
  /** Only the organization's API key may run: an automated Mate, or a task's run anywhere. */
  readonly organizationKeyOnly: boolean;
  /** HQ's standing of a crew turn's starter; read only where `asksStanding` holds; `undefined`: HQ could not say. */
  readonly standing: SignerStanding | undefined;
}

export type AdmissionRefusalKind =
  | "access-lost"
  | "open-mate-once"
  | "organization-key"
  | "not-signed-in"
  | "unrecorded"
  | "someone-else"
  | "owner-sign-in";

export type AdmissionVerdict =
  | { readonly _tag: "Admit" }
  | {
      readonly _tag: "Refuse";
      readonly kind: AdmissionRefusalKind;
      readonly message: string;
      readonly agentAdmission?: AgentAdmissionRefusal;
      readonly forNow?: true;
    }
  | { readonly _tag: "Undetermined"; readonly message: string };

/**
 * A run for somebody away refused because HQ could not say their standing now: the engine asks
 * again, patiently, before the run fails with these words (`RunRefused.undetermined`).
 */
const ACCESS_UNCONFIRMED =
  "Could not confirm that the person this turn runs for still has access to this project. Try again in a moment.";

/**
 * A turn on a login with no signer on record, asked before HQ's map of signers was heard in this
 * process (`ZeropsProjectSigners`, `SIGNERS_WAIT`): whose the login is cannot be said yet, so the
 * engine asks again, as for {@link ACCESS_UNCONFIRMED}.
 */
const SIGNERS_UNHEARD =
  "Zerops Mate has not heard from HQ yet who signed this agent in, so it cannot tell whose turn this is. Try again in a moment.";

/**
 * A run for another Mate's message on a login its owner did not sign in here (a project token, an
 * agent Mate signs nobody in to): such a message spends only its owner's own sign-in, and waits.
 */
const MATE_MESSAGE_NEEDS_OWNER =
  "Another Mate's message runs only on an agent its owner signed in here.";

/** The sentence a refused turn reports. */
export function turnRefusalMessage(agentId: ZeropsAgentId, refusal: GateRefusal): string {
  switch (refusal.kind) {
    case "signers-unheard":
      return SIGNERS_UNHEARD;
    case "not-signed-in":
      return zeropsAgentUnavailableReason(agentId, refusal.auth);
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";
    case "someone-else":
      return "This agent was signed in by another project member — only they can run it.";
  }
}

/** The sentence a refused turn on a login beyond the defaults reports. */
export function loginRefusalMessage(
  login: Pick<MateLogin, "agent" | "kind" | "label">,
  refusal: GateRefusal,
): string {
  const title = zeropsLoginTitle(login);
  switch (refusal.kind) {
    case "signers-unheard":
      return SIGNERS_UNHEARD;
    case "not-signed-in":
      return zeropsLoginUnavailableReason({ ...login, default: false }, refusal.auth);
    case "unrecorded":
      return `${title}'s sign-in was not recorded by Zerops Mate, so nobody can run it. Sign it in with your own account first.`;
    case "someone-else":
      return `${title} was signed in by another project member — only they can run it.`;
  }
}

/**
 * The login a refusal is about and why, as clients and the engine's run ends carry it; none for a
 * refusal that is no verdict on a login (`signers-unheard`).
 */
const admissionRefusalOf = (
  loginId: string,
  refusal: GateRefusal,
): AgentAdmissionRefusal | undefined => {
  switch (refusal.kind) {
    case "signers-unheard":
      return undefined;
    case "unrecorded":
      return { loginId, reason: "unrecorded" };
    case "someone-else":
      return { loginId, reason: "not-permitted" };
    case "not-signed-in":
      return {
        loginId,
        reason:
          refusal.auth === "needs-reauth" || refusal.auth === "reconnect"
            ? "expired-login"
            : "missing-sign-in",
      };
  }
};

/** A project token belongs to the project. Admission on it establishes no personal signer. */
function signedByPrincipal(target: AdmissionTarget): boolean {
  return (
    (target.kind === "login" && target.refusal === undefined) ||
    (target.kind === "agent" && target.refusal === undefined && !target.token)
  );
}

/**
 * The gate is read first because a crew turn asks HQ about its starter only on a login they
 * signed. A login nobody signed asks nobody. HQ ends a person's own session when their standing
 * changes. A stand-up is the person's own act of adding the Mate, so it needs no second check.
 */
export function asksStanding(
  principal: TurnPrincipal,
  target: AdmissionTarget,
): principal is Extract<TurnPrincipal, { readonly kind: "crew" }> {
  return principal.kind === "crew" && signedByPrincipal(target);
}

export function admissionVerdict({
  principal,
  target,
  standing,
  organizationKeyOnly,
}: AdmissionFacts): AdmissionVerdict {
  // Only `may` lets a crew turn spend its starter's sign-in. Silence leaves standing undetermined.
  if (asksStanding(principal, target)) {
    switch (standing) {
      case undefined:
        return { _tag: "Undetermined", message: ACCESS_UNCONFIRMED };
      case "no_access":
      case "left":
        return {
          _tag: "Refuse",
          kind: "access-lost",
          message: "The person this turn runs for no longer has access to this project.",
        };
      case "sign_in_needed":
        return {
          _tag: "Refuse",
          kind: "open-mate-once",
          message:
            "The person this turn runs for needs to open Mate once so HQ can confirm their access.",
        };
      case "may":
        break;
    }
  }

  // An automated Mate or a task runs only on the organization's key. Both the default
  // Claude Code or Codex sign-in and a subscription login fall under that restriction.
  if (
    organizationKeyOnly &&
    (target.kind === "agent" ||
      target.kind === "unlisted-agent" ||
      (target.kind === "login" && target.login.kind === "subscription"))
  ) {
    return { _tag: "Refuse", kind: "organization-key", message: AUTOMATED_MATE_SIGNS_NOBODY_IN };
  }

  if ((target.kind === "login" || target.kind === "agent") && target.refusal !== undefined) {
    const { refusal } = target;
    if (refusal.kind === "signers-unheard")
      return { _tag: "Undetermined", message: SIGNERS_UNHEARD };
    const agentAdmission = admissionRefusalOf(
      target.kind === "login" ? target.login.id : target.agentId,
      refusal,
    );
    return {
      _tag: "Refuse",
      kind: refusal.kind,
      message:
        target.kind === "login"
          ? loginRefusalMessage(target.login, refusal)
          : turnRefusalMessage(target.agentId, refusal),
      ...(agentAdmission ? { agentAdmission } : {}),
    };
  }

  if (principal.kind === "mate" && !signedByPrincipal(target)) {
    return {
      _tag: "Refuse",
      kind: "owner-sign-in",
      message: MATE_MESSAGE_NEEDS_OWNER,
      forNow: true,
    };
  }
  return { _tag: "Admit" };
}
