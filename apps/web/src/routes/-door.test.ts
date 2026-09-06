import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type {
  EnvironmentId,
  ServerAuthBootstrapMethod,
  ServerAuthDescriptor,
} from "@t3tools/contracts";
import { isRedirect } from "@tanstack/react-router";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AuthGateState } from "../environments/primary/auth";
import {
  awaitDoorEnvironmentCount,
  countDoorEnvironments,
  type DoorDecision,
  type DoorRegistry,
  resolveDoor,
} from "./-door";
import { Route as PairRoute } from "./pair";

const BOTH_COUNTS = [0, 1] as const;

function authDescriptor(
  bootstrapMethods: ReadonlyArray<ServerAuthBootstrapMethod>,
): ServerAuthDescriptor {
  return {
    policy: "loopback-browser",
    bootstrapMethods: [...bootstrapMethods],
    sessionMethods: ["browser-session-cookie"],
    sessionCookieName: "t3_session",
  };
}

type DoorExpectation = {
  readonly pathname: string;
  readonly environmentCounts: ReadonlyArray<0 | 1>;
  readonly expected: DoorDecision;
};

type GateExpectations = {
  readonly label: string;
  readonly gate: AuthGateState;
  readonly rows: ReadonlyArray<DoorExpectation>;
};

const GATE_EXPECTATIONS = [
  {
    label: "hosted-pairing",
    gate: { status: "hosted-pairing" },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/",
        environmentCounts: [1],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "hosted-pairing",
          manualLink: null,
        },
      },
      {
        pathname: "/settings",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "hosted-static",
    gate: { status: "hosted-static" },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "zerops-onboarding",
          manualLink: null,
        },
      },
      {
        pathname: "/",
        environmentCounts: [1],
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/settings",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "authenticated",
    gate: { status: "authenticated" },
    rows: [
      {
        pathname: "/",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "bare",
          redirect: "/",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/settings",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "authenticated",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "requires-auth:one-time-token",
    gate: { status: "requires-auth", auth: authDescriptor(["one-time-token"]) },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "manual-link",
          manualLink: { methods: ["one-time-token"] },
        },
      },
      {
        pathname: "/settings",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "requires-auth:zerops-identity+one-time-token",
    gate: {
      status: "requires-auth",
      auth: authDescriptor(["zerops-identity", "one-time-token"]),
    },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "zerops-onboarding",
          manualLink: { methods: ["zerops-identity", "one-time-token"] },
        },
      },
      {
        pathname: "/",
        environmentCounts: [1],
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "zerops-onboarding",
          manualLink: { methods: ["zerops-identity", "one-time-token"] },
        },
      },
      {
        pathname: "/settings",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "app",
          redirect: null,
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "requires-auth:desktop-bootstrap",
    gate: { status: "requires-auth", auth: authDescriptor(["desktop-bootstrap"]) },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "manual-link",
          manualLink: { methods: ["desktop-bootstrap"] },
        },
      },
      {
        pathname: "/settings",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "requires-auth:desktop-bootstrap+one-time-token",
    gate: {
      status: "requires-auth",
      auth: authDescriptor(["desktop-bootstrap", "one-time-token"]),
    },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "manual-link",
          manualLink: { methods: ["desktop-bootstrap", "one-time-token"] },
        },
      },
      {
        pathname: "/settings",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
  {
    label: "requires-auth:empty",
    gate: { status: "requires-auth", auth: authDescriptor([]) },
    rows: [
      {
        pathname: "/",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "draft-landing",
          manualLink: null,
        },
      },
      {
        pathname: "/pair",
        environmentCounts: BOTH_COUNTS,
        expected: {
          session: "none",
          shell: "bare",
          redirect: null,
          surface: "manual-link",
          manualLink: { methods: [] },
        },
      },
      {
        pathname: "/settings",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/projects/x",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/zerops",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/usage",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
      {
        pathname: "/connect/cli",
        environmentCounts: [0],
        expected: {
          session: "none",
          shell: "bare",
          redirect: "/pair",
          surface: "app",
          manualLink: null,
        },
      },
    ],
  },
] satisfies ReadonlyArray<GateExpectations>;

