import { accountReadsAtom } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return { ...actual, useEffect: reactHookHarness.useEffect, useMemo: reactHookHarness.useMemo };
});

import { ZeropsAccountData } from "./ZeropsAccountData";
import type { ZeropsDataBinding } from "./ZeropsDataProvider";

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
});
