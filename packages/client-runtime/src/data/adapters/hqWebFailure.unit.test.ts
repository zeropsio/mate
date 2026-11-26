import { expect, it } from "@effect/vitest";
import { HqError, type HqApi, type WebFailureKind } from "../../zerops/hq/client.ts";
import { webFailureKindOf, webFailureReporter } from "./hqWebFailure.ts";

type Report = { readonly projectId: string; readonly kind: WebFailureKind };

// witness: packages/client-runtime/src/data/adapters/hqWebFailure.ts | if (kinds.has(kind)) return; →
it("AD89: A Mate that did not open is reported to HQ once per project and kind until that project opens, only for an unreachable descriptor, a failed identity exchange or a spent opening deadline, and never for a refusal the page explains; breaks: one unreachable Mate spends the session's allowance in a minute, or a version refusal is counted as an outage", () => {
  const reports: Array<{ readonly orgId: string; readonly report: Report }> = [];
  const reporter = webFailureReporter((orgId) => ({
    webFailure: async (report) => {
      reports.push({ orgId, report });
    },
  }));
  const first = { orgId: "org-1", projectId: "project-1" };
  const second = { orgId: "org-1", projectId: "project-2" };
  const otherOrg = { orgId: "org-2", projectId: "project-1" };
  reporter.failed(first, "descriptor-unreachable");
  reporter.failed(first, "descriptor-unreachable");
  reporter.failed(first, "descriptor-unreachable");
  reporter.failed(first, "identity-failed");
  reporter.failed(second, "descriptor-unreachable");
  reporter.failed(otherOrg, "descriptor-unreachable");
  reporter.opened(first);
  reporter.failed(first, "descriptor-unreachable");
  reporter.failed(second, "descriptor-unreachable");
  expect(reports).toEqual([
    { orgId: "org-1", report: { projectId: "project-1", kind: "descriptor-unreachable" } },
    { orgId: "org-1", report: { projectId: "project-1", kind: "identity-failed" } },
    { orgId: "org-1", report: { projectId: "project-2", kind: "descriptor-unreachable" } },
    { orgId: "org-2", report: { projectId: "project-1", kind: "descriptor-unreachable" } },
    { orgId: "org-1", report: { projectId: "project-1", kind: "descriptor-unreachable" } },
  ]);
  expect(webFailureKindOf({ class: "retryable", cause: { kind: "descriptor-unreachable" } })).toBe(
    "descriptor-unreachable",
  );
  expect(webFailureKindOf({ class: "retryable", cause: { kind: "identity-failed" } })).toBe(
    "identity-failed",
  );
  expect(webFailureKindOf({ class: "retryable", cause: { kind: "install" } })).toBeNull();
  expect(webFailureKindOf({ class: "refusal", reason: { kind: "version" } })).toBeNull();
  expect(webFailureKindOf({ class: "refusal", reason: { kind: "project-mismatch" } })).toBeNull();
});

// witness: packages/client-runtime/src/data/adapters/hqWebFailure.ts | .catch(() => {}) →
it("AD90: A report HQ refuses, cannot take or has no account for changes nothing: no error reaches the caller and nothing is retried; breaks: a rate-limited or unreachable HQ breaks opening a Mate, or reports loop", async () => {
  const reports: Report[] = [];
  const pending: Promise<void>[] = [];
  const handled: unknown[] = [];
  let hq: Pick<HqApi, "webFailure"> | null = null;
  const reporter = webFailureReporter(() => hq);
  const first = { orgId: "org-1", projectId: "project-1" };
  const second = { orgId: "org-1", projectId: "project-2" };
  expect(() => reporter.failed(first, "descriptor-unreachable")).not.toThrow();
  expect(reports).toEqual([]);

  hq = {
    webFailure: (report) => {
      reports.push(report);
      const cause =
        report.projectId === first.projectId
          ? new HqError({ kind: "refused", code: "too_many_requests", status: 429, message: "429" })
          : new Error("network");
      const rejection = Promise.reject<void>(cause);
      // Observe the rejection handler's outcome while keeping a real rejected promise in the stub.
      Object.defineProperty(rejection, "catch", {
        value: (handle: (error: unknown) => unknown) =>
          rejection.then(undefined, (error: unknown) => {
            const outcome = handle(error);
            handled.push(outcome);
            return outcome;
          }),
      });
      pending.push(rejection);
      return rejection;
    },
  };
  expect(() => reporter.failed(first, "descriptor-unreachable")).not.toThrow();
  expect(() => reporter.failed(first, "descriptor-unreachable")).not.toThrow();
  expect(() => reporter.failed(second, "identity-failed")).not.toThrow();
  expect(() => reporter.failed(second, "identity-failed")).not.toThrow();
  await Promise.allSettled(pending);
  expect(handled).toEqual([undefined, undefined]);
  expect(reports).toEqual([
    { projectId: "project-1", kind: "descriptor-unreachable" },
    { projectId: "project-2", kind: "identity-failed" },
  ]);

  const throwing = webFailureReporter(() => ({
    webFailure: () => {
      throw new Error("unavailable");
    },
  }));
  expect(() => throwing.failed(first, "opening-deadline")).not.toThrow();
});