const DOOR_MATRIX = GATE_EXPECTATIONS.flatMap(({ label, gate, rows }) =>
  rows.flatMap(({ pathname, environmentCounts, expected }) =>
    environmentCounts.map((environmentCount) => ({
      label,
      gate,
      pathname,
      environmentCount,
      expected,
    })),
  ),
);

const NORMALIZED_PATH_ROWS = [
  {
    label: "authenticated trailing-slash pair",
    gate: { status: "authenticated" },
    pathname: "/pair/",
    expected: {
      session: "authenticated",
      shell: "bare",
      redirect: "/",
      surface: "app",
      manualLink: null,
    },
  },
  {
    label: "authenticated title-case pair",
    gate: { status: "authenticated" },
    pathname: "/Pair",
    expected: {
      session: "authenticated",
      shell: "bare",
      redirect: "/",
      surface: "app",
      manualLink: null,
    },
  },
  {
    label: "authenticated upper-case pair with trailing slash",
    gate: { status: "authenticated" },
    pathname: "/PAIR/",
    expected: {
      session: "authenticated",
      shell: "bare",
      redirect: "/",
      surface: "app",
      manualLink: null,
    },
  },
  {
    label: "hosted-pairing trailing-slash pair",
    gate: { status: "hosted-pairing" },
    pathname: "/pair/",
    expected: {
      session: "none",
      shell: "bare",
      redirect: null,
      surface: "hosted-pairing",
      manualLink: null,
    },
  },
  {
    label: "requires-auth upper-case pair",
    gate: { status: "requires-auth", auth: authDescriptor(["one-time-token"]) },
    pathname: "/PAIR/",
    expected: {
      session: "none",
      shell: "bare",
      redirect: null,
      surface: "manual-link",
      manualLink: { methods: ["one-time-token"] },
    },
  },
  {
    label: "hosted-static trailing-slash connect",
    gate: { status: "hosted-static" },
    pathname: "/connect/",
    expected: {
      session: "none",
      shell: "app",
      redirect: null,
      surface: "app",
      manualLink: null,
    },
  },
  {
    label: "requires-auth trailing-slash connect",
    gate: { status: "requires-auth", auth: authDescriptor(["one-time-token"]) },
    pathname: "/connect/",
    expected: {
      session: "none",
      shell: "bare",
      redirect: "/pair",
      surface: "app",
      manualLink: null,
    },
  },
  {
    label: "requires-auth chat path shaped like connect",
    gate: { status: "requires-auth", auth: authDescriptor(["one-time-token"]) },
    pathname: "/connect/foo",
    expected: {
      session: "none",
      shell: "bare",
      redirect: "/pair",
      surface: "app",
      manualLink: null,
    },
  },
] satisfies ReadonlyArray<{
  readonly label: string;
  readonly gate: AuthGateState;
  readonly pathname: string;
  readonly expected: DoorDecision;
}>;

const PROPERTY_GATES = [
  { label: "hosted-pairing", gate: { status: "hosted-pairing" } },
  { label: "hosted-static", gate: { status: "hosted-static" } },
  { label: "authenticated", gate: { status: "authenticated" } },
  {
    label: "requires-auth",
    gate: {
      status: "requires-auth",
      auth: authDescriptor(["one-time-token"]),
    },
  },
] satisfies ReadonlyArray<{ readonly label: string; readonly gate: AuthGateState }>;

const STABILITY_PATHNAMES = [
  "/",
  "/pair",
  "/pair/",
  "/Pair",
  "/PAIR/",
  "/settings",
  "/projects/x",
  "/zerops",
  "/usage",
  "/connect",
  "/connect/",
  "/connect/cli",
  "/connect/foo",
] as const;

const REDIRECT_PROPERTIES = PROPERTY_GATES.flatMap(({ label, gate }) =>
  STABILITY_PATHNAMES.map((pathname) => ({ label, gate, pathname })),
);

