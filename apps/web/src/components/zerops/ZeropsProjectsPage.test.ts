import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  autoConnectServedZeropsEnvironment,
  retryZeropsProjectConnection,
  ZeropsProjectsHeader,
} from "./ZeropsProjectsPage";
import { exchangeZeropsContainerIdentity } from "~/zerops/useZeropsIdentityExchange";

const APP_ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";
const ZEROPS_DOOR_GATE = {
  status: "requires-auth",
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["zerops-identity", "one-time-token"],
    sessionMethods: ["bearer-access-token", "dpop-access-token"],
    sessionCookieName: "t3_session",
  },
} as const;
const SAME_ORIGIN_CANDIDATE = {
  group: "ready" as const,
  containerOrigin: APP_ORIGIN,
};

describe("same-origin Zerops identity bootstrap", () => {
  it("retries the failed ready-container identity exchange instead of restarting provisioning", () => {
    const retryIdentity = vi.fn();
    const retryProvisioning = vi.fn();

    retryZeropsProjectConnection({
      connectError: "Could not connect to this container.",
      readyOrigin: APP_ORIGIN,
      retryIdentity,
      retryProvisioning,
    });

    expect(retryIdentity).toHaveBeenCalledTimes(1);
    expect(retryIdentity).toHaveBeenCalledWith(APP_ORIGIN);
    expect(retryProvisioning).not.toHaveBeenCalled();
  });

  it.each([
    { connectError: null, readyOrigin: APP_ORIGIN },
    { connectError: "Project lookup failed.", readyOrigin: null },
  ])("keeps non-identity failures on the provisioning retry path", (input) => {
    const retryIdentity = vi.fn();
    const retryProvisioning = vi.fn();

    retryZeropsProjectConnection({ ...input, retryIdentity, retryProvisioning });

    expect(retryProvisioning).toHaveBeenCalledTimes(1);
    expect(retryIdentity).not.toHaveBeenCalled();
  });

  it("exposes a compact account header and preserves selection behavior", () => {
    const markup = renderToStaticMarkup(
      createElement(ZeropsProjectsHeader, { onCreate: () => {} }),
    );
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      connect,
    };

    autoConnectServedZeropsEnvironment(input);
    autoConnectServedZeropsEnvironment(input);

    expect(markup).toContain('data-zerops-project-scope="true"');
    expect(markup).toContain("<h1");
    expect(markup).toContain(">Projects<");
    expect(markup).not.toContain("Environments");
    // The bar above carries the brand; the title row does not repeat it, and
    // no sentence sits under the title — the projects below say what it is.
    expect(markup).not.toContain("micro-label");
    expect(markup).not.toContain(">Zerops<");
    expect(markup).not.toContain("<p");
    // The creating action sits in the title row, not under the list.
    expect(markup).toContain("New project");
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("fires exactly once for the unauthenticated container that served the app", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      connect,
    };

    autoConnectServedZeropsEnvironment(input);
    autoConnectServedZeropsEnvironment(input);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(APP_ORIGIN);
  });

  it.each([
    {
      name: "the served container already has a session",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [{ ...SAME_ORIGIN_CANDIDATE, group: "connected" as const }],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the served container is already establishing its session",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "connecting" as const },
        },
      ],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the candidate belongs to another origin",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [
        { group: "ready" as const, containerOrigin: "https://another-container.example" },
      ],
      zeropsToken: "zerops-account-token",
    },
    {
      name: "the Zerops account token is absent",
      authGate: ZEROPS_DOOR_GATE,
      candidates: [SAME_ORIGIN_CANDIDATE],
      zeropsToken: null,
    },
    {
      name: "the server does not offer the Zerops identity door",
      authGate: {
        ...ZEROPS_DOOR_GATE,
        auth: { ...ZEROPS_DOOR_GATE.auth, bootstrapMethods: ["one-time-token"] as const },
      },
      candidates: [SAME_ORIGIN_CANDIDATE],
      zeropsToken: "zerops-account-token",
    },
  ])("does not fire when $name", ({ authGate, candidates, zeropsToken }) => {
    const connect = vi.fn();

    autoConnectServedZeropsEnvironment({
      attempted: { current: false },
      status: "signed-in",
      zeropsToken,
      appOrigin: APP_ORIGIN,
      authGate,
      candidates,
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
  });

  it("waits for the candidate catalog without spending its one attempt", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      connect,
    };

    autoConnectServedZeropsEnvironment({ ...input, candidates: [] });
    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [SAME_ORIGIN_CANDIDATE],
    });

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("leaves a registered environment's settled failure to the shell repair", () => {
    const attempted = { current: false };
    const connect = vi.fn();
    const input = {
      attempted,
      status: "signed-in" as const,
      zeropsToken: "zerops-account-token",
      appOrigin: APP_ORIGIN,
      authGate: ZEROPS_DOOR_GATE,
      connect,
    };

    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "connecting" },
        },
      ],
    });
    autoConnectServedZeropsEnvironment({
      ...input,
      candidates: [
        {
          ...SAME_ORIGIN_CANDIDATE,
          connection: { phase: "error" },
        },
      ],
    });

    expect(connect).not.toHaveBeenCalled();
    expect(attempted.current).toBe(false);
  });

  it("surfaces the identity exchange failure reason", async () => {
    const connect = vi
      .fn()
      .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Session token expired."))));

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      zeropsToken: "zerops-account-token",
      connect,
    });

    expect(connect).toHaveBeenCalledWith({
      httpBaseUrl: `${APP_ORIGIN}/mate`,
      zeropsToken: "zerops-account-token",
    });
    expect(result).toEqual({
      _tag: "Failure",
      error: "Could not connect to this container. Session token expired.",
    });
  });

  it("does not attempt an exchange without the Zerops account token", async () => {
    const connect = vi.fn();

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      zeropsToken: null,
      connect,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(result).toEqual({
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
    });
  });

  it("returns the authenticated environment", async () => {
    const environmentId = EnvironmentId.make("environment-1");
    const connect = vi.fn().mockResolvedValue(AsyncResult.success(environmentId));

    const result = await exchangeZeropsContainerIdentity({
      containerOrigin: APP_ORIGIN,
      appOrigin: APP_ORIGIN,
      basePath: "/mate/",
      zeropsToken: "zerops-account-token",
      connect,
    });

    expect(result).toEqual({ _tag: "Success", environmentId });
  });
});
