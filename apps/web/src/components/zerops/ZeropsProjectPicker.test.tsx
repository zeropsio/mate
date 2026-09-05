import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";

import { ZeropsProjectPicker } from "./ZeropsProjectPicker";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

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

type ActionProps = {
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onClick?: () => void;
};

function findAction(node: ReactNode, label: string): ReactElement<ActionProps> {
  if (isValidElement<ActionProps>(node)) {
    if (node.props.label === label && node.props.onClick !== undefined) return node;
    if (typeof node.type === "function" && node.type !== Button && node.type !== Spinner) {
      const renderComponent = node.type as (props: ActionProps) => ReactNode;
      const rendered = renderComponent(node.props);
      try {
        return findAction(rendered, label);
      } catch {
        // Continue into the element's declared children below.
      }
    }
    for (const child of Children.toArray(node.props.children)) {
      try {
        return findAction(child, label);
      } catch {
        // Keep searching sibling nodes.
      }
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findAction(child, label);
      } catch {
        // Keep searching sibling nodes.
      }
    }
  }
  throw new Error(`Action not found: ${label}`);
}

describe("ZeropsProjectPicker rows", () => {
  it("renders candidates as grouped semantic cards with one primary action", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[
          { ...CANDIDATE, group: "connected" },
          CANDIDATE,
          {
            key: "project-2",
            project: { id: "project-2", name: "fresh", status: "CREATING" },
            group: "provisioning",
            reason: "project is being created",
          },
          {
            key: "project-3",
            project: { id: "project-3", name: "stopped", status: "STOPPED" },
            group: "unavailable",
            reason: "project status is STOPPED",
          },
        ]}
        isLoading={false}
        error={null}
        health={new Map([[CANDIDATE.key, "ready"]])}
        onRefresh={noop}
        onConnect={noop}
        onOpen={noop}
        onWait={noop}
      />,
    );

    expect(markup).toContain('aria-labelledby="zerops-project-group-connected"');
    expect(markup).toContain('aria-labelledby="zerops-project-group-ready-to-connect"');
    expect(markup).toContain("grid grid-cols-1 gap-3 md:grid-cols-2");
    expect(markup.match(/data-zerops-project-card="true"/g)).toHaveLength(4);
    expect(markup).toContain('data-zerops-primitive="flat-card"');
    expect(markup).toContain('data-zerops-primitive="status-dot"');
    expect(markup.match(/data-zerops-primary-action=/g)).toHaveLength(3);
  });

  it("invokes the correct candidate callback exactly once after user action and stays disabled while busy", () => {
    const cases = [
      {
        label: "Connect",
        candidate: CANDIDATE,
        health: "ready" as const,
        callbackProp: "onConnect" as const,
      },
      {
        label: "Open",
        candidate: { ...CANDIDATE, group: "connected" as const },
        health: undefined,
        callbackProp: "onOpen" as const,
      },
      {
        label: "Wait for it",
        candidate: {
          ...CANDIDATE,
          group: "provisioning" as const,
          reason: "project is being created",
        },
        health: undefined,
        callbackProp: "onWait" as const,
      },
      {
        label: "Enable Zerops Mate",
        candidate: CANDIDATE,
        health: "unreachable" as const,
        callbackProp: "onEnable" as const,
      },
    ];

    for (const testCase of cases) {
      const callback = vi.fn();
      const props = {
        candidates: [testCase.candidate],
        isLoading: false,
        error: null,
        health:
          testCase.health === undefined
            ? new Map<string, ZeropsContainerHealth>()
            : new Map([[testCase.candidate.key, testCase.health]]),
        onRefresh: noop,
        [testCase.callbackProp]: callback,
      };
      const action = findAction(ZeropsProjectPicker(props), testCase.label);

      action.props.onClick?.();

      expect(callback, testCase.label).toHaveBeenCalledTimes(1);

      const busyAction = findAction(
        ZeropsProjectPicker({
          ...props,
          busyCandidateKeys: new Set([testCase.candidate.key]),
        }),
        testCase.label,
      );
      expect(busyAction.props.disabled, testCase.label).toBe(true);
    }
  });

  it("keeps project reverse and error states distinct", () => {
    const predates = render("predates-mate");
    const unreachable = render("unreachable");
    const connectionFailure = renderToStaticMarkup(
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
    const empty = renderToStaticMarkup(
      <ZeropsProjectPicker candidates={[]} isLoading={false} error={null} onRefresh={noop} />,
    );
    const loading = renderToStaticMarkup(
      <ZeropsProjectPicker candidates={[]} isLoading error={null} onRefresh={noop} />,
    );

    expect(predates).toContain("Zerops Mate is not enabled yet.");
    expect(unreachable).toContain("Container is not answering.");
    expect(predates).toContain("Enable Zerops Mate");
    expect(unreachable).toContain("Enable Zerops Mate");
    expect(connectionFailure).toContain("The WebSocket upgrade was rejected.");
    expect(empty).toContain("No projects in this account yet.");
    expect(loading).toContain("Reading your Zerops projects");
    expect(loading).not.toContain("No projects in this account yet.");
  });

  it("offers Connect only once the container has answered", () => {
    expect(render("ready")).toContain("Connect");
    expect(render(undefined)).not.toContain(">Connect<");
  });

  it("offers the restart for a container that predates Zerops Mate", () => {
    expect(render("predates-mate")).toContain("Enable Zerops Mate");
  });

  it("offers the restart for a running container that answers nothing at all", () => {
    // A container from before Zerops Mate sends no CORS headers on any route,
    // so from a browser it is indistinguishable from one that is down — and
    // the platform already told us this one is ACTIVE. Restarting is the only
    // action that helps either way, so it must be offered rather than leaving
    // the row saying "Starting…" forever.
    expect(render("unreachable")).toContain("Enable Zerops Mate");
  });

  it("waits quietly while a container is still coming up", () => {
    const markup = render("initializing");
    expect(markup).toContain("Starting");
    expect(markup).not.toContain("Enable Zerops Mate");
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
      expect(markup).toContain('data-zerops-status-tone="busy"');
      expect(markup).not.toContain(">Connect<");
      expect(markup).not.toContain("Connected");
    },
  );

  it("keeps the reason and restart action while a failed container is retrying", () => {
    const markup = renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[
          {
            ...CANDIDATE,
            connection: {
              phase: "reconnecting",
              error: "The container is unreachable.",
              traceId: null,
            },
          },
        ]}
        isLoading={false}
        error={null}
        health={new Map([[CANDIDATE.key, "unreachable"]])}
        onRefresh={noop}
        onConnect={noop}
        onEnable={noop}
      />,
    );

    expect(markup).toContain("The container is unreachable.");
    expect(markup).toContain("Enable Zerops Mate");
  });

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