async function navigateToAuthenticatedPair(pathname: string) {
  const renderPairView = vi.fn();
  let redirectTo: string | null = null;
  const beforeLoad = PairRoute.options.beforeLoad;

  if (!beforeLoad) {
    throw new Error("The pair route has no beforeLoad decision.");
  }

  try {
    await (
      beforeLoad as (input: {
        readonly context: { readonly authGateState: AuthGateState };
        readonly location: { readonly pathname: string };
      }) => unknown
    )({
      context: { authGateState: { status: "authenticated" } },
      location: { pathname },
    });
    renderPairView();
  } catch (error) {
    if (!isRedirect(error)) {
      throw error;
    }
    redirectTo = error.options.to ?? null;
  }

  return {
    redirectTo,
    viewRendered: renderPairView.mock.calls.length > 0,
  };
}

describe("resolveDoor", () => {
  it.each(DOOR_MATRIX)(
    "$label at $pathname with $environmentCount connected projects",
    ({ gate, pathname, environmentCount, expected }) => {
      expect(resolveDoor(gate, { pathname, environmentCount })).toEqual(expected);
    },
  );

  it.each(NORMALIZED_PATH_ROWS)("normalizes $label", ({ gate, pathname, expected }) => {
    expect(resolveDoor(gate, { pathname, environmentCount: 0 })).toEqual(expected);
  });

  it.each(REDIRECT_PROPERTIES)(
    "$label at $pathname has a stable redirect",
    ({ gate, pathname }) => {
      const decision = resolveDoor(gate, { pathname, environmentCount: 0 });

      if (decision.redirect !== null) {
        expect(
          resolveDoor(gate, {
            pathname: decision.redirect,
            environmentCount: 0,
          }).redirect,
        ).toBeNull();
      }
    },
  );

  it.each(["/pair", "/pair/"])(
    "redirects an authenticated %s navigation before rendering the pair view",
    async (pathname) => {
      await expect(navigateToAuthenticatedPair(pathname)).resolves.toEqual({
        redirectTo: "/",
        viewRendered: false,
      });
    },
  );
});

describe("an unpaired server with a usable environment", () => {
  const unpairedGates = GATE_EXPECTATIONS.filter(
    ({ label }) => label.startsWith("requires-auth:") && !label.includes("zerops-identity"),
  );
  const enteredRows = unpairedGates.flatMap(({ label, gate, rows }) =>
    rows
      .filter(({ pathname, expected }) => pathname !== "/pair" && expected.redirect === "/pair")
      .map(({ pathname, expected }) => ({ label, gate, pathname, expected })),
  );

  it("has rows to prove", () => {
    expect(enteredRows.length).toBeGreaterThan(0);
  });

  // Signed into Zerops on an unpaired origin, the person connected to their
  // environments; "Open" must lead into the shell, not back to the list.
  it.each(enteredRows)(
    "$label at $pathname opens the shell on the environment",
    ({ gate, pathname, expected }) => {
      const decision = resolveDoor(gate, { pathname, environmentCount: 1 });
      expect(decision.shell).toBe("app");
      expect(decision.redirect).toBeNull();
      expect(decision.session).toBe("none");
      expect(decision.surface).toBe(expected.surface);
    },
  );

  it.each(unpairedGates)("$label still offers pairing the primary at /pair", ({ gate }) => {
    const decision = resolveDoor(gate, { pathname: "/pair", environmentCount: 1 });
    expect(decision.shell).toBe("bare");
    expect(decision.redirect).toBeNull();
  });
});

describe("countDoorEnvironments", () => {
  it.each([
    {
      label: "only a settled-error environment",
      phases: ["error"],
      expected: 0,
    },
    {
      label: "a reconnecting environment",
      phases: ["reconnecting"],
      expected: 1,
    },
    {
      label: "one settled-error and one connected environment",
      phases: ["error", "connected"],
      expected: 1,
    },
  ] as const)("counts $label as $expected for the door matrix", ({ phases, expected }) => {
    expect(countDoorEnvironments(phases.map((phase) => ({ connection: { phase } })))).toBe(
      expected,
    );
  });
});

