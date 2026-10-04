import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import {
  makeAccountHarness,
  type AccountHarnessOptions,
  type HarnessTab,
} from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

/** The login a tab verified, beside the session key and never inside it (DESIGN §1.1). */
const OWNER_KEY = "zerops-mate.zerops-session-owner.v1";

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

/** One render of a tab's page: what the session said and which account the tab had open. */
interface Frame {
  readonly status: string;
  readonly userId: string | null;
  readonly accountId: string | null;
}

/** A tab whose page records every frame it renders. */
async function recordingTab(harness: ReturnType<typeof harnessWith>) {
  const frames: Frame[] = [];
  const page = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const [{ useZeropsSession }, { currentAccountId }, { createElement }] = await Promise.all([
        import("./ZeropsSessionProvider"),
        import("./accountLifetime"),
        import("react"),
      ]);
      function Recorder() {
        const { status, user } = useZeropsSession();
        frames.push({ status, userId: user?.id ?? null, accountId: currentAccountId() });
        return null;
      }
      return createElement(Recorder);
    },
  });
  /** The frames rendered after the one at `from`, which a test took as its starting point. */
  const framesSince = (from: number) => frames.slice(from);
  return { ...page, frames: () => [...frames], framesSince };
}

const storedToken = (harness: ReturnType<typeof harnessWith>) =>
  (JSON.parse(storedSession(harness)!) as { accessToken: string }).accessToken;

const requestsOf = (
  harness: ReturnType<typeof harnessWith>,
  tab: { readonly tab: { readonly id: string } },
  token: string,
) =>
  harness.rest
    .requests()
    .filter((request) => request.tab === tab.tab.id && request.token === token)
    .map(({ route }) => route);

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

  it("retries a boot the network failed, and signs in once the tab is back online", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const offline = harness.browser.openTab();
    offline.signals.offline();
    const tab = await mountTab(harness, offline);
    expect(tab.session().status).toBe("unavailable");

    offline.signals.online();
    await settle();

    expect(tab.session().status).toBe("signed-in");
    expect(tab.accountId()).toBe("user-1");
    expect(tab.tab.reloads).toBe(0);
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

  it("boots and renews its token in a browser without Web Locks", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const lockless = { ...harness.browser.openTab(), locks: undefined } as unknown as HarnessTab;
    const tab = await mountTab(harness, lockless);
    expect(tab.session().status).toBe("signed-in");
    expect(tab.accountId()).toBe("user-1");
    harness.rest.expireAccessToken(storedToken(harness));

    await tab.run(() => tab.session().client.fetchUser());

    expect(harness.rest.refreshes()).toBe(1);
    expect(tab.session().status).toBe("signed-in");
  });

  it("mounts and signs in where the page may not touch localStorage", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const tab = await mountTab(harness, harness.browser.openTab());
    await tab.run(() => {
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new DOMException("Access is denied for this document.", "SecurityError");
        },
      });
      window.location.reload();
    });
    await settle();

    expect(tab.tab.reloads).toBe(1);
    expect(tab.session().status).toBe("signed-in");
    expect(tab.accountId()).toBe("user-1");
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

