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
      readonly surface: "hosted-pairing" | "zerops-onboarding" | "draft-landing" | "app";
      readonly manualLink: null;
    }
);

type GateProfile = {
  readonly session: "authenticated" | "none";
  readonly hasAppGate: boolean;
  readonly hostedPairing: boolean;
  readonly hostedStatic: boolean;
  readonly manualLinkMethods: ReadonlyArray<ServerAuthBootstrapMethod> | null;
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
        manualLinkMethods: null,
      };
    case "hosted-static":
      return {
        session: "none",
        hasAppGate: true,
        hostedPairing: false,
        hostedStatic: true,
        manualLinkMethods: null,
      };
    case "authenticated":
      return {
        session: "authenticated",
        hasAppGate: true,
        hostedPairing: false,
        hostedStatic: false,
        manualLinkMethods: null,
      };
    case "requires-auth":
      return {
        session: "none",
        hasAppGate: false,
        hostedPairing: false,
        hostedStatic: false,
        manualLinkMethods: gate.auth.bootstrapMethods,
      };
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
  const pathname = input.pathname.replace(/\/+$/u, "") || "/";
  const isPairPath = PAIR_PATH_PATTERN.test(pathname);
  const isConnectionPath = CONNECTION_PATH_PATTERN.test(pathname);
  const shell = isPairPath || isConnectionPath || !profile.hasAppGate ? "bare" : "app";
  const redirect = isPairPath
    ? profile.hasAppGate
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

  if (isPairPath && profile.manualLinkMethods !== null) {
    return {
      session: profile.session,
      shell,
      redirect,
      surface: "manual-link",
      manualLink: { methods: profile.manualLinkMethods },
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
