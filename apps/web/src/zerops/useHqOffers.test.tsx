import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { platformMembership, type AccountStore } from "@t3tools/client-runtime/data";
import { liveProjects, membershipInputs } from "@t3tools/client-runtime/data/fixtures";
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

// Whether a person may create an application or add a Mate follows their Zerops membership: its
// own *can create projects*, read live, never a hint HQ sends.
it("creation offers follow whether the person's Zerops membership may create projects", () => {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org" },
  } as never);
  const { store } = mountHqNavigation(registry, "org", {
    live: true,
    structure: { ungrouped: [], apps: [{ id: "app", name: "App", projects: [] }] },
  });
  for (const input of membershipInputs("BASIC_USER", false)) store.dispatch(input);
  for (const input of liveProjects("org", [])) store.dispatch(input);
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
  expect(seen).toEqual(["refused", "refused"]);
  act(() => {
    for (const input of membershipInputs("BASIC_USER", true, 2)) store.dispatch(input);
  });
  expect(seen).toEqual(["allowed", "allowed"]);
});
