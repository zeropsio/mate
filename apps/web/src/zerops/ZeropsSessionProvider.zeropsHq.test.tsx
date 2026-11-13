import { ZeropsUserId } from "@t3tools/contracts";
import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import type { ZeropsSessionClient } from "@zerops/session/session.client";
import type { SessionView } from "@zerops/session/session.model";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

/** Zerops HQ's session as its bridge serves it to every Zerops app: one per test. */
const hq = vi.hoisted(() => {
  const state = {
    session: null as SessionView | null,
    listeners: new Set<(session: SessionView | null) => void>(),
    signIns: 0,
    signOuts: 0,
  };
  return {
    state,
    reset: () => {
      state.session = null;
      state.listeners.clear();
      state.signIns = 0;
      state.signOuts = 0;
    },
    /** Another app or tab changes HQ's session. */
    push: (session: SessionView | null) => {
      state.session = session;
      for (const listener of state.listeners) listener(session);
    },
  };
});

vi.mock("./zeropsHq", async (original) => {
  const actual = await original<typeof import("./zeropsHq")>();
  const client: ZeropsSessionClient = {
    ready: async () => hq.state.session,
    mode: () => "bridge",
    current: () => hq.state.session,
    frameSizes: () => null,
    rejected: async () => hq.state.session,
    changes: (listener) => {
      hq.state.listeners.add(listener);
      return () => {
        hq.state.listeners.delete(listener);
      };
    },
    signOut: async () => {
      hq.state.signOuts += 1;
      hq.push(null);
    },
    signIn: () => {
      hq.state.signIns += 1;
      return new Promise(() => undefined);
    },
    reopenSignIn: () => true,
    sudo: async () => undefined,
    reopenSudo: () => true,
    takeCarry: async () => null,
  };
  return { ...actual, makeZeropsHqClient: () => client };
});

const person: ZeropsUser = {
  id: ZeropsUserId.make("user-1"),
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const other: ZeropsUser = {
  id: ZeropsUserId.make("user-2"),
  email: "other@example.test",
  clientUserList: [{ id: "cu-2", clientId: "org-2", roleCode: "OWNER" }],
};

function harnessWith(options: { readonly signedIn?: string } = {}) {
  return makeAccountHarness({
    people: [
      { user: person, password: "secret" },
      { user: other, password: "other-secret" },
    ],
    ...options,
  });
}

/** HQ's session for a token the platform issued: everything but the refresh token, which stays on HQ. */
function viewOf(accessToken: string, userId: string): SessionView {
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: 21_600,
    expiresAt: "2099-01-01T00:00:00Z",
    twoFAMethods: null,
    twoFAVerified: null,
    sudoUntil: null,
    userId,
    actualUserId: userId,
    author: { authorId: userId, authorType: "CLIENT" },
  };
}

afterEach(async () => {
  await unmountTabs();
  hq.reset();
  vi.unstubAllEnvs();
});

describe("ZeropsSessionProvider in a zerops-hq build", () => {
  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | (view) => (view === null ? null : zeropsSessionOf(view)), → () => null,
  it("opens the account of Zerops HQ's session, and keeps none of it in storage", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();
    hq.state.session = viewOf(harness.rest.issueSession("user-1").accessToken, "user-1");

    const tab = await mountTab(harness, harness.browser.openTab());

    expect(tab.session().status).toBe("signed-in");
    expect(tab.session().user?.id).toBe("user-1");
    expect(harness.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY)).toBeNull();
    expect(hq.state.signIns).toBe(0);
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (status === "signed-out") promptSignIn(); → if (status === "signed-out") void 0;
  it("opens Zerops HQ's sign-in by itself when a load finds nobody signed in", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();

    const tab = await mountTab(harness, harness.browser.openTab());

    expect(tab.session().status).toBe("signed-out");
    expect(hq.state.signIns).toBe(1);
    expect(tab.session().zeropsHq?.state().kind).toBe("sign-in");
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (ended) promptSignIn(); → if (ended) void 0;
  it("follows Zerops HQ's session to another person, and out with it, opening HQ's sign-in", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();
    hq.state.session = viewOf(harness.rest.issueSession("user-1").accessToken, "user-1");
    const tab = await mountTab(harness, harness.browser.openTab());
    expect(tab.session().user?.id).toBe("user-1");

    await tab.run(() => hq.push(viewOf(harness.rest.issueSession("user-2").accessToken, "user-2")));
    await settle();
    expect(tab.session().user?.id).toBe("user-2");
    expect(tab.accountId()).toBe("user-2");

    await tab.run(() => hq.push(null));
    await settle();
    expect(tab.session().status).toBe("signed-out");
    expect(tab.accountId()).toBeNull();
    expect(hq.state.signIns).toBe(1);
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (renewed.userId !== stale.userId) → if (false)
  it("never repeats a refused request with the session of another person HQ now holds", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();
    const first = harness.rest.issueSession("user-1").accessToken;
    hq.state.session = viewOf(first, "user-1");
    const tab = await mountTab(harness, harness.browser.openTab());
    const second = harness.rest.issueSession("user-2").accessToken;
    // HQ holds the other person's session before its change reaches this tab.
    hq.state.session = viewOf(second, "user-2");
    harness.rest.expireAccessToken(first);

    await tab.run(() =>
      tab
        .session()
        .client.fetchUser()
        .catch(() => undefined),
    );

    expect(harness.rest.requests().filter(({ token }) => token === second)).toEqual([]);
    expect(tab.session().user?.id).toBe("user-1");
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (next !== null && prompts?.state().kind === "sign-in") prompts.close(); → void 0;
  it("closes Zerops HQ's sign-in once a session arrives by another route", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();
    const tab = await mountTab(harness, harness.browser.openTab());
    expect(tab.session().zeropsHq?.state().kind).toBe("sign-in");

    await tab.run(() => hq.push(viewOf(harness.rest.issueSession("user-1").accessToken, "user-1")));
    await settle();

    expect(tab.session().status).toBe("signed-in");
    expect(tab.session().zeropsHq?.state().kind).toBe("closed");
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | if (hq !== null) void hq.signOut().catch(() => undefined); → if (hq !== null) void 0;
  it("a person's sign-out ends Zerops HQ's session in every app, and leaves HQ's sign-in closed", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith();
    hq.state.session = viewOf(harness.rest.issueSession("user-1").accessToken, "user-1");
    const tab = await mountTab(harness, harness.browser.openTab());

    await tab.run(() => tab.session().signOut());
    await settle();

    expect(hq.state.signOuts).toBe(1);
    expect(tab.session().status).toBe("signed-out");
    expect(hq.state.signIns).toBe(0);
  });

  // witness: apps/web/src/zerops/ZeropsSessionProvider.tsx | void calls.revoke(old); → void old;
  it("signs out at the platform the session a build before Zerops HQ's kept here, and forgets it", async () => {
    vi.stubEnv("VITE_ZEROPS_SIGN_IN", "zerops-hq");
    const harness = harnessWith({ signedIn: "user-1" });
    const kept = JSON.parse(
      harness.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY)!,
    ) as { readonly accessToken: string };

    await mountTab(harness, harness.browser.openTab());
    await settle();

    expect(harness.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY)).toBeNull();
    expect(
      harness.rest
        .requests()
        .filter(({ route, token }) => route === "POST /auth/logout" && token === kept.accessToken),
    ).toHaveLength(1);
  });
});
