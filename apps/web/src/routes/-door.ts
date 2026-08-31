/**
 * `redirect` is the protected-route decision and deliberately points `/connect*` to `/pair`
 * under `requires-auth`; the real connect routes (`connect.tsx` and `/connect/callback`) must never
 * consume it. `shell` is the only home of the `/connect` carve-out. Trailing slashes and case are
 * normalized for pathname classification only; the classified pathname is never handed back to
 * the router.
 */
import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";

import type { AuthGateState } from "../environments/primary/auth";

const PAIR_PATH_PATTERN = /^\/pair$/iu;
const CONNECTION_PATH_PATTERN = /^\/connect(?:\/|$)/iu;

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
      readonly surface: "hosted-pairing" | "draft-landing" | "app";
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
  const isPairPath = PAIR_PATH_PATTERN.test(pathname);
  const isConnectionPath = CONNECTION_PATH_PATTERN.test(pathname);
  const shell = isPairPath || isConnectionPath || !profile.hasAppGate ? "bare" : "app";
  const redirect = isPairPath
    ? profile.zeropsDoor
      ? null
      : profile.hasAppGate
        ? "/"
        : null
    : !profile.hasAppGate
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

  if (profile.zeropsDoor && (pathname === "/" || isPairPath)) {
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
