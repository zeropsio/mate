import { ProviderDriverKind, type ProviderInstanceConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { environmentKeptWithKeys, environmentShownBesideKeys } from "./openCodeKeys.logic";

const opencode = ProviderDriverKind.make("opencode");
const base: ProviderInstanceConfig = { driver: opencode, enabled: false };

describe("the variables an OpenCode instance lists beside its provider keys", () => {
  const key = { name: "NEBIUS_API_KEY", value: "", sensitive: true, valueRedacted: true };
  const other = { name: "ACME_BASE_URL", value: "https://acme.example", sensitive: false };

  it("lists every variable but the provider keys, which their own line shows", () => {
    expect(environmentShownBesideKeys({ ...base, environment: [key, other] })).toEqual([other]);
  });

  it("keeps the provider keys when the listed variables are edited", () => {
    const edited = [{ ...other, value: "https://shop-front.example" }];
    expect(environmentKeptWithKeys({ ...base, environment: [key, other] }, edited)).toEqual([
      key,
      ...edited,
    ]);
  });

  it("lists every variable of an instance that isn't OpenCode", () => {
    const codex: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("codex"),
      environment: [key, other],
    };
    expect(environmentShownBesideKeys(codex)).toEqual([key, other]);
    expect(environmentKeptWithKeys(codex, [other])).toEqual([other]);
  });
});
