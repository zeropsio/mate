import { describe, expect, it } from "@effect/vitest";

import { ZeropsApiClient, type ZeropsUser } from "../api.ts";
import { loadZeropsSession } from "../session.ts";
import { makeAccountHarness } from "./accountHarness.ts";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

describe("makeAccountHarness", () => {
  it("starts every tab on one legacy session that the platform recognises", async () => {
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret" }],
      projects: [{ id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" }],
      signedIn: "user-1",
    });
    const tab = harness.browser.openTab();
    const session = await loadZeropsSession(tab.zeropsStorage);
    const client = new ZeropsApiClient({ fetch: harness.rest.fetchFor(tab) });
    client.restoreSession(session!);

    await expect(client.fetchUser()).resolves.toEqual(person);
    expect(harness.browser.localStorageKeys()).toHaveLength(1);
    expect(harness.rest.projectsOf("org-1").map(({ id }) => id)).toEqual(["p1"]);
    expect(harness.datastream.registrations()).toEqual([]);
  });
});
