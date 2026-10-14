import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { platformMembership, type AccountStore } from "@t3tools/client-runtime/data";
import { membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it } from "vite-plus/test";

import { zeropsSessionAtom } from "../state/zerops";
import { AccountDataContext, type AccountData } from "./accountData";
import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { useAddMateOffer, useOrgOffers } from "./useHqOffers";

let mounted: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = undefined;
});

it.each(["unread", "allowed"] as const)(
  "creation offers follow the current membership when its flag arrives, is revoked and is restored despite a stale HQ allowance: %s",
  (initial) => {
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org" },
    } as never);
    const { store } = mountHqNavigation(registry, "org", {
      live: true,
      structure: {
        can: { create_app: { allow: true } },
        ungrouped: [],
        apps: [{ id: "app", name: "App", projects: [], can: { add_mate: { allow: true } } }],
      },
    });
    if (initial === "allowed") {
      for (const input of membershipInputs("NO_ACCESS", true)) store.dispatch(input);
    }
    let seen: readonly string[] = [];
    function Offers() {
      seen = [useOrgOffers()("create_app").kind, useAddMateOffer()("app").kind];
      return null;
    }
    function Account({ store }: { readonly store: AccountStore }) {
      const membership = useAtomValue(store.data.project(platformMembership, "org"));
      return (
        <AccountDataContext
          value={{ data: store.data, orgId: "org", viewer: membership.viewer } as AccountData}
        >
          <Offers />
        </AccountDataContext>
      );
    }
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      mounted = create(
        <RegistryContext value={registry}>
          <Account store={store} />
        </RegistryContext>,
      );
    });
    expect(seen).toEqual(initial === "unread" ? ["unknown", "unknown"] : ["allowed", "allowed"]);
    const updateFlag = (flag: boolean, generation: number) =>
      act(() => {
        for (const input of membershipInputs("NO_ACCESS", flag, generation)) store.dispatch(input);
      });
    const nextGeneration = initial === "unread" ? 1 : 2;
    updateFlag(true, nextGeneration);
    expect(seen).toEqual(["allowed", "allowed"]);
    updateFlag(false, nextGeneration + 1);
    expect(seen).toEqual(["refused", "refused"]);
    updateFlag(true, nextGeneration + 2);
    expect(seen).toEqual(["allowed", "allowed"]);
  },
);
