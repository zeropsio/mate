import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  defaultOpenCodeInstance,
  OPENCODE_KEY_PROVIDERS,
  openCodeKeyIsSet,
  withOpenCodeKey,
  withoutOpenCodeKey,
} from "./openCodeKeyProviders.ts";

const nebius = OPENCODE_KEY_PROVIDERS[0]!;
const opencode = ProviderDriverKind.make("opencode");
const base: ProviderInstanceConfig = { driver: opencode, enabled: false };

describe("an OpenCode provider key", () => {
  it.each([
    {
      name: "a key the server stores reads as set, without its value",
      environment: [{ name: "NEBIUS_API_KEY", value: "", sensitive: true, valueRedacted: true }],
      set: true,
    },
    {
      name: "a key just typed reads as set",
      environment: [{ name: "NEBIUS_API_KEY", value: "nb-acme", sensitive: true }],
      set: true,
    },
    {
      name: "an empty variable is no key",
      environment: [{ name: "NEBIUS_API_KEY", value: "", sensitive: true }],
      set: false,
    },
    {
      name: "another provider's variable is no key",
      environment: [{ name: "ACME_API_KEY", value: "", sensitive: true, valueRedacted: true }],
      set: false,
    },
  ])("$name", ({ environment, set }) => {
    expect(openCodeKeyIsSet({ ...base, environment }, nebius)).toBe(set);
  });

  it("is no key on an instance that has no environment", () => {
    expect(openCodeKeyIsSet(base, nebius)).toBe(false);
    expect(openCodeKeyIsSet(undefined, nebius)).toBe(false);
  });

  it("saving a key stores it as a secret under the provider's variable and turns OpenCode on", () => {
    expect(withOpenCodeKey(base, nebius, "  nb-acme  ")).toEqual({
      driver: opencode,
      enabled: true,
      environment: [{ name: "NEBIUS_API_KEY", value: "nb-acme", sensitive: true }],
    });
  });

  it("saving a key replaces an earlier one and keeps the other variables", () => {
    const instance: ProviderInstanceConfig = {
      ...base,
      environment: [
        { name: "NEBIUS_API_KEY", value: "", sensitive: true, valueRedacted: true },
        { name: "HTTPS_PROXY", value: "http://proxy.acme.test", sensitive: false },
      ],
    };
    expect(withOpenCodeKey(instance, nebius, "nb-new").environment).toEqual([
      { name: "HTTPS_PROXY", value: "http://proxy.acme.test", sensitive: false },
      { name: "NEBIUS_API_KEY", value: "nb-new", sensitive: true },
    ]);
  });

  it("removing the key leaves the other variables and OpenCode as they were", () => {
    const proxy = { name: "HTTPS_PROXY", value: "http://proxy.acme.test", sensitive: false };
    const instance: ProviderInstanceConfig = {
      driver: opencode,
      enabled: true,
      environment: [
        { name: "NEBIUS_API_KEY", value: "", sensitive: true, valueRedacted: true },
        proxy,
      ],
    };
    expect(withoutOpenCodeKey(instance, nebius)).toEqual({
      driver: opencode,
      enabled: true,
      environment: [proxy],
    });
    expect(
      withoutOpenCodeKey({ ...instance, environment: instance.environment!.slice(0, 1) }, nebius),
    ).toEqual({ driver: opencode, enabled: true });
  });
});

describe("the OpenCode instance a key is written to", () => {
  it("is the configured default instance when there is one", () => {
    const configured: ProviderInstanceConfig = { driver: opencode, enabled: true };
    expect(
      defaultOpenCodeInstance({
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: { [ProviderInstanceId.make("opencode")]: configured },
      }),
    ).toBe(configured);
  });

  it("is made from the legacy settings, their enabled flag on the envelope, when there is none", () => {
    const instance = defaultOpenCodeInstance(DEFAULT_SERVER_SETTINGS);
    expect(instance?.driver).toBe(opencode);
    expect(instance?.enabled).toBe(DEFAULT_SERVER_SETTINGS.providers.opencode.enabled);
    expect(instance?.config).not.toHaveProperty("enabled");
  });
});
