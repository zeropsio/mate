import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./harnessTabs";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

async function twoSignedInTabs() {
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    signedIn: "user-1",
  });
  const a = await mountTab(harness, harness.browser.openTab(), { path: "/zerops/a" });
  const b = await mountTab(harness, harness.browser.openTab(), { path: "/zerops/b" });
  return { a, b };
}

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("harness tabs", () => {
  it("leaves the globals on the tab whose code ran after the other tab hears its write", async () => {
    const { a, b } = await twoSignedInTabs();

    await a.run(() => a.session().signOut());
    await settle();

    expect(b.tab.reloads).toBe(1);
    expect(globalThis.window.location).toBe(a.location());
  });
});
