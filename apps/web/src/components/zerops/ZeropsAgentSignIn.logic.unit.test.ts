import type { ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { currentAttempt } from "./ZeropsAgentSignIn.logic.ts";

const opened = Date.parse("2026-11-20T10:00:00Z");

function login(phase: ZeropsAgentLoginState["phase"], startedAt: string): ZeropsAgentLoginState {
  return { phase, terminalId: "login-terminal", startedAt: DateTime.makeUnsafe(startedAt) };
}

// witness: apps/web/src/components/zerops/ZeropsAgentSignIn.logic.ts | return DateTime.toEpochMillis(login.startedAt) >= since ? login : undefined; → return login;
it("MN+4: A sign-in dialog shows only its own attempt's outcome, never an earlier attempt's; a login still running is running however old, and a cancelled one shows none", () => {
  expect(currentAttempt(login("failed", "2026-11-20T09:59:00Z"), opened)).toBeUndefined();
  expect(currentAttempt(login("succeeded", "2026-11-20T09:30:00Z"), opened)).toBeUndefined();
  const ownFailure = login("failed", "2026-11-20T10:00:05Z");
  expect(currentAttempt(ownFailure, opened)).toBe(ownFailure);

  const runningSinceYesterday = login("awaiting-code", "2026-11-19T10:00:00Z");
  expect(currentAttempt(runningSinceYesterday, opened)).toBe(runningSinceYesterday);
  expect(currentAttempt(runningSinceYesterday, null)).toBe(runningSinceYesterday);

  expect(currentAttempt(login("cancelled", "2026-11-20T10:00:05Z"), opened)).toBeUndefined();
});
