import { describe, expect, it } from "vite-plus/test";
import { expiredAgentNotice, recoveryNotice } from "./mateRecovery.logic";

it.each(["unknown", "authenticated", "unauthenticated"] as const)(
  "only a proved failed provider login asks for sign-in (%s)",
  (providerAuth) => {
    const words = expiredAgentNotice(
      { credPresent: true, state: "authorized", providerAuth },
      "Wren",
      "Codex",
    );
    expect(words).toBe(
      providerAuth === "unauthenticated"
        ? "Wren's Codex login no longer works. Sign in again to continue."
        : null,
    );
  },
);

describe("Mate recovery evidence", () => {
  it.each([
    {
      kind: "denied" as const,
      text: "You no longer have access to Wren's project",
      tone: "warning",
    },
    { kind: "deleted" as const, text: "Wren's project was deleted", tone: "default" },
  ])("names $kind without guessing its alternative", ({ kind, text, tone }) => {
    expect(
      recoveryNotice(
        { standing: { kind, name: "Wren" }, status: undefined, process: undefined },
        "Wren",
      ),
    ).toMatchObject({ text: expect.stringContaining(text), actions: ["go-to-projects"], tone });
  });
  it("does not call an intentional stop a failed restart", () => {
    expect(
      recoveryNotice(
        { standing: { kind: "unknown" }, status: "STOPPED", process: undefined },
        "Wren",
      ),
    ).toMatchObject({
      text: "Wren's container is stopped. Start Wren to reconnect.",
      actions: ["start"],
      tone: "default",
    });
  });
  it("names a failed restart and keeps its process cause", () => {
    expect(
      recoveryNotice(
        {
          standing: { kind: "unknown" },
          status: "ACTION_FAILED",
          process: {
            id: "restart",
            actionName: "stack.restart",
            status: "FAILED",
            created: "2026-10-07",
            projectId: "p",
            serviceStackIds: ["s"],
            failReason: "CommandExec: init command failed (exit 23)",
          },
        },
        "Wren",
      ),
    ).toMatchObject({
      text: expect.stringContaining("Wren couldn't restart. Its startup command failed."),
      actions: ["restart", "open-in-zerops"],
      tone: "error",
    });
  });
  it("an unexplained failed container does not invent a restart", () => {
    expect(
      recoveryNotice(
        { standing: { kind: "unknown" }, status: "ACTION_FAILED", process: undefined },
        "Wren",
      ),
    ).toMatchObject({ text: expect.stringContaining("Wren's container failed"), tone: "error" });
  });
  it("a running service does not show an old failed restart", () => {
    expect(
      recoveryNotice(
        {
          standing: { kind: "unknown" },
          status: "ACTIVE",
          process: {
            id: "old",
            actionName: "stack.restart",
            status: "FAILED",
            created: "2026-10-07",
            projectId: "p",
            serviceStackIds: ["s"],
          },
        },
        "Wren",
      ),
    ).toBeNull();
  });
});

it("a new start supersedes a prior failure even before the service status catches up", () => {
  expect(
    recoveryNotice(
      {
        standing: { kind: "unknown" },
        status: "ACTION_FAILED",
        process: {
          id: "new",
          actionName: "stack.start",
          status: "RUNNING",
          created: "2026-10-07",
          projectId: "p",
          serviceStackIds: ["s"],
        },
      },
      "Wren",
    ),
  ).toMatchObject({ text: "Wren is starting.", actions: [], tone: "default" });
});
it("full-disk telemetry reports its sample without inventing a failed turn", () => {
  expect(
    recoveryNotice(
      { standing: { kind: "unknown" }, status: "ACTIVE", process: undefined, diskFull: true },
      "Wren",
    ),
  ).toMatchObject({
    text: "Zerops last reported Wren's disk is full. Free space before saving or running more work.",
    tone: "warning",
  });
});

// The named Mate is the subject; platform labels and diagnostics never become its headline.
it.each(["500: Internal Server Error", "unclassified platform failure"])(
  "keeps %s under Details and names the Mate",
  (failReason) => {
    const notice = recoveryNotice(
      {
        standing: { kind: "deleted", name: "Radotin - Eddy" },
        status: undefined,
        process: undefined,
      },
      "Eddy",
    );
    expect(notice?.headline).toBe("Eddy's project was deleted.");
    const failed = recoveryNotice(
      {
        standing: { kind: "unknown" },
        status: "ACTION_FAILED",
        process: {
          id: "restart",
          actionName: "stack.restart",
          status: "FAILED",
          created: "2026-10-07",
          projectId: "p",
          serviceStackIds: ["s"],
          failReason,
        },
      },
      "Eddy",
    );
    expect(failed?.headline).toBe("Eddy couldn't restart.");
    expect(failed?.secondary).not.toContain(failReason);
    expect(failed?.details).toBe(failReason);
    if (failReason.startsWith("500"))
      expect(failed?.secondary).toBe("Zerops returned an error while restarting.");
  },
);

it.each([
  [
    "ENOSPC: no space left on device",
    "Its disk is full. Free space before saving or running more work.",
  ],
  ["CommandExec: init command failed (exit 23)", "Its startup command failed."],
])(
  "the final start of a failed-container restart retains its actionable cause (%s)",
  (failReason, cause) => {
    expect(
      recoveryNotice(
        {
          standing: { kind: "unknown" },
          status: "ACTION_FAILED",
          process: {
            id: "start",
            actionName: "stack.start",
            status: "FAILED",
            created: "2026-10-08",
            projectId: "p",
            serviceStackIds: ["s"],
            failReason,
          },
        },
        "Wren",
      )?.text,
    ).toBe(`Wren couldn't start. ${cause}`);
  },
);
