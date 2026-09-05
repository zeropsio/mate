import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveZeropsRowAction,
  deriveZeropsRowPresentation,
  type ZeropsRowCandidate,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic";

const ALL = { open: true, connect: true, enable: true, wait: true, setUpMate: true } as const;
const NONE = { open: false, connect: false, enable: false, wait: false, setUpMate: false } as const;

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

  it.each(["predates-mate", "unreachable"] as const)(
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
    expect(presentation.status).toEqual({ label: "No agent", tone: "off" });
    expect(presentation.detail).toBe("No Zerops Mate container in this project.");
  });

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
      detail: "project is being created",
    });
  });
});
