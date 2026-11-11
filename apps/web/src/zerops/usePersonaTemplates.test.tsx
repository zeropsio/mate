import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { platformMembership, type AccountStore } from "@t3tools/client-runtime/data";
import { membershipInputs } from "@t3tools/client-runtime/data/fixtures";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it } from "vite-plus/test";

import { AccountDataContext, AccountStoreContext, type AccountData } from "./accountData";
import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { ZeropsSessionContext } from "./sessionContext";
import { useOrgPersonaTemplates } from "./usePersonaTemplates";

let mounted: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = undefined;
});

it("persona template editing follows changes to the person's Zerops organization role", () => {
  const registry = AtomRegistry.make();
  const { store } = mountHqNavigation(registry, "org");
  for (const input of membershipInputs("ADMIN")) store.dispatch(input);
  let mayWrite = false;
  function Templates() {
    mayWrite = useOrgPersonaTemplates().mayWrite;
    return null;
  }
  function Account({ store }: { readonly store: AccountStore }) {
    const membership = useAtomValue(store.data.project(platformMembership, "org"));
    return (
      <AccountStoreContext value={store}>
        <AccountDataContext
          value={{ data: store.data, orgId: "org", viewer: membership.viewer } as AccountData}
        >
          <Templates />
        </AccountDataContext>
      </AccountStoreContext>
    );
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted = create(
      <RegistryContext value={registry}>
        <ZeropsSessionContext
          value={{ activeOrganization: { id: "org", name: "Acme", roleCode: "ADMIN" } } as never}
        >
          <Account store={store} />
        </ZeropsSessionContext>
      </RegistryContext>,
    );
  });
  expect(mayWrite).toBe(true);
  act(() => {
    for (const input of membershipInputs("READ_ONLY", false, 2)) store.dispatch(input);
  });
  expect(mayWrite).toBe(false);
});
