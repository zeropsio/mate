/**
 * Trailing slashes and case are normalized for pathname classification only; the classified
 * pathname is never handed back to the router.
 */
import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

import type { AuthGateState } from "../environments/primary/auth";

const PAIR_PATH_PATTERN = /^\/pair$/iu;

/**
 * The Zerops sign-in callback, built from the contract both halves share so the
 * two cannot drift.
 */
const HANDOVER_PATH_PATTERN = new RegExp(`^${ZEROPS_HANDOVER_CALLBACK_PATH}$`, "iu");

export type DoorDecision = {
  readonly session: "authenticated" | "none";
  readonly shell: "app" | "bare";
  readonly redirect: "/" | "/pair" | null;
} & (
  | {
      readonly surface: "manual-link";
      readonly manualLink: {
        readonly methods: ReadonlyArray<ServerAuthBootstrapMethod>;
      };
    }
  | {
      readonly surface: "zerops-onboarding";
      readonly manualLink: {
        readonly methods: ReadonlyArray<ServerAuthBootstrapMethod>;
      } | null;
    }
  | {
      readonly surface: "hosted-pairing" | "draft-landing" | "app" | "zerops-handover";
      readonly manualLink: null;
    }
);

type GateProfile = {
  readonly session: "authenticated" | "none";
  readonly hasAppGate: boolean;
  readonly hostedPairing: boolean;
  readonly hostedStatic: boolean;
  readonly zeropsDoor: boolean;
};

function unreachable(status: never): never {
  throw new Error(`Unexpected auth gate status: ${String(status)}`);
}

function profileForGate(gate: AuthGateState): GateProfile {
  const status = gate.status;
  switch (status) {
    case "hosted-pairing":
      return {
        session: "none",
        hasAppGate: false,
        hostedPairing: true,
        hostedStatic: false,
        zeropsDoor: false,
      };
    case "hosted-static":
      return {
        session: "none",
        hasAppGate: true,
        hostedPairing: false,
        hostedStatic: true,
        zeropsDoor: false,
      };
    case "authenticated":
      return {
        session: "authenticated",
        hasAppGate: true,
        hostedPairing: false,
        hostedStatic: false,
        zeropsDoor: false,
      };
    case "requires-auth": {
      const zeropsDoor = gate.auth.bootstrapMethods.includes("zerops-identity");
      return {
        session: "none",
        hasAppGate: zeropsDoor,
        hostedPairing: false,
        hostedStatic: false,
        zeropsDoor,
      };
    }
  }
  return unreachable(status);
}

/** A settled failure is unusable; transient connection phases keep the user inside the shell. */
export function countDoorEnvironments(
  environments: ReadonlyArray<{
    readonly connection: { readonly phase: EnvironmentConnectionPhase };
  }>,
): number {
  return environments.filter((environment) => environment.connection.phase !== "error").length;
}

export function resolveDoor(
  gate: AuthGateState,
  input: {
    readonly pathname: string;
    readonly environmentCount: number;
  },
): DoorDecision {
  const profile = profileForGate(gate);
  const bootstrapMethods =
    gate.status === "requires-auth" ? gate.auth.bootstrapMethods : ([] as const);
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";

  // Decided before any gate is consulted, and never redirected. This route runs
  // at the door: the user arrives from app.zerops.io with the credential in the
  // fragment, and every other unauthenticated path is sent to /pair — which a
  // fragment does not survive, leaving them on a sign-in form holding a
  // credential nobody read. The gate it produces is the ordinary one, a moment
  // later, once the exchange has run.
  if (HANDOVER_PATH_PATTERN.test(pathname)) {
    return {
      session: profile.session,
      shell: "bare",
      redirect: null,
      surface: "zerops-handover",
      manualLink: null,
    };
  }

  const isPairPath = PAIR_PATH_PATTERN.test(pathname);
  // The primary server is one way into the shell; a usable environment the
  // client already holds is another. Signed into Zerops on an unpaired
  // origin, a person connects to their environments and has somewhere to be —
  // the shell must open on them, or "Open" leads back to the list it left.
  // Pairing the primary stays available at /pair either way; a hosted pairing
  // in progress is a handshake, not a place to be, so it never counts.
  const entered = profile.hasAppGate || (input.environmentCount > 0 && !profile.hostedPairing);
  const shell = isPairPath || !entered ? "bare" : "app";
  const redirect = isPairPath
    ? profile.zeropsDoor
      ? null
      : profile.hasAppGate
        ? "/"
        : null
    : !entered
      ? "/pair"
      : null;

  if (isPairPath && profile.hostedPairing) {
    return {
      session: profile.session,
      shell,
      redirect,
      surface: "hosted-pairing",
      manualLink: null,
    };
  }

  if (profile.zeropsDoor && (isPairPath || (pathname === "/" && input.environmentCount === 0))) {
    return {
      session: profile.session,
      shell,
      redirect,
      surface: "zerops-onboarding",
      manualLink: { methods: bootstrapMethods },
    };
  }

  if (isPairPath && gate.status === "requires-auth") {
    return {
      session: profile.session,
      shell,
      redirect,
      surface: "manual-link",
      manualLink: { methods: bootstrapMethods },
    };
  }

  if (pathname === "/") {
    return {
      session: profile.session,
      shell,
      redirect,
      surface:
        profile.hostedStatic && input.environmentCount === 0
          ? "zerops-onboarding"
          : "draft-landing",
      manualLink: null,
    };
  }

  return { session: profile.session, shell, redirect, surface: "app", manualLink: null };
}
