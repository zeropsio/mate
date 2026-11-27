import { expect, it } from "vite-plus/test";
import { checkNoticeLogin, checkNoticeVerdict } from "./checkNotice.ts";

// witness: apps/server/src/zerops/admission/checkNotice.ts | if (input.state !== "authorized") return "unavailable"; → if (input.state !== "authorized") return "unknown";
it("TA+1: A check notice runs on an admitted owner login, waits while its login or admission is unknown, and ends with no-agent or usage-limit only when no other owner login can run; breaks: a failed check waits forever or an unresolved sign-in is handed to a person too soon", () => {
  const rows = [
    ["authorized", "admit", "ready"],
    ["not-authorized", "refuse", "unavailable"],
    ["needs-reauth", "refuse", "unavailable"],
    ["reconnect", "refuse", "unavailable"],
    ["registering", "admit", "unknown"],
    [undefined, "unknown", "unknown"],
    ["authorized", "unknown", "unknown"],
  ] as const;
  for (const [state, admission, expected] of rows)
    expect(checkNoticeLogin({ state, admission, signingIn: false })).toBe(expected);
  expect(checkNoticeLogin({ state: "not-authorized", admission: "refuse", signingIn: true })).toBe(
    "unknown",
  );
  expect(checkNoticeVerdict({ current: "ready", others: [], usageLimited: false })).toEqual({
    kind: "run",
  });
  expect(
    checkNoticeVerdict({ current: undefined, others: ["ready"], usageLimited: false }),
  ).toEqual({ kind: "run" });
  expect(
    checkNoticeVerdict({ current: "unavailable", others: ["unavailable"], usageLimited: false }),
  ).toEqual({ kind: "end", reason: "no-agent" });
  expect(checkNoticeVerdict({ current: "unknown", others: [], usageLimited: false })).toEqual({
    kind: "wait",
  });
  expect(
    checkNoticeVerdict({ current: undefined, others: ["unknown"], usageLimited: false }),
  ).toEqual({ kind: "wait" });
  expect(
    checkNoticeVerdict({ current: "unavailable", others: ["ready"], usageLimited: false }),
  ).toEqual({ kind: "wait" });
  expect(
    checkNoticeVerdict({ current: "ready", others: ["unavailable"], usageLimited: true }),
  ).toEqual({ kind: "end", reason: "usage-limit" });
  expect(checkNoticeVerdict({ current: "unknown", others: [], usageLimited: true })).toEqual({
    kind: "wait",
  });
  expect(checkNoticeVerdict({ current: undefined, others: [], usageLimited: true })).toEqual({
    kind: "wait",
  });
  expect(checkNoticeVerdict({ current: "ready", others: ["unknown"], usageLimited: true })).toEqual(
    { kind: "wait" },
  );
  expect(checkNoticeVerdict({ current: "ready", others: ["ready"], usageLimited: true })).toEqual({
    kind: "wait",
  });
});
