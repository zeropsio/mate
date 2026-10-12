import { describe, expect, it } from "vite-plus/test";

import { handChiefAccess, takeChiefAccess } from "./chiefAccess";

const ACCESS = { credential: "zcp-credential-value", proxyUrl: "https://hq.example/proxy" };

describe("a Chief's access, between HQ's answer and its set-up", () => {
  it("reaches the set-up of its project once, and is held no longer", () => {
    handChiefAccess("p-chief", ACCESS);
    expect(takeChiefAccess("p-other")).toBeUndefined();
    expect(takeChiefAccess("p-chief")).toEqual(ACCESS);
    expect(takeChiefAccess("p-chief")).toBeUndefined();
  });

  it("a later answer for the project replaces an earlier one, whose credential HQ revoked", () => {
    handChiefAccess("p-chief", { ...ACCESS, credential: "revoked" });
    handChiefAccess("p-chief", ACCESS);
    expect(takeChiefAccess("p-chief")).toEqual(ACCESS);
  });
});
