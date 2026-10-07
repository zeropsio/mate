import { describe, expect, it } from "vite-plus/test";
import { processValue } from "../__fixtures__/account.ts";
import { failedSetupProcess, setupFailureLogQuery, setupFailureReason } from "./setupFailure.ts";

const failed = processValue({
  id: "failed-setup",
  projectId: "p1",
  actionName: "stack.create",
  serviceStackIds: ["zcp"],
  status: "FAILED",
  created: "2026-10-07T10:00:00Z",
  started: "2026-10-07T10:00:02Z",
  finished: "2026-10-07T10:01:12Z",
  failReason: "CommandExec: init command failed",
});

describe("setup failure evidence", () => {
  it("uses only the newest attempt for this container, never another service or a replaced failure", () => {
    const retry = { ...failed, id: "retry", status: "RUNNING", created: "2026-10-07T10:02:00Z" };
    expect(failedSetupProcess([failed], "zcp")).toEqual(failed);
    expect(failedSetupProcess([failed], "other")).toBeUndefined();
    for (const processes of [
      [failed, retry],
      [retry, failed],
    ])
      expect(failedSetupProcess(processes, "zcp")).toBeUndefined();
    expect(failedSetupProcess([{ ...retry, status: "FINISHED" }, failed], "zcp")).toBeUndefined();
  });

  it("recognizes a deploy failure even when the build process finished", () => {
    expect(
      failedSetupProcess(
        [{ ...failed, status: "FINISHED", appVersion: { status: "DEPLOY_FAILED" } }],
        "zcp",
      ),
    ).toBeDefined();
  });

  it("demands a bounded runtime tail for the failed process, with no live follow or guessed bounds", () => {
    expect(setupFailureLogQuery(failed, "zcp")).toEqual({
      buildServiceStackId: "zcp",
      processId: "failed-setup",
      fromIso: failed.started,
      tillIso: failed.finished,
    });
    const { finished: _finished, ...withoutEnd } = failed;
    expect(setupFailureLogQuery(withoutEnd, "zcp")).toBeNull();
    expect(setupFailureLogQuery(undefined, "zcp")).toBeNull();
  });

  it.each([
    [
      "curl: (6) Could not resolve host: zerops.io\nzcp init: command not found",
      "dns",
      "Zerops platform problem",
    ],
    ["Network is unreachable", "network", "connect to the download server"],
    ["download failed: 404", "download", "couldn't be downloaded"],
    ["SHA256 checksum mismatch", "digest", "integrity check"],
    ["No space left on device", "disk", "disk space"],
    ["zcp: command not found (exit 127)", "command", "missing or incompatible"],
    ["unknown option --mate-version", "command", "missing or incompatible"],
    ["command timed out", "timeout", "timed out"],
    ["something unexpected happened", "unknown", "Open Details"],
  ])("maps %s from the log to an actionable, named reason", (log, cause, words) => {
    const reason = setupFailureReason("Nic", failed.failReason, [log]);
    expect(reason.cause).toBe(cause);
    expect(reason.text).toContain("Nic couldn't be set up:");
    expect(reason.text).toContain(words);
    expect(reason.details).toBe(log);
  });

  it("keeps the raw result when no log is available instead of guessing a cause", () => {
    const reason = setupFailureReason("Nic", failed.failReason, []);
    expect(reason.cause).toBe("unknown");
    expect(reason.details).toBe(failed.failReason);
  });
});
