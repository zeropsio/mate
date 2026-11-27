import { expect, it } from "vite-plus/test";
import { checkNoticeAfterLimit, checkNoticeLogin, checkNoticeVerdict } from "./checkNotice.ts";

// witness: apps/server/src/zerops/admission/checkNotice.ts | if (input.current === "unavailable") return { kind: "end", reason: "no-agent" }; → if (input.current === "unavailable") return { kind: "wait" };
it("TA13: A check notice runs on its conversation's admitted owner login, or selects a ready owner login when none is selected; an unknown login or admission waits, a definitely unavailable login ends no-agent, and a known selected login at its usage limit ends usage-limit even with a wake or another login; a limited run with no known selected login and no wake can finish; breaks: a failed check waits forever or an unresolved sign-in is handed to a person too soon", () => {
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
  const verdicts = [
    ["ready", ["unknown"], { kind: "run" }],
    ["unavailable", ["ready"], { kind: "end", reason: "no-agent" }],
    ["unavailable", ["unknown"], { kind: "end", reason: "no-agent" }],
    ["unknown", ["ready"], { kind: "wait" }],
    [undefined, ["ready", "unknown"], { kind: "run" }],
    [undefined, ["unknown"], { kind: "wait" }],
    [undefined, ["unavailable"], { kind: "end", reason: "no-agent" }],
    [undefined, [], { kind: "end", reason: "no-agent" }],
  ] as const;
  for (const [current, others, expected] of verdicts)
    expect(checkNoticeVerdict({ current, others, usageLimited: false })).toEqual(expected);

  for (const current of ["ready", "unavailable"] as const) {
    for (const other of ["ready", "unknown", "unavailable"] as const) {
      const verdict = checkNoticeVerdict({ current, others: [other], usageLimited: true });
      expect(verdict).toEqual({ kind: "end", reason: "usage-limit" });
      expect(checkNoticeAfterLimit(verdict, true)).toEqual(verdict);
      expect(checkNoticeAfterLimit(verdict, false)).toEqual(verdict);
    }
  }
  for (const current of ["unknown", undefined] as const) {
    const verdict = checkNoticeVerdict({ current, others: ["ready"], usageLimited: true });
    expect(verdict).toEqual({ kind: "wait" });
    expect(checkNoticeAfterLimit(verdict, true)).toEqual({ kind: "wait" });
    expect(checkNoticeAfterLimit(verdict, false)).toEqual({ kind: "finish" });
  }
  expect(checkNoticeAfterLimit(undefined, true)).toEqual({ kind: "wait" });
  expect(checkNoticeAfterLimit(undefined, false)).toEqual({ kind: "finish" });
});
