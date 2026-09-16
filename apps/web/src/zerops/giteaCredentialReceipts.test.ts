import type { GiteaCredentialOutcome } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  forgetMateGiteaReceipts,
  mateGiteaReceiptFrom,
  readMateGiteaReceipt,
  recordMateGiteaReceipt,
} from "./giteaCredentialReceipts";

describe("what a reconcile outcome proves", () => {
  it.each([
    { name: "the broker's token, written in", outcome: { kind: "written" }, expected: true },
    {
      name: "a Mate that already holds this Gitea's",
      outcome: { kind: "up-to-date" },
      expected: true,
    },
    {
      name: "an ask that failed for a Mate that needed one",
      outcome: { kind: "unavailable", reason: "the broker refused" },
      expected: false,
    },
    {
      name: "an account whose Gitea is still coming up",
      outcome: { kind: "waiting-for-gitea" },
      expected: undefined,
    },
  ] as ReadonlyArray<{
    name: string;
    outcome: GiteaCredentialOutcome;
    expected: boolean | undefined;
  }>)("$name", ({ outcome, expected }) => {
    expect(mateGiteaReceiptFrom(outcome)).toBe(expected);
  });
});

describe("the receipts themselves", () => {
  it("say nothing about a Mate no reconcile has reached", () => {
    forgetMateGiteaReceipts();
    expect(readMateGiteaReceipt("project-1")).toBeUndefined();
    expect(readMateGiteaReceipt(undefined)).toBeUndefined();
  });

  it("keep what the last reconcile established", () => {
    forgetMateGiteaReceipts();
    recordMateGiteaReceipt("project-1", false);
    recordMateGiteaReceipt("project-1", true);
    expect(readMateGiteaReceipt("project-1")).toBe(true);
  });
});
