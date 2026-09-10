import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  environmentSummaryLine,
  mateSetupOffered,
  zeropsReasonSentence,
  type ZeropsRowCandidate,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic";

const ALL = {
  open: true,
  connect: true,
  enable: true,
  wait: true,
  setUpMate: true,
  start: true,
  restart: true,
} as const;
const NONE = {
  open: false,
  connect: false,
  enable: false,
  wait: false,
  setUpMate: false,
  start: false,
  restart: false,
} as const;

const READY: ZeropsRowCandidate = {
  key: "p:zcp",
  project: { id: "p", name: "crm-dev", status: "ACTIVE", tagList: [] },
  group: "ready",
  service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-1-8080.prg1.zerops.app",
};

function input(
  candidate: ZeropsRowCandidate,
  health: ZeropsContainerHealth | undefined,
  can: ZeropsRowInput["can"] = ALL,
): ZeropsRowInput {
  return { candidate, health, can };
}

describe("deriveZeropsRowAction", () => {
  it("offers Connect only once the container has answered ready", () => {
    expect(deriveZeropsRowAction(input(READY, undefined))).toEqual({ kind: "pending" });
    expect(deriveZeropsRowAction(input(READY, "ready"))).toEqual({
      kind: "connect",
      label: "Connect",
    });
  });

  it.each(["predates-mate", "unreachable", "stalled"] as const)(
    "offers Enable Zerops Mate when the container answered %s",
    (health) => {
      expect(deriveZeropsRowAction(input(READY, health))).toEqual({
        kind: "enable",
        label: "Enable Zerops Mate",
      });
    },
  );

  it("says Starting with no verb while Zerops Mate initializes", () => {
    expect(deriveZeropsRowAction(input(READY, "initializing"))).toEqual({
      kind: "starting",
      label: "Starting…",
    });
  });

  it("waits while a registered socket is in flight, unless a restart would help", () => {
    const connecting: ZeropsRowCandidate = {
      ...READY,
      connection: { phase: "reconnecting", error: "boom", traceId: null },
    };
    expect(deriveZeropsRowAction(input(connecting, "ready"))).toEqual({ kind: "pending" });
    expect(deriveZeropsRowAction(input(connecting, "predates-mate"))).toEqual({
      kind: "enable",
      label: "Enable Zerops Mate",
    });
  });

  it("opens a connected environment", () => {
    const connected: ZeropsRowCandidate = { ...READY, group: "connected" };
    expect(deriveZeropsRowAction(input(connected, "ready"))).toEqual({
      kind: "open",
      label: "Open",
    });
  });

  it("waits for a project that is still being created", () => {
    const fresh: ZeropsRowCandidate = {
      key: "f",
      project: { id: "f", name: "fresh", status: "CREATING" },
      group: "provisioning",
      reason: "project is being created",
    };
    expect(deriveZeropsRowAction(input(fresh, undefined))).toEqual({
      kind: "wait",
      label: "Wait for it",
    });
  });

  describe("Set up Mate", () => {
    const bare: ZeropsRowCandidate = {
      key: "bare",
      project: { id: "bare", name: "bare", status: "ACTIVE", tagList: [] },
      group: "unavailable",
      reason: "no Zerops Mate container in this project",
      missingContainer: true,
    };

    it("is offered on a project that merely has no container", () => {
      expect(deriveZeropsRowAction(input(bare, undefined))).toEqual({
        kind: "set-up-mate",
        label: "Set up Mate",
      });
    });

    it("is never offered to a tool, which has no container by design", () => {
      const gitea = { ...bare, project: { ...bare.project, tagList: ["mate:tool:gitea"] } };
      expect(deriveZeropsRowAction(input(gitea, undefined))).toEqual({ kind: "none" });
    });

    it("is never offered for any other unavailable reason", () => {
      const { missingContainer: _flag, ...unread } = bare;
      expect(
        deriveZeropsRowAction(
          input({ ...unread, reason: "this project's services could not be read" }, undefined),
        ),
      ).toEqual({ kind: "none" });
    });

    it.each(["dev", "devstage", undefined] as const)(
      "is offered where a Mate belongs — a %s environment",
      (role) => {
        expect(
          deriveZeropsRowAction({ candidate: bare, health: undefined, can: ALL, role }),
        ).toEqual({ kind: "set-up-mate", label: "Set up Mate" });
      },
    );

    it.each(["stage", "prod"] as const)(
      "is not offered to a %s environment, which gets its code from dev",
      (role) => {
        expect(
          deriveZeropsRowAction({ candidate: bare, health: undefined, can: ALL, role }),
        ).toEqual({ kind: "none" });
        expect(mateSetupOffered(role)).toBe(false);
      },
    );
  });

  describe("Start", () => {
    it("is offered for a STOPPED project", () => {
      const stoppedProject: ZeropsRowCandidate = {
        key: "sp",
        project: { id: "sp", name: "sp", status: "STOPPED", tagList: [] },
        group: "unavailable",
        reason: "project is STOPPED",
      };
      expect(deriveZeropsRowAction(input(stoppedProject, undefined))).toEqual({
        kind: "start",
        label: "Start",
      });
    });

    it("is offered for an ACTIVE project whose zcp service is STOPPED", () => {
      const stoppedService: ZeropsRowCandidate = {
        key: "ss",
        project: { id: "ss", name: "ss", status: "ACTIVE", tagList: [] },
        group: "unavailable",
        reason: "container is STOPPED",
        service: { id: "zcp", name: "zcp", status: "STOPPED" },
      };
      expect(deriveZeropsRowAction(input(stoppedService, undefined))).toEqual({
        kind: "start",
        label: "Start",
      });
    });

    it("is not offered when the caller cannot start", () => {
      const stoppedProject: ZeropsRowCandidate = {
        key: "sp",
        project: { id: "sp", name: "sp", status: "STOPPED", tagList: [] },
        group: "unavailable",
        reason: "project is STOPPED",
      };
      expect(deriveZeropsRowAction(input(stoppedProject, undefined, NONE))).toEqual({
        kind: "none",
      });
    });

    it.each(["STARTING", "STOPPING"] as const)("is not offered while a project is %s", (status) => {
      const transitional: ZeropsRowCandidate = {
        key: "t",
        project: { id: "t", name: "t", status, tagList: [] },
        group: "unavailable",
        reason: `project is ${status}`,
      };
      expect(deriveZeropsRowAction(input(transitional, undefined))).toEqual({ kind: "none" });
    });
  });

  it("never offers a verb the caller cannot perform", () => {
    expect(deriveZeropsRowAction(input(READY, "ready", NONE))).toEqual({ kind: "none" });
    expect(deriveZeropsRowAction(input({ ...READY, group: "connected" }, "ready", NONE))).toEqual({
      kind: "none",
    });
  });
});

