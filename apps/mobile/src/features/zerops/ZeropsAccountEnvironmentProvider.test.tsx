import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const accounts = vi.hoisted(() => ({
  events: [] as string[],
  environments: { setActiveOrganization: vi.fn() },
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useLayoutEffect: (effect: () => void) => effect(),
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});
vi.mock("@t3tools/client-runtime/zerops/account/runtime", async () => {
  const Effect = await import("effect/Effect");
  return {
    makeAccountRuntime: ({
      account,
    }: {
      readonly account: { readonly account: { readonly accountId: string } };
    }) =>
      Effect.sync(() => {
        accounts.events.push(`start:${account.account.accountId}`);
        return {
          environments: accounts.environments,
          close: (reason: string) =>
            Effect.sync(() => {
              accounts.events.push(`close:${account.account.accountId}:${reason}`);
            }),
        };
      }),
  };
});
vi.mock("./environment-ports", () => ({ mobileAccountPorts: async () => ({}) }));
import {
  ZeropsAccountEnvironmentProvider,
  type MobileZeropsDataAccount,
  type ZeropsDataValue,
} from "./ZeropsAccountEnvironmentProvider";
const account = (userId: string): MobileZeropsDataAccount => ({
  client: { baseUrl: "https://api.example.test" } as MobileZeropsDataAccount["client"],
  userId,
});
const ports = async () => ({}) as never;
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function render(current: MobileZeropsDataAccount | null, accountPorts = ports) {
  hooks.beginRender();
  effects.length = 0;
  const node = ZeropsAccountEnvironmentProvider({
    account: current,
    children: null,
    accountPorts,
  }) as unknown as { readonly props: { readonly value: ZeropsDataValue } };
  const pending = effects.slice();
  return {
    value: node.props.value,
    commit: () => {
      const cleanups = pending.map((effect) => effect());
      return () => {
        for (const cleanup of cleanups.toReversed()) cleanup?.();
      };
    },
  };
}
describe("mobile account data lifecycle", () => {
  beforeEach(() => {
    hooks.reset();
    effects.length = 0;
    accounts.events = [];
  });
  it("opens no store or adapter for an inactive account", async () => {
    const cleanup = render(null).commit();
    await settle();
    expect(accounts.events).toEqual([]);
    cleanup();
  });
  it("binds the verified account's Mate adapter and closes it once", async () => {
    const current = account("a");
    const cleanup = render(current).commit();
    await settle();
    expect(render(current).value).toMatchObject({
      binding: { account: { account: { accountId: "a" } } },
      environments: accounts.environments,
    });
    cleanup();
    await settle();
    expect(accounts.events).toEqual(["start:a", "close:a:account-replaced"]);
  });
  it("closes old facts before a late detail release after logout", async () => {
    const current = account("a");
    const cleanup = render(current).commit();
    await settle();
    const binding = render(current).value.binding!;
    const release = binding.accountData.observation.demandDetail({
      family: "process",
      listing: "history",
      ownerId: "project",
    });
    render(null).commit();
    cleanup();
    await settle();
    expect(binding.accountData.observation.closed()).toBe(true);
    expect(release).not.toThrow();
    expect(accounts.events).toEqual(["start:a", "close:a:logout"]);
  });
  it("disposes the prior adapter before starting a replacement", async () => {
    const cleanupA = render(account("a")).commit();
    await settle();
    cleanupA();
    const cleanupB = render(account("b")).commit();
    await settle();
    cleanupB();
    await settle();
    expect(accounts.events).toEqual([
      "start:a",
      "close:a:account-replaced",
      "start:b",
      "close:b:account-replaced",
    ]);
  });
  it("does not open an adapter when logout races pending native ports", async () => {
    let resolve: (value: never) => void = () => {};
    const pendingPorts = () =>
      new Promise<never>((done) => {
        resolve = done;
      });
    const cleanup = render(account("a"), pendingPorts).commit();
    await settle();
    cleanup();
    resolve({} as never);
    await settle();
    expect(accounts.events).toEqual([]);
  });
});

vi.mock("./MateImagesProvider", () => ({
  MateImages: ({ children }: { readonly children: ReactNode }) => children,
}));
vi.mock("./MateEngineHostProvider", () => ({
  MateEngineHost: ({ children }: { readonly children: ReactNode }) => children,
}));
