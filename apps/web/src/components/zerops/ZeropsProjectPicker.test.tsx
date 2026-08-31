import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";

import { ZeropsProjectPicker } from "./ZeropsProjectPicker";

const PROJECT: ZeropsProject = { id: "project-1", name: "kanban", status: "ACTIVE" };

const CANDIDATE: ZeropsCandidate = {
  key: "project-1:service-1",
  project: PROJECT,
  group: "ready",
  service: { id: "service-1", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
};

const noop = () => undefined;

function render(health: ZeropsContainerHealth | undefined): string {
  return renderToStaticMarkup(
    <ZeropsProjectPicker
      candidates={[CANDIDATE]}
      isLoading={false}
      error={null}
      health={health === undefined ? new Map() : new Map([[CANDIDATE.key, health]])}
      onRefresh={noop}
      onConnect={noop}
      onEnable={noop}
    />,
  );
}

describe("ZeropsProjectPicker rows", () => {
  it("offers Connect only once the container has answered", () => {
    expect(render("ready")).toContain("Connect");
    expect(render(undefined)).not.toContain(">Connect<");
  });

  it("offers the restart for a container that predates Zerops Code", () => {
    expect(render("predates-z3")).toContain("Enable Zerops Code");
  });

  it("offers the restart for a running container that answers nothing at all", () => {
    // A container from before Zerops Code sends no CORS headers on any route,
    // so from a browser it is indistinguishable from one that is down — and
    // the platform already told us this one is ACTIVE. Restarting is the only
    // action that helps either way, so it must be offered rather than leaving
    // the row saying "Starting…" forever.
    expect(render("unreachable")).toContain("Enable Zerops Code");
  });

  it("waits quietly while a container is still coming up", () => {
    const markup = render("initializing");
    expect(markup).toContain("Starting");
    expect(markup).not.toContain("Enable Zerops Code");
  });

  it("renders the identity exchange failure reason beside the manual action", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[CANDIDATE]}
        isLoading={false}
        error="Could not connect to this container. Session token expired."
        health={new Map([[CANDIDATE.key, "ready"]])}
        onRefresh={noop}
        onConnect={noop}
      />,
    );

    expect(markup).toContain("Session token expired.");
    expect(markup).toContain(">Connect<");
  });

  it("offers Open for an authenticated container", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[{ ...CANDIDATE, group: "connected" }]}
        isLoading={false}
        error={null}
        onRefresh={noop}
        onOpen={noop}
      />,
    );

    expect(markup).toContain(">Open<");
  });

  it.each(["available", "connecting", "reconnecting"] as const)(
    "shows an environment in %s as connecting without offering an action",
    (phase) => {
      const markup = renderToStaticMarkup(
        <ZeropsProjectPicker
          candidates={[
            {
              ...CANDIDATE,
              connection: { phase, error: null, traceId: null },
            },
          ]}
          isLoading={false}
          error={null}
          health={new Map([[CANDIDATE.key, "ready"]])}
          onRefresh={noop}
          onConnect={noop}
        />,
      );

      expect(markup).toContain("Connecting");
      expect(markup).not.toContain(">Connect<");
      expect(markup).not.toContain("Connected");
    },
  );

  it("shows a settled socket failure reason beside the manual action", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[
          {
            ...CANDIDATE,
            connection: {
              phase: "error",
              error: "The WebSocket upgrade was rejected.",
              traceId: null,
            },
          },
        ]}
        isLoading={false}
        error={null}
        health={new Map([[CANDIDATE.key, "ready"]])}
        onRefresh={noop}
        onConnect={noop}
      />,
    );

    expect(markup).toContain("The WebSocket upgrade was rejected.");
    expect(markup).toContain(">Connect<");
    expect(markup).not.toContain("Connected");
  });
});

describe("ZeropsProjectPicker preparing section", () => {
  const PROVISIONING_CANDIDATE: ZeropsCandidate = {
    key: "project-2",
    project: { id: "project-2", name: "fresh", status: "CREATING" },
    group: "provisioning",
    reason: "project is being created",
  };

  it("offers a way to wait on a project that is still being created", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[PROVISIONING_CANDIDATE]}
        isLoading={false}
        error={null}
        onRefresh={noop}
        onWait={noop}
      />,
    );

    expect(markup).toContain("Preparing");
    expect(markup).toContain("Wait for it");
  });

  it("does not offer the wait action when the caller has none to give", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[PROVISIONING_CANDIDATE]}
        isLoading={false}
        error={null}
        onRefresh={noop}
      />,
    );

    expect(markup).toContain("Preparing");
    expect(markup).not.toContain("Wait for it");
  });
});