describe("deriveZeropsRowPresentation", () => {
  it("phrases each health answer for a ready container", () => {
    expect(deriveZeropsRowPresentation(input(READY, undefined)).status.label).toBe("Checking");
    expect(deriveZeropsRowPresentation(input(READY, "ready")).status.label).toBe("Ready");
    expect(deriveZeropsRowPresentation(input(READY, "initializing")).status.label).toBe("Starting");
    expect(deriveZeropsRowPresentation(input(READY, "predates-mate")).status.label).toBe(
      "Needs Zerops Mate",
    );
    expect(deriveZeropsRowPresentation(input(READY, "unreachable")).status.label).toBe(
      "Not answering",
    );
    expect(deriveZeropsRowPresentation(input(READY, "stalled")).status.label).toBe("Not answering");
  });

  it("says what an initializing row is waiting for, generically with no known process", () => {
    const presentation = deriveZeropsRowPresentation(input(READY, "initializing"));
    expect(presentation.status).toEqual({ label: "Starting", pulse: true, tone: "busy" });
    expect(presentation.detail).toBe("Zerops Mate is starting.");
  });

  it.each([
    ["restart-service", "Restarting the container"],
    ["start-service", "Starting the container"],
    ["start-project", "Starting the project"],
  ] as const)("names the running process %s in an initializing row's detail", (kind, detail) => {
    const presentation = deriveZeropsRowPresentation({
      candidate: READY,
      health: "initializing",
      can: ALL,
      runningProcessKind: kind,
    });
    expect(presentation.detail).toBe(detail);
  });

  it("says the container did not answer, once stalled", () => {
    const presentation = deriveZeropsRowPresentation(input(READY, "stalled"));
    expect(presentation.status).toEqual({ label: "Not answering", tone: "attention" });
    expect(presentation.detail).toBe("The container is up but Zerops Mate did not answer.");
  });

  it("lets a socket failure override the probe, and keeps its reason", () => {
    const failed: ZeropsRowCandidate = {
      ...READY,
      connection: { phase: "error", error: "Session token expired.", traceId: null },
    };
    const presentation = deriveZeropsRowPresentation(input(failed, "ready"));
    expect(presentation.status).toEqual({ label: "Connection failed", tone: "failed" });
    expect(presentation.detail).toContain("Session token expired.");
    expect(presentation.detailIsError).toBe(true);
  });

  it("says Reconnecting, with the reason, while a retry is under way", () => {
    const retrying: ZeropsRowCandidate = {
      ...READY,
      connection: { phase: "reconnecting", error: "The container is unreachable.", traceId: null },
    };
    const presentation = deriveZeropsRowPresentation(input(retrying, "ready"));
    expect(presentation.status.label).toBe("Reconnecting");
    expect(presentation.detail).toContain("The container is unreachable.");
  });

  it("calls a project without a container agentless, not unavailable", () => {
    const presentation = deriveZeropsRowPresentation(
      input(
        {
          key: "bare",
          project: { id: "bare", name: "bare", status: "ACTIVE", tagList: [] },
          group: "unavailable",
          reason: "no Zerops Mate container in this project",
          missingContainer: true,
        },
        undefined,
      ),
    );
    expect(presentation.status).toEqual({ label: "No container", tone: "off" });
    expect(presentation.detail).toBe("This Mate has no container yet.");
  });

  it("says Stopped, settled, for a STOPPED project, with Stopped as its detail line too", () => {
    const presentation = deriveZeropsRowPresentation(
      input(
        {
          key: "sp",
          project: { id: "sp", name: "sp", status: "STOPPED", tagList: [] },
          group: "unavailable",
          reason: "project is STOPPED",
        },
        undefined,
      ),
    );
    expect(presentation.status).toEqual({ label: "Stopped", tone: "off" });
    expect(presentation.detail).toBe("Stopped");
  });

  it("says Stopped for an ACTIVE project whose zcp service is STOPPED, with Stopped as its detail line too", () => {
    const presentation = deriveZeropsRowPresentation(
      input(
        {
          key: "ss",
          project: { id: "ss", name: "ss", status: "ACTIVE", tagList: [] },
          group: "unavailable",
          reason: "container is STOPPED",
          service: { id: "zcp", name: "zcp", status: "STOPPED" },
        },
        undefined,
      ),
    );
    expect(presentation.status).toEqual({ label: "Stopped", tone: "off" });
    expect(presentation.detail).toBe("Stopped");
  });

  it.each(["STARTING", "STOPPING"] as const)(
    "shows a pulsing %s with no verb for a transitional project status",
    (status) => {
      const presentation = deriveZeropsRowPresentation(
        input(
          {
            key: "t",
            project: { id: "t", name: "t", status, tagList: [] },
            group: "unavailable",
            reason: `project is ${status}`,
          },
          undefined,
        ),
      );
      const label = status === "STOPPING" ? "Stopping" : "Starting";
      expect(presentation.status).toEqual({ label, pulse: true, tone: "busy" });
    },
  );

  it("carries the bucket's own reason for a project on its way in or out of reach", () => {
    expect(
      deriveZeropsRowPresentation(
        input(
          {
            key: "f",
            project: { id: "f", name: "fresh", status: "CREATING" },
            group: "provisioning",
            reason: "project is being created",
          },
          undefined,
        ),
      ),
    ).toEqual({
      status: { label: "Preparing", pulse: true, tone: "busy" },
      // The bucket's reason, phrased as a sentence for the row.
      detail: "Project is being created.",
    });
  });
});

