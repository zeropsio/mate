/**
 * Capabilities (DESIGN §4.3): whether a class of command may run now — `allowed`, or `no` with a
 * typed reason and whether waiting may change it. A capability is derived, never stored: it is
 * read from the access grant at the instant it is asked, on both of the grant's own clocks, so a
 * deadline a frozen or throttled tab slept through is honoured the moment anything asks.
 *
 * Losing a capability disables verbs. It never unmounts anything and never cancels other work.
 */
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { DEFAULT_ZEROPS_GRANT_POLICY } from "../policy.ts";
import type { CommandAdmissionError, ZeropsProjectId } from "../types.ts";
import type { WriteAdmission } from "../../api.ts";
import type { ZeropsAccessGrant } from "./grantDriver.ts";
import {
  grantAccount,
  grantPlatformRead,
  grantPlatformWrite,
  type GrantCapability,
  type GrantContext,
  type GrantMachine,
} from "./grant.ts";

/** What a command asks of the grant. */
export type CapabilityAsk =
  /** The account's own evidence, whatever project a command names. */
  | { readonly kind: "account" }
  | { readonly kind: "platformWrite"; readonly project: ZeropsProjectId }
  | { readonly kind: "platformRead"; readonly project: ZeropsProjectId }
  | { readonly kind: "identityMint" };

/**
 * Door and Gitea throwaway mints (spec-mate C6, D6(b)): once the epoch's first grant was admitted,
 * whatever the window. A throwaway carries no rights, so no organization or project role is
 * checked — the door and the broker decide roles. A mint that grants a project is a
 * `platformWrite` of that project instead.
 */
export const identityMint = (machine: GrantMachine): GrantCapability => {
  switch (machine.phase.phase) {
    case "closed":
      return { allowed: false, reason: "epoch-closed", waitable: false };
    case "unverified":
    case "verifying":
    case "unverified-failed":
      return { allowed: false, reason: "access-unverified", waitable: true };
    case "granted":
    case "lapsed":
      return { allowed: true };
  }
};

const answer = (ask: CapabilityAsk, machine: GrantMachine, ctx: GrantContext): GrantCapability => {
  switch (ask.kind) {
    case "account":
      return grantAccount(machine, ctx);
    case "platformWrite":
      return grantPlatformWrite(machine, ask.project, ctx);
    case "platformRead":
      return grantPlatformRead(machine, ask.project, ctx);
    case "identityMint":
      return identityMint(machine);
  }
};

/**
 * A capability of any class (§4.3): the grant's refusals, and those of a Mate's connection and a
 * Gitea session.
 */
export type Capability =
  | GrantCapability
  | {
      readonly allowed: false;
      readonly reason: "mate-not-connected" | "gitea-session";
      readonly waitable: boolean;
    };

/** One Mate environment as `mate(env)` weighs it. */
export interface MateCapabilityInput {
  /** The epoch's post-grant stage runs. */
  readonly postGrant: boolean;
  readonly credential: "held" | "none";
  /** `reconnecting` covers every link state the supervisor leaves on its own. */
  readonly link: "connected" | "reconnecting" | "blocked";
  /** `platformRead` of the environment's project. */
  readonly project: GrantCapability;
}

/**
 * Mate commands (§4.3): the post-grant stage runs, a credential is held and the link connected,
 * and the environment's project is readable. Only a reconnecting link may still connect on its own.
 */
export const mate = (input: MateCapabilityInput): Capability => {
  if (!input.postGrant) return { allowed: false, reason: "access-unverified", waitable: true };
  if (!input.project.allowed) return input.project;
  if (input.credential === "held" && input.link === "connected") return { allowed: true };
  return { allowed: false, reason: "mate-not-connected", waitable: input.link === "reconnecting" };
};

/** The phase of one Gitea session (`forge/giteaSessionMachine.ts`), as `forge(origin)` weighs it. */
export type GiteaSessionKind =
  | "idle"
  | "acquiring"
  | "signed-in"
  | "reacquiring"
  | "pending"
  | "unavailable"
  | "waiting"
  | "refused"
  | "closed";

/**
 * Forge commands on one Gitea origin (§4.3): its session is signed in. A session getting a token
 * or waiting for Gitea to finish setting up may still bring one; any other has none coming.
 */
export const forge = (session: GiteaSessionKind): Capability => {
  switch (session) {
    case "signed-in":
      return { allowed: true };
    case "closed":
      return { allowed: false, reason: "epoch-closed", waitable: false };
    case "acquiring":
    case "reacquiring":
    case "pending":
      return { allowed: false, reason: "gitea-session", waitable: true };
    case "idle":
    case "unavailable":
    case "waiting":
    case "refused":
      return { allowed: false, reason: "gitea-session", waitable: false };
  }
};

/**
 * Deleting a throwaway (§4.3, C5b): always, within the epoch that minted it — its finalizer carries
 * the minting token — or by a sweep under the same principal. It never waits and never touches the
 * session.
 */
export const throwawayCleanup = (minted: {
  readonly sameEpoch: boolean;
  readonly samePrincipal: boolean;
}): GrantCapability =>
  minted.sameEpoch || minted.samePrincipal
    ? { allowed: true }
    : { allowed: false, reason: "epoch-closed", waitable: false };

type Refusal = Extract<GrantCapability, { readonly allowed: false }>;

