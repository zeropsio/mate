import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderStatusMessage, providerAvailability } from "./providerAvailability.logic";

function warningProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "warning",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-23T12:00:00.000Z",
    message: "Provider is temporarily degraded.",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const unsupported: ServerProvider = {
  ...warningProvider(),
  instanceId: ProviderInstanceId.make("codex-work"),
  displayName: undefined,
  status: "ready",
  message: undefined,
  compatibilityAdvisory: {
    status: "unsupported",
    message: "Unsupported version. Use 2.0.0.",
    recommendedVersion: "2.0.0",
    recommendedRange: null,
  },
};

describe("the agent's availability on the model control", () => {
  it.each([
    {
      case: "a degraded agent",
      status: warningProvider(),
      tone: "warning",
      title: "Codex has limited availability",
      message: "Provider is temporarily degraded.",
    },
    {
      case: "an agent that fails",
      status: { ...warningProvider(), status: "error" as const, message: "Codex did not start." },
      tone: "error",
      title: "Codex is unavailable",
      message: "Codex did not start.",
    },
    {
      case: "an agent that says no more than that it fails",
      status: { ...warningProvider(), status: "error" as const, message: undefined },
      tone: "error",
      title: "Codex is unavailable",
      message: null,
    },
    {
      case: "an unsupported version on a healthy agent",
      status: unsupported,
      tone: "warning",
      title: "Codex 1.0.0 is unsupported",
      message: "Unsupported version. Use 2.0.0.",
    },
  ])("names $case in the tone its status has, and says why", ({ status, tone, title, message }) => {
    expect(providerAvailability(status)).toEqual({
      instanceId: status.instanceId,
      tone,
      title,
      message,
    });
  });

  it("warns of an unsupported version on a healthy agent until the policy relaxes", () => {
    expect(providerAvailability(unsupported)).not.toBeNull();
    for (const status of ["supported", "graceful"] as const) {
      expect(
        providerAvailability({
          ...unsupported,
          compatibilityAdvisory: { ...unsupported.compatibilityAdvisory!, status, message: null },
        }),
      ).toBeNull();
    }
    expect(providerAvailability({ ...unsupported, status: "disabled" })).toBeNull();
  });

  it("shows downgrade guidance instead of a broken OpenCode inventory timeout", () => {
    const message = "This provider version is known to be incompatible. Use 1.14.19.";
    const broken: ServerProvider = {
      ...unsupported,
      driver: ProviderDriverKind.make("opencode"),
      version: "2.0.3",
      status: "error",
      auth: { status: "unknown" },
      message: "Failed to load OpenCode provider inventory: Timed out waiting for server start.",
      compatibilityAdvisory: {
        status: "broken",
        message,
        recommendedVersion: "1.14.19",
        recommendedRange: ">=1.14.19 <2.0.0",
      },
    };
    expect(providerAvailability(broken)).toMatchObject({
      tone: "error",
      title: expect.stringMatching(/ 2\.0\.3 is known to be broken$/),
      message,
    });
    expect(getProviderStatusMessage(broken)).toBe(message);
    expect(
      getProviderStatusMessage({
        ...broken,
        compatibilityAdvisory: {
          ...broken.compatibilityAdvisory!,
          status: "supported",
          message: null,
        },
      }),
    ).toBe(broken.message);
    expect(getProviderStatusMessage({ ...broken, auth: { status: "unauthenticated" } })).toBe(
      message,
    );
  });
});

describe("getProviderStatusMessage", () => {
  it("preserves the environment's authentication error", () => {
    const message = "SUBSCRIPTION_REQUIRED: This Google account cannot use Antigravity.";
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        status: "error",
        auth: { status: "unauthenticated" },
        message,
      }),
    ).toBe(message);
  });
});