describe("zeropsReasonSentence", () => {
  it.each([
    ["container is STOPPED", "The container is stopped."],
    ["container is starting (ACTIVE)", "The container is starting."],
    ["container is READY_TO_DEPLOY", "The container is ready to deploy."],
    ["public access is off for this container", "Public access is off for this container."],
    ["this container does not expose port 8080", "This container does not expose port 8080."],
    ["this project has no public subdomain", "This project has no public subdomain."],
    ["no Zerops Mate container in this project", "No Zerops Mate container in this project."],
    ["Already a sentence.", "Already a sentence."],
  ])("phrases %j as %j", (reason, sentence) => {
    expect(zeropsReasonSentence(reason)).toBe(sentence);
  });

  it.each([
    { phase: "available" as const, label: "Connecting" },
    { phase: "connecting" as const, label: "Connecting" },
    { phase: "reconnecting" as const, label: "Reconnecting" },
  ])(
    "a $phase socket is said in the status cell only, never in a second line",
    ({ phase, label }) => {
      const presentation = deriveZeropsRowPresentation({
        candidate: {
          ...READY,
          connection: { phase, error: null, traceId: null },
        },
        health: undefined,
        can: ALL,
      });
      expect(presentation.status.label).toBe(label);
      expect(presentation.status.pulse).toBe(true);
      expect(presentation.detail).toBeUndefined();
    },
  );

  it("is what an unavailable row's detail says", () => {
    const stopped: ZeropsRowCandidate = {
      key: "p:zcp",
      project: { id: "p", name: "gtm", status: "ACTIVE", tagList: [] },
      group: "unavailable",
      reason: "container is STOPPED",
    };
    expect(deriveZeropsRowPresentation(input(stopped, undefined)).detail).toBe(
      "The container is stopped.",
    );
  });
});

