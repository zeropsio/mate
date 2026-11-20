import { expect, it } from "vite-plus/test";

import { buildZeropsAuthorizeUrl, readZeropsHandover } from "./handover.ts";

// witness: packages/client-runtime/src/zerops/handover.ts | if (!expected || echoedNonce !== expected) { → if (!expected) {
it("ZV+11: A handover yields a credential only on a matching `state` nonce; a matched answer without a token is a refusal; no request goes out without a nonce", () => {
  const request = {
    origin: "https://mate.zerops.io",
    path: "",
    guiBaseUrl: "https://app.zerops.io",
  };
  expect(() => buildZeropsAuthorizeUrl({ ...request, nonce: " " })).toThrow();
  expect(
    new URL(buildZeropsAuthorizeUrl({ ...request, nonce: "nonce-1" })).searchParams.get("state"),
  ).toBe("nonce-1");

  expect(readZeropsHandover("#token=pat-1&state=nonce-2", "nonce-1")).toEqual({
    kind: "mismatched",
  });
  expect(readZeropsHandover("#token=pat-1&state=nonce-1", null)).toEqual({ kind: "mismatched" });
  expect(readZeropsHandover("#token=pat-1&state=nonce-1", "nonce-1")).toMatchObject({
    kind: "session",
    token: "pat-1",
  });
  expect(readZeropsHandover("#state=nonce-1", "nonce-1")).toMatchObject({ kind: "declined" });
});