describe("Set up Mate", () => {
  const BARE: ZeropsCandidate = {
    key: "bare",
    project: { id: "bare", name: "bare", status: "ACTIVE", tagList: [] },
    group: "unavailable",
    reason: "no Zerops Mate container in this project",
    missingContainer: true,
  };

  function renderWith(candidate: ZeropsCandidate, onSetUpMate?: () => void): string {
    return renderToStaticMarkup(
      <ZeropsProjectPicker
        candidates={[candidate]}
        isLoading={false}
        error={null}
        onRefresh={noop}
        {...(onSetUpMate ? { onSetUpMate } : {})}
      />,
    );
  }

  it("offers it on a project that merely has no container", () => {
    expect(renderWith(BARE, noop)).toContain('data-zerops-primary-action="Set up Mate"');
  });

  it("offers nothing without a handler", () => {
    expect(renderWith(BARE)).not.toContain("Set up Mate");
  });

  it("never offers it to a tool project, which has no container by design", () => {
    const gitea = { ...BARE, project: { ...BARE.project, tagList: ["mate:tool:gitea"] } };
    expect(renderWith(gitea, noop)).not.toContain("Set up Mate");
  });

  it("never offers it for any other unavailable reason", () => {
    const unread: ZeropsCandidate = {
      ...BARE,
      reason: "this project's services could not be read",
    };
    delete (unread as { missingContainer?: true }).missingContainer;
    expect(renderWith(unread, noop)).not.toContain("Set up Mate");
  });
});
