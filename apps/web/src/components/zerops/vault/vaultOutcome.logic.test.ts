import type { OperationEnd } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { vaultOutcome } from "./vaultOutcome.logic";

describe("vaultOutcome", () => {
  it.each<[NonNullable<OperationEnd>, ReturnType<typeof vaultOutcome>]>([
    [{ stage: "done", operationId: "o", outcome: "succeeded" }, { ok: true }],
    [{ stage: "unobserved" }, { ok: true }],
    [
      {
        stage: "refused",
        reason: "LOG_LEVEL is already in Shared.",
        code: "projectEnvDuplicateKey",
      },
      { ok: false, code: "projectEnvDuplicateKey", message: "LOG_LEVEL is already in Shared." },
    ],
    [
      { stage: "refused", reason: "No." },
      { ok: false, code: null, message: "No." },
    ],
    [
      { stage: "unsent", next: "send-again" },
      { ok: false, code: null, message: "Zerops did not take it. Try again." },
    ],
    [
      { stage: "uncertain", next: "ask-owner-again" },
      {
        ok: false,
        code: null,
        message: "Zerops did not answer whether it took it. Look again before trying again.",
      },
    ],
    [
      { stage: "done", operationId: "o", outcome: "failed", reason: "Process failed." },
      { ok: false, code: null, message: "Process failed." },
    ],
    [
      { stage: "unresolved", operationId: "o", nextActor: "person" },
      { ok: false, code: null, message: "Zerops did not say how it ended." },
    ],
  ])("%o", (end, outcome) => {
    expect(vaultOutcome(end)).toEqual(outcome);
  });

  it("is not over while it is still on its way", () => {
    expect(vaultOutcome({ stage: "submitting" })).toBeNull();
    expect(vaultOutcome({ stage: "uncertain", next: "asking-owner" })).toBeNull();
    expect(vaultOutcome({ stage: "accepted", operationId: "o" })).toBeNull();
    expect(vaultOutcome({ stage: "reflected", operationId: "o" })).toBeNull();
  });
});