describe("the Zerops hand-over callback is reachable from every gate", () => {
  // This route runs *before* there is anything to authenticate with: the user
  // arrives from app.zerops.io carrying the credential in the fragment. Every
  // other unauthenticated path is sent to /pair, which would drop the
  // credential on the floor and strand the sign-in, so the callback is a
  // deliberate carve-out — the one route whose job is to run at the door.
  const CALLBACK_PATHS = ["/zerops/authorized", "/zerops/authorized/", "/Zerops/Authorized"];

  it.each(
    GATE_EXPECTATIONS.flatMap(({ label, gate }) =>
      CALLBACK_PATHS.flatMap((pathname) =>
        BOTH_COUNTS.map((environmentCount) => ({ label, gate, pathname, environmentCount })),
      ),
    ),
  )(
    "$label at $pathname with $environmentCount connected projects renders the callback",
    ({ gate, pathname, environmentCount }) => {
      const decision = resolveDoor(gate, { pathname, environmentCount });

      expect(decision.surface).toBe("zerops-handover");
      // Never a redirect: the fragment does not survive one, and the user
      // would land on a sign-in form holding a credential nobody read.
      expect(decision.redirect).toBeNull();
      expect(decision.shell).toBe("bare");
      expect(decision.manualLink).toBeNull();
    },
  );

  it("does not swallow the rest of the /zerops surface", () => {
    const gate = { status: "authenticated" } as const satisfies AuthGateState;
    for (const pathname of ["/zerops", "/zerops/authorized-elsewhere", "/zerops/projects"]) {
      expect(resolveDoor(gate, { pathname, environmentCount: 1 }).surface).not.toBe(
        "zerops-handover",
      );
    }
  });
});

describe("awaitDoorEnvironmentCount", () => {
  type CatalogResult = AsyncResult.AsyncResult<{ readonly isReady: boolean }, string>;
  type DoorEnvironments = ReadonlyMap<
    EnvironmentId,
    { readonly connection: { readonly phase: EnvironmentConnectionPhase } }
  >;

  function environments(phases: ReadonlyArray<EnvironmentConnectionPhase>): DoorEnvironments {
    return new Map(
      phases.map((phase, index) => [`env-${index}` as EnvironmentId, { connection: { phase } }]),
    );
  }

  function makeDoor(input: {
    readonly catalog: CatalogResult;
    readonly phases: ReadonlyArray<EnvironmentConnectionPhase>;
  }) {
    const registry = AtomRegistry.make();
    const catalogAtom = Atom.make<CatalogResult>(input.catalog);
    const presentationsAtom = Atom.make<DoorEnvironments>(environments(input.phases));
    let released = 0;
    const door: DoorRegistry = {
      get: (atom) => registry.get(atom),
      subscribe: (atom, listener, options) => {
        const release = registry.subscribe(atom, listener, options);
        return () => {
          released += 1;
          release();
        };
      },
    };
    return { registry, catalogAtom, presentationsAtom, door, released: () => released };
  }

  const settledCases: ReadonlyArray<{
    readonly label: string;
    readonly catalog: CatalogResult;
    readonly phases: ReadonlyArray<EnvironmentConnectionPhase>;
    readonly expected: number;
  }> = [
    {
      label: "a loaded catalog counts every environment that has not settled into failure",
      catalog: AsyncResult.success({ isReady: true }),
      phases: ["available", "connecting", "error"],
      expected: 2,
    },
    {
      label: "a loaded empty catalog counts none",
      catalog: AsyncResult.success({ isReady: true }),
      phases: [],
      expected: 0,
    },
    {
      label: "a catalog that failed to load holds nothing usable",
      catalog: AsyncResult.fail("storage unavailable"),
      phases: ["available"],
      expected: 0,
    },
  ];

  it.each(settledCases)("$label", async ({ catalog, phases, expected }) => {
    const door = makeDoor({ catalog, phases });
    await expect(awaitDoorEnvironmentCount(door.door, door)).resolves.toBe(expected);
    expect(door.released()).toBe(1);
  });

  it("waits for the catalog to load before counting", async () => {
    const door = makeDoor({ catalog: AsyncResult.success({ isReady: false }), phases: [] });
    let settled: number | null = null;
    const pending = awaitDoorEnvironmentCount(door.door, door).then((count) => {
      settled = count;
      return count;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBeNull();
    expect(door.released()).toBe(0);

    door.registry.set(door.presentationsAtom, environments(["connecting"]));
    door.registry.set(door.catalogAtom, AsyncResult.success({ isReady: true }));
    await expect(pending).resolves.toBe(1);
    expect(door.released()).toBe(1);
  });
});