/** Each refusal in the cause's own words; the way on is the surface's to offer. */
const REFUSAL_COPY: Record<Refusal["reason"], string> = {
  "access-unverified": "Your Zerops access is still being checked.",
  "access-lapsed": "Your Zerops access is being checked again.",
  "project-unverified": "Your access to this project is still being checked.",
  "role-denies": "Your role in this project doesn't allow this.",
  "project-closed": "Your access to this project changed.",
  "epoch-closed": "This Zerops sign-in has ended.",
};

/** A capability that was not there: why, and whether asking again later may find it. */
export class CapabilityRefusal extends Data.TaggedError("CapabilityRefusal")<{
  readonly reason: Refusal["reason"];
  readonly waitable: boolean;
  readonly message: string;
}> {
  constructor(refusal: Refusal) {
    super({
      reason: refusal.reason,
      waitable: refusal.waitable,
      message: REFUSAL_COPY[refusal.reason],
    });
  }
}

const UNVERIFIED_ADMISSION = "Project access could not be verified.";

/** How long a command waits for a waitable capability before it is refused (§4.3). */
export const CAPABILITY_WAIT_MS = 30_000;

/**
 * A refusal in the terms every command's and project write's caller already reads: a command's
 * admission. It is the command's final answer, so evidence that is still being checked is, for
 * that command, evidence that could not be verified.
 */
const ADMISSION: Record<Refusal["reason"], Pick<CommandAdmissionError, "reason" | "message">> = {
  "access-unverified": { reason: "access-unverified", message: UNVERIFIED_ADMISSION },
  "access-lapsed": { reason: "access-expired", message: UNVERIFIED_ADMISSION },
  "project-unverified": { reason: "access-unverified", message: UNVERIFIED_ADMISSION },
  "role-denies": { reason: "access-denied", message: REFUSAL_COPY["role-denies"] },
  "project-closed": { reason: "access-denied", message: REFUSAL_COPY["project-closed"] },
  "epoch-closed": { reason: "runtime-closed", message: REFUSAL_COPY["epoch-closed"] },
};

/** A capability's refusal as a command's admission error. */
export const commandAdmissionOf = (refusal: Pick<Refusal, "reason">): CommandAdmissionError => ({
  _tag: "ZeropsCommandAdmissionError",
  ...ADMISSION[refusal.reason],
});

export interface GrantCapabilities {
  /** The capability now. */
  readonly check: (ask: CapabilityAsk) => Effect.Effect<GrantCapability>;
  /**
   * Waits up to `withinMs` for a waitable refusal to become allowed, before the command's own
   * deadline starts (§4.0). Fails with the refusal at once when nothing can change it, and with
   * the refusal still waitable when the wait ran out.
   */
  readonly await: (
    ask: CapabilityAsk,
    options: { readonly withinMs: number },
  ) => Effect.Effect<void, CapabilityRefusal>;
  /**
   * Admits a project write on the account's own evidence, waiting up to {@link CAPABILITY_WAIT_MS}
   * for it. Which project a write names is its caller's to check.
   */
  readonly admitProjectWrite: Effect.Effect<void, CommandAdmissionError>;
}

/** The capabilities one epoch's access grant holds. */
export const grantCapabilities = (
  grant: Pick<ZeropsAccessGrant, "changes" | "clock">,
): GrantCapabilities => {
  /** The grant's machine as it is now: `changes` replays the latest view first. */
  const current = Stream.runHead(grant.changes).pipe(
    Effect.map((view) => Option.getOrThrow(view).machine),
  );
  // The grant's own clock, never the asker's: its evidence was stamped on it.
  const ctx = Effect.sync(() => ({
    now: {
      wall: grant.clock.currentTimeMillisUnsafe(),
      mono: Number(grant.clock.monotonicTimeNanosUnsafe()) / 1_000_000,
    },
    policy: DEFAULT_ZEROPS_GRANT_POLICY,
  }));
  const check = (ask: CapabilityAsk) =>
    Effect.map(Effect.all([current, ctx]), ([machine, at]) => answer(ask, machine, at));
  const awaitCapability: GrantCapabilities["await"] = (ask, { withinMs }) =>
    grant.changes.pipe(
      Stream.mapEffect((view) => Effect.map(ctx, (at) => answer(ask, view.machine, at))),
      Stream.filter((capability) => capability.allowed || !capability.waitable),
      Stream.runHead,
      // A grant that stops publishing answers with what it holds now.
      Effect.flatMap(Option.match({ onNone: () => check(ask), onSome: Effect.succeed })),
      Effect.timeoutOrElse({ duration: Duration.millis(withinMs), orElse: () => check(ask) }),
      Effect.flatMap((capability) =>
        capability.allowed ? Effect.void : Effect.fail(new CapabilityRefusal(capability)),
      ),
      // The wait runs out on the grant's clock too.
      Effect.provideService(Clock.Clock, grant.clock),
    );
  return {
    check,
    await: awaitCapability,
    admitProjectWrite: awaitCapability({ kind: "account" }, { withinMs: CAPABILITY_WAIT_MS }).pipe(
      Effect.mapError(commandAdmissionOf),
    ),
  };
};

/** The api's project-write admission over an epoch's capabilities, on the real clock. */
export const writeAdmissionOf = (capabilities: GrantCapabilities): WriteAdmission => ({
  beforeProjectWrite: () => Effect.runPromise(capabilities.admitProjectWrite),
});