describe("ZeropsSessionProvider verified adoption across tabs", () => {
  it("adopts another tab's renewed session, which carries no userId, without a reload", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);
    const from = b.frames().length;
    harness.rest.expireAccessToken(storedToken(harness));

    await a.run(() => a.session().client.fetchUser());
    await settle();

    const renewed = JSON.parse(storedSession(harness)!) as { accessToken: string; userId?: string };
    expect(renewed.userId).toBeUndefined();
    expect(b.session().client.session?.accessToken).toBe(renewed.accessToken);
    expect(requestsOf(harness, b, renewed.accessToken)).toEqual(["GET /user/info"]);
    expect(b.framesSince(from)).toEqual(
      b
        .framesSince(from)
        .map(() => ({ status: "signed-in", userId: "user-1", accountId: "user-1" })),
    );
    expect([a.tab.reloads, b.tab.reloads]).toEqual([0, 0]);
  });

  it("stays signed in while the probe answers 503, and adopts when it retries", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const b = await recordingTab(harness);
    const from = b.frames().length;
    const held = storedToken(harness);
    const next = harness.rest.issueSession("user-1");
    const probe = harness.rest.hold("GET /user/info");

    harness.browser
      .openTab()
      .localStorage.setItem(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(next));
    await settle();
    expect(probe.waiting()).toBe(1);
    probe.fail(503);
    await settle();

    expect(b.session().status).toBe("signed-in");
    expect(b.accountId()).toBe("user-1");
    expect(b.session().client.session?.accessToken).toBe(held);

    b.tab.signals.hide();
    b.tab.signals.show();
    await settle();

    expect(b.session().client.session?.accessToken).toBe(next.accessToken);
    expect(b.framesSince(from)).toEqual(
      b
        .framesSince(from)
        .map(() => ({ status: "signed-in", userId: "user-1", accountId: "user-1" })),
    );
    expect(b.tab.reloads).toBe(0);
  });

  it("closes the account before another principal's session renders a frame", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const b = await recordingTab(harness);
    const from = b.frames().length;
    const other = harness.rest.issueSession("user-2");

    harness.browser
      .openTab()
      .localStorage.setItem(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(other));
    await settle();

    expect(b.session().user?.id).toBe("user-2");
    expect(b.accountId()).toBe("user-2");
    const frames = b.framesSince(from);
    for (const frame of frames)
      if (frame.userId !== null) expect(frame.accountId).toBe(frame.userId);
    const firstOther = frames.findIndex((frame) => frame.userId === "user-2");
    expect(frames.slice(0, firstOther)).toContainEqual({
      status: "loading",
      userId: null,
      accountId: null,
    });
    expect(requestsOf(harness, b, other.accessToken)).toEqual(["GET /user/info", "GET /user/info"]);
    expect(b.tab.reloads).toBe(0);
  });

  it("never replays a request with another person's session stored before its owner record", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const b = await recordingTab(harness);
    const stale = storedToken(harness);
    const other = harness.rest.issueSession("user-2");
    harness.rest.expireAccessToken(stale);
    const probes = harness.rest.hold("GET /user/info");

    // Another tab's sign-in has stored its session; its owner record still names user-1.
    harness.browser
      .openTab()
      .localStorage.setItem(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(other));
    const read = b
      .session()
      .client.listClientProjects("org-1")
      .catch((cause: unknown) => cause);
    await settle();
    expect(requestsOf(harness, b, other.accessToken)).not.toContain("GET /client/org-1/project");

    probes.release();
    await settle();

    expect(await read).toBeInstanceOf(Error);
    expect(requestsOf(harness, b, other.accessToken)).not.toContain("GET /client/org-1/project");
    expect(b.session().user?.id).toBe("user-2");
    expect(b.accountId()).toBe("user-2");
  });

  it("closes and re-verifies when another tab signs in anew as the same person", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);
    const fromA = a.frames().length;
    const fromB = b.frames().length;
    const before = harness.browser.openTab().localStorage.getItem(OWNER_KEY);

    await a.run(() => a.session().signIn("person@example.test", "secret"));
    await settle();

    expect(harness.browser.openTab().localStorage.getItem(OWNER_KEY)).not.toBe(before);
    expect(b.session().status).toBe("signed-in");
    expect(b.accountId()).toBe("user-1");
    expect(b.session().client.session?.accessToken).toBe(storedToken(harness));
    expect(b.framesSince(fromB)).toContainEqual({
      status: "loading",
      userId: null,
      accountId: null,
    });
    expect(a.framesSince(fromA).every((frame) => frame.accountId === "user-1")).toBe(true);
    expect([a.tab.reloads, b.tab.reloads]).toEqual([0, 0]);
  });

  it("brings two tabs booting on one legacy session to one owner record, with no close loop", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const boot = harness.rest.hold("GET /user/info");
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);

    boot.release();
    await settle();
    await settle();

    const owner = JSON.parse(harness.browser.openTab().localStorage.getItem(OWNER_KEY)!);
    expect(owner).toEqual({ userId: "user-1", loginGeneration: expect.any(String) });
    for (const tab of [a, b]) {
      const signedIn = tab.frames().findIndex((frame) => frame.status === "signed-in");
      expect(tab.framesSince(signedIn).every((frame) => frame.accountId === "user-1")).toBe(true);
      expect(tab.tab.reloads).toBe(0);
    }
    expect(harness.rest.requests().map(({ route }) => route)).toEqual([
      "GET /user/info",
      "GET /user/info",
    ]);
  });

  it("keeps both legacy tabs signed in when one renews the session", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const boot = harness.rest.hold("GET /user/info");
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);
    boot.release();
    await settle();
    const fromB = b.frames().length;
    harness.rest.expireAccessToken(storedToken(harness));

    await a.run(() => a.session().client.fetchUser());
    await settle();

    expect(harness.rest.refreshes()).toBe(1);
    expect(a.session().client.session?.accessToken).toBe(storedToken(harness));
    expect(b.session().client.session?.accessToken).toBe(storedToken(harness));
    expect(b.framesSince(fromB).every((frame) => frame.accountId === "user-1")).toBe(true);
    expect([a.tab.reloads, b.tab.reloads]).toEqual([0, 0]);
  });

  it("signs the other tab out without a reload and forgets the token it held", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);

    await a.run(() => a.session().signOut());
    await settle();

    expect(b.session().status).toBe("signed-out");
    expect(b.accountId()).toBeNull();
    expect(b.session().client.session).toBeNull();
    expect([a.tab.reloads, b.tab.reloads]).toEqual([0, 0]);
  });

  it("signs out without a reload when another tab clears the origin's storage", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const b = await recordingTab(harness);

    harness.browser.openTab().localStorage.clear();
    await settle();

    expect(b.session().status).toBe("signed-out");
    expect(b.accountId()).toBeNull();
    expect(b.session().client.session).toBeNull();
    expect(b.tab.reloads).toBe(0);
  });

  it("hears another tab's sign-out after its next sign-in was stored, and keeps that session", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const b = await recordingTab(harness);
    const next = harness.rest.issueSession("user-2");
    const other = harness.browser.openTab();

    other.localStorage.removeItem(ZEROPS_SESSION_STORAGE_KEY);
    other.localStorage.setItem(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(next));
    await settle();

    expect(storedToken(harness)).toBe(next.accessToken);
    expect(b.session().user?.id).toBe("user-2");
    expect(b.accountId()).toBe("user-2");
    expect(b.tab.reloads).toBe(0);
  });

  it("renews once over the network when two tabs hit an expired token at once", async () => {
    const harness = harnessWith({ signedIn: "user-1" });
    const a = await recordingTab(harness);
    const b = await recordingTab(harness);
    harness.rest.expireAccessToken(storedToken(harness));

    const reads = [a.session().client.fetchUser(), b.session().client.fetchUser()];
    await settle();
    const answers = await Promise.allSettled(reads);

    expect(answers.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
    expect(harness.rest.refreshes()).toBe(1);
    expect([a.session().status, b.session().status]).toEqual(["signed-in", "signed-in"]);
    expect(a.session().client.session?.accessToken).toBe(storedToken(harness));
    expect(b.session().client.session?.accessToken).toBe(storedToken(harness));
  });
});
