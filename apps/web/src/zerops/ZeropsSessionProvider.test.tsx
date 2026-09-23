import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import {
  makeAccountHarness,
  type AccountHarnessOptions,
} from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const other: ZeropsUser = {
  id: "user-2",
  email: "other@example.test",
  clientUserList: [{ id: "cu-2", clientId: "org-2", roleCode: "OWNER" }],
};

function harnessWith(options: Partial<AccountHarnessOptions> = {}) {
  return makeAccountHarness({
    people: [
      { user: person, password: "secret" },
      { user: other, password: "other-secret" },
    ],
    ...options,
  });
}

const storedSession = (harness: ReturnType<typeof harnessWith>) =>
  harness.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY);

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("ZeropsSessionProvider sign-in guards", () => {
  it("signs in with a password: verified person, stored session, open account", async () => {
    const harness = harnessWith();
    const tab = await mountTab(harness, harness.browser.openTab());
    expect(tab.session().status).toBe("signed-out");

    await tab.run(() => tab.session().signIn("person@example.test", "secret"));

    expect(tab.session().status).toBe("signed-in");
    expect(tab.session().user?.id).toBe("user-1");
    expect(tab.accountId()).toBe("user-1");
    expect(JSON.parse(storedSession(harness)!)).toMatchObject({ accessToken: expect.any(String) });
  });

  it("stays signed out with nothing stored after a refused password", async () => {
    const harness = harnessWith();
    const tab = await mountTab(harness, harness.browser.openTab());

    await expect(
      tab.run(() => tab.session().signIn("person@example.test", "wrong")),
    ).rejects.toThrow();

    expect(tab.session().status).toBe("signed-out");
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();
  });

  it("waits at the second factor with nothing stored, then signs in on the code", async () => {
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret", totp: "123456" }],
    });
    const tab = await mountTab(harness, harness.browser.openTab());

    await tab.run(() => tab.session().signIn("person@example.test", "secret"));
    expect(tab.session().status).toBe("totp-required");
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();

    await tab.run(() => tab.session().verifyTotp("123456"));
    expect(tab.session().status).toBe("signed-in");
    expect(tab.accountId()).toBe("user-1");
    expect(storedSession(harness)).not.toBeNull();
  });

  it("adopts a hand-over token only after the platform names its person", async () => {
    const harness = harnessWith();
    const tab = await mountTab(harness, harness.browser.openTab(), { path: "/zerops/authorized" });

    await expect(
      tab.run(() =>
        tab.session().adoptHandover({ token: "revoked", clientId: null, zcpClaimed: false }),
      ),
    ).rejects.toThrow();
    expect(tab.session().status).toBe("signed-out");
    expect(storedSession(harness)).toBeNull();

    const handedOver = harness.rest.issueSession("user-1").accessToken;
    await tab.run(() =>
      tab.session().adoptHandover({ token: handedOver, clientId: "org-1", zcpClaimed: false }),
    );
    expect(tab.session().status).toBe("signed-in");
    expect(tab.session().activeOrganization?.id).toBe("org-1");
    expect(JSON.parse(storedSession(harness)!)).toEqual({ accessToken: handedOver });
  });

  it("signs out: closes the account, clears the stored session, revokes the token it carried", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const token = JSON.parse(storedSession(harness)!).accessToken as string;
    const tab = await mountTab(harness, harness.browser.openTab());
    expect(tab.session().status).toBe("signed-in");

    await tab.run(() => tab.session().signOut());

    expect(tab.session().status).toBe("signed-out");
    expect(tab.session().user).toBeNull();
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();
    expect(
      harness.rest.requests().filter(({ route }) => route === "POST /auth/logout"),
    ).toMatchObject([{ token }]);
  });

  it("signs out when another tab signs out", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const tab = await mountTab(harness, harness.browser.openTab());
    expect(tab.session().status).toBe("signed-in");

    harness.browser.openTab().localStorage.removeItem(ZEROPS_SESSION_STORAGE_KEY);
    await settle();

    expect(tab.session().status).toBe("signed-out");
    expect(tab.session().user).toBeNull();
    expect(tab.accountId()).toBeNull();
  });

  it("keeps a stored session and opens no account when the network fails at boot", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const offline = harness.browser.openTab();
    offline.signals.offline();

    const tab = await mountTab(harness, offline);

    expect(tab.session().status).toBe("unavailable");
    expect(tab.session().user).toBeNull();
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).not.toBeNull();
  });

  it("renews an expired stored token at boot and signs in", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const stale = JSON.parse(storedSession(harness)!).accessToken as string;
    harness.rest.expireAccessToken(stale);

    const tab = await mountTab(harness, harness.browser.openTab());

    expect(tab.session().status).toBe("signed-in");
    expect(harness.rest.refreshes()).toBe(1);
    expect(JSON.parse(storedSession(harness)!).accessToken).not.toBe(stale);
  });

  it("signs out and clears a stored session the platform no longer honours", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const revoked = JSON.parse(storedSession(harness)!).accessToken as string;
    await harness.rest.fetch("https://api.example.test/api/rest/public/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${revoked}` },
    });

    const tab = await mountTab(harness, harness.browser.openTab());

    expect(tab.session().status).toBe("signed-out");
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();
  });
});

describe("ZeropsSessionProvider across two tabs", () => {
  it("signs the other tab out when one tab signs out", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await mountTab(harness, harness.browser.openTab());
    const b = await mountTab(harness, harness.browser.openTab());
    expect([a.session().status, b.session().status]).toEqual(["signed-in", "signed-in"]);

    await a.run(() => a.session().signOut());
    await settle();

    expect(b.session().status).toBe("signed-out");
    expect(b.accountId()).toBeNull();
    expect(a.session().status).toBe("signed-out");
    expect(a.tab.reloads).toBe(0);
  });

  it("signs both tabs in on one legacy session, with no reload and no refresh", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await mountTab(harness, harness.browser.openTab());
    const b = await mountTab(harness, harness.browser.openTab());
    await settle();

    expect([a.session().status, b.session().status]).toEqual(["signed-in", "signed-in"]);
    expect([a.accountId(), b.accountId()]).toEqual(["user-1", "user-1"]);
    expect([a.tab.reloads, b.tab.reloads]).toEqual([0, 0]);
    expect(harness.rest.refreshes()).toBe(0);
    expect(harness.rest.requests().map(({ route }) => route)).toEqual([
      "GET /user/info",
      "GET /user/info",
    ]);
  });

  it("brings a signed-out tab to the account another tab signs in to", async () => {
    const harness = harnessWith();
    const a = await mountTab(harness, harness.browser.openTab());
    const b = await mountTab(harness, harness.browser.openTab());

    await a.run(() => a.session().signIn("person@example.test", "secret"));
    await settle();

    expect(b.session().status).toBe("signed-in");
    expect(b.session().user?.id).toBe("user-1");
    expect(b.accountId()).toBe("user-1");
  });

  it("keeps the other tab signed in when one tab renews the shared token", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await mountTab(harness, harness.browser.openTab());
    const b = await mountTab(harness, harness.browser.openTab());
    harness.rest.expireAccessToken(JSON.parse(storedSession(harness)!).accessToken);

    await a.run(() => a.session().client.fetchUser());
    await settle();

    expect(harness.rest.refreshes()).toBe(1);
    expect([a.session().status, b.session().status]).toEqual(["signed-in", "signed-in"]);
    expect(b.accountId()).toBe("user-1");
  });
});
