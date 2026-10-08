import type { ReactNode } from "react";
import {
  accountReadsAtom,
  makeAccountStore,
  hqMateOverviewAtom,
  mateAttentionAtom,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return { ...actual, useEffect: reactHookHarness.useEffect, useMemo: reactHookHarness.useMemo };
});

import { seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
import { ZeropsAccountData } from "./ZeropsAccountData";
import type { ZeropsDataBinding } from "./ZeropsAccountEnvironmentProvider";

beforeEach(() => hooks.reset());

describe("ZeropsAccountData on mobile", () => {
  it("hands the account's reads over to another organization, never leaving them unset between", () => {
    const registry = AtomRegistry.make();
    const binding = {
      registry,
      accountData: {
        data: {},
        observation: {
          show: () => undefined,
          closed: () => false,
          demandDetail: () => () => {},
          renewHeld: () => {},
        },
      },
    } as unknown as ZeropsDataBinding;
    const render = (activeOrganizationId: string) => {
      hooks.beginRender();
      ZeropsAccountData({ binding, activeOrganizationId, children: null });
    };
    render("org-1");
    const heard: Array<string | null | undefined> = [];
    const stop = registry.subscribe(accountReadsAtom, (reads) => heard.push(reads?.orgId));
    render("org-2");
    stop();
    expect(heard).toEqual(["org-2"]);
  });
  it("retained mobile shares org-keyed HQ and attention readers without changing its thread sidebar", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org-1", {
      mates: { mate: { presence: { online: true, since: "now", overview: "none" } } },
    });
    const binding = {
      registry,
      accountData: {
        store,
        data: store.data,
        observation: {
          show: () => undefined,
          closed: () => false,
          demandDetail: () => () => {},
          renewHeld: () => {},
        },
      },
    } as unknown as ZeropsDataBinding;
    const render = (activeOrganizationId: string) => {
      hooks.beginRender();
      ZeropsAccountData({ binding, activeOrganizationId, children: null });
    };
    render("org-1");
    const row = hqMateOverviewAtom("mate");
    const stop = registry.subscribe(row, () => registry.get(row), { immediate: true });
    expect(registry.get(row)?.presence.online).toBe(true);
    render("org-2");
    expect(registry.get(row)).toBeNull();
    expect(registry.get(mateAttentionAtom("mate"))).toEqual({
      attention: null,
      live: false,
      unseen: null,
    });
    stop();
    registry.dispose();
  });
});

vi.mock("./MateImagesProvider", () => ({
  MateImages: ({ children }: { readonly children: ReactNode }) => children,
}));
