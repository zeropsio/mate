import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { describe, expect, it } from "vite-plus/test";

import {
  connectFailureLine,
  creationFailedLine,
  giteaToolLine,
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  environmentSummaryLine,
  mateIsUp,
  mateSetupOffered,
  zeropsReasonSentence,
  type ZeropsRowCandidate,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic";

const ALL = {
  open: true,
  enable: true,
  setUpMate: true,
  start: true,
  restart: true,
  remove: true,
} as const;
const NONE = {
  open: false,
  enable: false,
  setUpMate: false,
  start: false,
  restart: false,
  remove: false,
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

describe("a project the platform failed to create", () => {
  const FAILED_CREATION: ZeropsRowCandidate = {
    key: "p-new",
    project: { id: "p-new", name: "crm-dev", status: "NEW", tagList: ["mate"] },
    group: "unavailable",
    reason: "creation failed",
    creationFailed: { message: "unexpected internal server error" },
  };

  it("reads as not created, in the failed tone, never as coming up", () => {
    expect(deriveZeropsRowPresentation(input(FAILED_CREATION, undefined))).toEqual({
      status: { label: "Not created", tone: "failed" },
      detail: "Could not be created.",
      detailIsError: true,
    });
    // The same project with no verdict yet is still a boot.
    const { creationFailed: _verdict, ...booting } = FAILED_CREATION;
    expect(
      deriveZeropsRowPresentation(input({ ...booting, group: "provisioning" }, undefined)),
    ).toMatchObject({ status: { label: "Preparing" }, detail: "Coming up. A few minutes." });
  });

  it.each([
    ["nothing", undefined, "Could not be created."],
    [
      "the platform's empty internal error",
      "unexpected internal server error",
      "Could not be created.",
    ],
    [
      "a reason worth repeating",
      "project limit reached",
      "Could not be created. Project limit reached.",
    ],
    ["a reason already a sentence", "Name is taken.", "Could not be created. Name is taken."],
  ] as const)("says %s as the line", (_name, message, line) => {
    expect(creationFailedLine(message)).toBe(line);
    expect(
      deriveZeropsRowPresentation(
        input({ ...FAILED_CREATION, creationFailed: { message } }, undefined),
      ).detail,
    ).toBe(line);
  });

  it("offers Remove, and only to someone who may remove", () => {
    expect(deriveZeropsRowAction(input(FAILED_CREATION, undefined))).toEqual({
      kind: "remove",
      label: "Remove",
    });
    expect(deriveZeropsRowAction(input(FAILED_CREATION, undefined, NONE))).toEqual({
      kind: "none",
    });
    expect(
      deriveZeropsRowAction(input(FAILED_CREATION, undefined, { ...NONE, remove: true })),
    ).toEqual({ kind: "remove", label: "Remove" });
  });

  it("outranks a stopped or transitional reading of the same project", () => {
    const stopped = {
      ...FAILED_CREATION,
      project: { ...FAILED_CREATION.project, status: "STOPPED" },
    };
    expect(deriveZeropsRowAction(input(stopped, undefined))).toEqual({
      kind: "remove",
      label: "Remove",
    });
    expect(deriveZeropsRowPresentation(input(stopped, undefined)).status.label).toBe("Not created");
  });
});

describe("deriveZeropsRowAction", () => {
  // Clicking a Mate opens it: the connect is a step on the way, not a verb
  // to learn. A container that has not answered ready offers nothing yet.
  it("opens only once the container has answered ready", () => {
    expect(deriveZeropsRowAction(input(READY, undefined))).toEqual({ kind: "pending" });
    expect(deriveZeropsRowAction(input(READY, "ready"))).toEqual({ kind: "open", label: "Open" });
  });

  it("offers nothing while this client is already waiting on the container", () => {
    expect(deriveZeropsRowAction({ ...input(READY, "ready"), waiting: true })).toEqual({
      kind: "pending",
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

  it("offers no verb while Zerops Mate initializes: the face carries the boot", () => {
    expect(deriveZeropsRowAction(input(READY, "initializing"))).toEqual({ kind: "pending" });
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

  it("offers nothing on a project that is still being created", () => {
    const fresh: ZeropsRowCandidate = {
      key: "f",
      project: { id: "f", name: "fresh", status: "CREATING" },
      group: "provisioning",
      reason: "project is being created",
    };
    expect(deriveZeropsRowAction(input(fresh, undefined))).toEqual({ kind: "none" });
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

  it("says an initializing row is almost there, generically with no known process", () => {
    const presentation = deriveZeropsRowPresentation(input(READY, "initializing"));
    expect(presentation.status).toEqual({ label: "Starting", pulse: true, tone: "busy" });
    expect(presentation.detail).toBe("Almost there.");
  });

  // The line under the name is an expectation, never a status verb: the
  // face is asleep for all three, and the words only say how long.
  it.each([
    ["the probe has not answered", undefined],
    ["the container answered ready", "ready" as const],
    ["Zerops Mate initializes", "initializing" as const],
  ])("says almost there while this client waits on a container and %s", (_case, health) => {
    expect(deriveZeropsRowPresentation({ ...input(READY, health), waiting: true }).detail).toBe(
      "Almost there.",
    );
  });

  it("says nothing under a ready Mate nobody is waiting on", () => {
    expect(deriveZeropsRowPresentation(input(READY, "ready")).detail).toBeUndefined();
    expect(deriveZeropsRowPresentation(input(READY, undefined)).detail).toBeUndefined();
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

  it("sets the expectation for a project on its way in, never the platform's status", () => {
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
      detail: "Coming up. A few minutes.",
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
      { hostnames: ["app", "db"], deployedAt: "2026-09-05T15:17:24Z", deployable: [] },
      "app, db · deployed 2h ago",
    ],
    [
      "names services nothing has been deployed to",
      { hostnames: ["db"], deployedAt: undefined, deployable: [] },
      "db",
    ],
    [
      "says when a project holds only the platform's services",
      { hostnames: [], deployedAt: undefined, deployable: [] },
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

describe("a Mate the person may see and not open (D5)", () => {
  const listed = (candidate: ZeropsRowCandidate, ownerName?: string): ZeropsRowInput => ({
    candidate,
    health: "ready",
    can: ALL,
    visibility: "listed",
    ...(ownerName === undefined ? {} : { ownerName }),
  });

  it("says whose it is in place of the verb", () => {
    expect(deriveZeropsRowPresentation(listed(READY, "Jan"))).toEqual({
      status: { label: "Not yours", tone: "off" },
      detail: "Jan's Mate — only Jan opens it.",
    });
  });

  it("says the same thing without a name when the account has none", () => {
    expect(deriveZeropsRowPresentation(listed(READY)).detail).toBe(
      "Only its owner opens this Mate.",
    );
  });

  // Whose Mate it is outranks whatever its container is doing: "Ready" would
  // be an invitation the door refuses, and "Starting" a wait that never ends.
  it.each([
    ["ready and healthy", READY, "ready" as const],
    ["still starting", READY, "initializing" as const],
    ["not answering", READY, "unreachable" as const],
  ])("outranks a row that is %s", (_name, candidate, health) => {
    expect(deriveZeropsRowPresentation({ ...listed(candidate), health }).status.label).toBe(
      "Not yours",
    );
  });

  it("offers no verb at all, not even a restart", () => {
    expect(deriveZeropsRowAction(listed(READY))).toEqual({ kind: "none" });
    expect(deriveZeropsRestartAction(listed(READY))).toEqual({ kind: "none" });
  });

  it("leaves a Mate the person can open exactly as it was", () => {
    const open: ZeropsRowInput = {
      candidate: READY,
      health: "ready",
      can: ALL,
      visibility: "open",
    };
    expect(deriveZeropsRowPresentation(open)).toEqual({ status: { label: "Ready", tone: "ok" } });
    expect(deriveZeropsRowAction(open)).toEqual({ kind: "open", label: "Open" });
  });
});

describe("mateIsUp", () => {
  // The add verbs wait for the first Mate: a group two minutes old with a
  // dashed tile beside a Mate that has not booted is the cliché.
  it.each([
    ["connected", { ...READY, group: "connected" as const }, undefined, true],
    ["ready and answering", READY, "ready" as const, true],
    ["ready but unprobed", READY, undefined, false],
    ["ready but initializing", READY, "initializing" as const, false],
    ["ready but not answering", READY, "unreachable" as const, false],
    [
      "still provisioning",
      { ...READY, group: "provisioning" as const, reason: "project is being created" },
      undefined,
      false,
    ],
    [
      "stopped",
      { ...READY, group: "unavailable" as const, reason: "container is STOPPED" },
      undefined,
      false,
    ],
  ])("a Mate that is %s: %s", (_case, candidate, health, expected) => {
    expect(mateIsUp({ candidate, health })).toBe(expected);
  });
});

describe("connectFailureLine", () => {
  it.each([
    [
      "a 500 from the Mate's server",
      "Could not connect to this container. The environment could not authorize the connection.",
      "Could not connect. The Mate's server answered an error.",
    ],
    [
      "a refusal",
      "Could not connect to this container. The environment credential does not grant the required access.",
      "Could not connect. The environment credential does not grant the required access.",
    ],
    [
      "a failure before the door",
      "Could not connect to this container. Session token expired.",
      "Could not connect. Session token expired.",
    ],
    [
      "no account",
      "Sign in to Zerops again to connect this container.",
      "Sign in to Zerops again to connect this container.",
    ],
  ])("phrases %s for the Mate's line", (_case, error, line) => {
    expect(connectFailureLine(error)).toBe(line);
  });
});

describe("giteaToolLine", () => {
  const URL = "https://web-abc-3000.prg1.zerops.app";
  it.each([
    [
      "the project is still being created",
      "CREATING",
      undefined,
      undefined,
      { kind: "setting-up" },
    ],
    [
      "its services are unread on an active project",
      "ACTIVE",
      undefined,
      undefined,
      { kind: "none" },
    ],
    ["its web service is provisioning", "ACTIVE", "provisioning", URL, { kind: "setting-up" }],
    [
      "it runs and has an address",
      "ACTIVE",
      "running",
      URL,
      { kind: "link", url: URL, label: "web-abc-3000.prg1.zerops.app" },
    ],
    ["it runs without an address yet", "ACTIVE", "running", undefined, { kind: "none" }],
    [
      "its web service is gone from an active project",
      "ACTIVE",
      "unavailable",
      undefined,
      { kind: "unavailable" },
    ],
    ["the project is stopped", "STOPPED", "unavailable", undefined, { kind: "unavailable" }],
  ] as const)("says the right thing when %s", (_case, projectStatus, phase, url, expected) => {
    expect(giteaToolLine({ projectStatus, phase, url })).toEqual(expected);
  });

  it("never lists the services by hostname", () => {
    expect(
      JSON.stringify(giteaToolLine({ projectStatus: "ACTIVE", phase: "running", url: URL })),
    ).not.toMatch(/broker|db|volume/u);
  });
});
