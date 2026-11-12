import { describe, expect, it } from "vite-plus/test";

import { outsideAddressOf, outsideSaveChanges } from "./outsideProduction.logic";

describe("the address of a production deployed outside Mate", () => {
  // witness: apps/web/src/components/zerops/project/outsideProduction.logic.ts | if (text === "") return { kind: "ok", address: null }; →
  it("An empty Address is none given: the field is optional", () => {
    expect(outsideAddressOf("  ")).toEqual({ kind: "ok", address: null });
  });

  // witness: apps/web/src/components/zerops/project/outsideProduction.logic.ts | const spelled = SCHEME.test(text) ? text : `https://${text}`; → const spelled = text;
  it("An address typed without https:// is sent with it, as HQ takes only a whole one", () => {
    expect(outsideAddressOf("tea-shop.example")).toEqual({
      kind: "ok",
      address: "https://tea-shop.example",
    });
  });

  // witness: apps/web/src/components/zerops/project/outsideProduction.logic.ts | if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") → if (url.hostname === "")
  it("An address that is no web address is said before anything is sent", () => {
    expect(outsideAddressOf("ftp://tea-shop.example").kind).toBe("invalid");
  });

  // witness: apps/web/src/components/zerops/project/outsideProduction.logic.ts | return typed.kind === "ok" && (current === null || current.address !== typed.address); → return typed.kind === "ok";
  it("Save has nothing to send while the address stands as it is", () => {
    const current = { address: "https://tea-shop.example" };
    expect(outsideSaveChanges(current, outsideAddressOf("https://tea-shop.example"))).toBe(false);
    expect(outsideSaveChanges(current, outsideAddressOf(""))).toBe(true);
    expect(outsideSaveChanges(null, outsideAddressOf(""))).toBe(true);
  });
});