describe("environmentSummaryLine", () => {
  const age = (iso: string) => (iso === "2026-09-05T15:17:24Z" ? "2h ago" : "?");

  it.each([
    [
      "names the services and dates the deploy",
      { hostnames: ["app", "db"], deployedAt: "2026-09-05T15:17:24Z" },
      "app, db · deployed 2h ago",
    ],
    [
      "names services nothing has been deployed to",
      { hostnames: ["db"], deployedAt: undefined },
      "db",
    ],
    [
      "says when a project holds only the platform's services",
      { hostnames: [], deployedAt: undefined },
      "No services yet",
    ],
  ] as const)("%s", (_, services, expected) => {
    expect(environmentSummaryLine(services, age)).toBe(expected);
  });

  it("says nothing while the services are unread", () => {
    expect(environmentSummaryLine(undefined, age)).toBeUndefined();
  });
});

describe("deriveZeropsRestartAction", () => {
  const withService = (
    candidate: ZeropsRowCandidate,
    status: string,
    service: boolean,
  ): ZeropsRowCandidate => {
    const { service: known, ...rest } = candidate;
    return {
      ...rest,
      project: { ...rest.project, status },
      ...(service ? { service: known } : {}),
    };
  };
  it.each([
    ["an ACTIVE project with a known container", "ACTIVE", true, ALL, "restart"],
    ["a STOPPED project", "STOPPED", true, ALL, "none"],
    ["a project without a container", "ACTIVE", false, ALL, "none"],
    ["a caller that may not restart", "ACTIVE", true, NONE, "none"],
  ] as const)("%s → %s", (_name, status, service, can, kind) => {
    const action = deriveZeropsRestartAction({
      candidate: withService(READY, status, service),
      health: "ready",
      can,
    });
    expect(action.kind).toBe(kind);
  });
});
