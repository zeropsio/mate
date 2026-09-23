import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import { fetchAcross, makeFakeBroker, makeFakeGitea } from "@t3tools/client-runtime/zerops/testing";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  accountGiteaSessions,
  giteaClientFor,
  giteaSessionLogin,
  useGiteaSession,
} from "./accountGiteaSessions";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const GITEA = "https://gitea-1-3000.prg1.zerops.app";
const BROKER = "https://broker-1-8080.prg1.zerops.app";

const throwaways: ZeropsThrowawayPlatform = {
  mint: async () => ({ id: "throwaway", token: "the-throwaway" }),
  remove: async () => undefined,
};

/** The Gitea, its broker, and the one broker answer a test may hold back. */
function forge() {
  const gitea = makeFakeGitea(GITEA);
  gitea.setTags("acme", "group", []);
  const broker = makeFakeBroker({
    origin: BROKER,
    gitea,
    loginOf: () => `u-${accountOf.current}`,
  });
  const direct = fetchAcross(gitea, broker);
  let holdBroker = false;
  const held: Array<() => void> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (holdBroker && String(input).endsWith("/person/token")) {
      await new Promise<void>((resolve) => held.push(resolve));
    }
    return direct(input, init);
  }) as typeof globalThis.fetch;
  return {
    gitea,
    broker,
    fetch,
    holdBroker: () => {
      holdBroker = true;
    },
    held: () => held.length,
    answerHeld: () => {
      holdBroker = false;
      for (const answer of held.splice(0)) answer();
    },
  };
}

/** Who the fake broker names, as the throwaway's owner. */
const accountOf = { current: "nobody" };

function signIn(person: string): void {
  accountOf.current = person;
  openAccountLifetime(person);
}

function demandGitea(): () => void {
  const sessions = accountGiteaSessions();
  if (sessions === null) throw new Error("no account open");
  return sessions.demand({
    giteaOrigin: GITEA,
    brokerOrigin: BROKER,
    clientId: "org-1",
    platform: throwaways,
  });
}

/** Reads once as the person; the bearer of every Gitea request so far. */
async function bearersAfterRead(world: ReturnType<typeof forge>) {
  const client = giteaClientFor(GITEA);
  if (client === null) return null;
  await client.listTags("acme", "group");
  return world.gitea.requests().map((request) => request.bearer);
}

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

describe("the account's Gitea sessions in this tab", () => {
  let world: ReturnType<typeof forge>;
  const original = globalThis.fetch;

  beforeEach(() => {
    world = forge();
    globalThis.fetch = world.fetch;
  });

  afterEach(() => {
    closeAccountLifetime();
    globalThis.fetch = original;
    vi.unstubAllGlobals();
  });

  it("closing the account tells the surfaces that read it, with no Gitea demanded yet", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    signIn("person-a");
    const renders: Array<boolean> = [];

    function Probe() {
      renders.push(
        useGiteaSession({
          giteaOrigin: undefined,
          brokerOrigin: undefined,
          clientId: undefined,
          platform: undefined,
        }).signedIn,
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
    });
    const before = renders.length;

    await act(async () => {
      closeAccountLifetime();
    });
    expect(renders).toHaveLength(before + 1);

    await act(async () => {
      root.unmount();
    });
  });

  it("exist only while an account is open", () => {
    expect(accountGiteaSessions()).toBeNull();
    signIn("person-a");
    expect(accountGiteaSessions()).not.toBeNull();
    closeAccountLifetime();
    expect(accountGiteaSessions()).toBeNull();
  });

  it("sign-out, another person signs in on the same tab: no Gitea request carries the first person's token", async () => {
    signIn("person-a");
    demandGitea();
    await vi.waitFor(() => expect(giteaSessionLogin(GITEA)).toBe("u-person-a"));
    expect(await bearersAfterRead(world)).toEqual(["gitea-token-1"]);
    const clientOfA = giteaClientFor(GITEA);

    closeAccountLifetime();
    signIn("person-b");

    // Nothing of A's is left to read with: B's surface acquires its own.
    expect(giteaClientFor(GITEA)).toBeNull();
    expect(giteaSessionLogin(GITEA)).toBeUndefined();
    await expect(clientOfA?.listTags("acme", "group")).rejects.toThrow();

    demandGitea();
    await vi.waitFor(() => expect(giteaSessionLogin(GITEA)).toBe("u-person-b"));
    expect(await bearersAfterRead(world)).toEqual(["gitea-token-1", "gitea-token-2"]);
    expect(world.broker.personTokens()).toBe(2);
  });

  it("an acquisition in flight at sign-out never lands in the next account", async () => {
    world.holdBroker();
    signIn("person-a");
    demandGitea();
    await vi.waitFor(() => expect(world.held()).toBe(1));

    closeAccountLifetime();
    signIn("person-b");
    demandGitea();
    await vi.waitFor(() => expect(world.held()).toBe(2));

    // A's answer and B's are both let go; only B's lands, in B's account.
    world.answerHeld();
    await vi.waitFor(() => expect(giteaSessionLogin(GITEA)).toBe("u-person-b"));
    expect(world.broker.personTokens()).toBe(2);
    expect(await bearersAfterRead(world)).toEqual(["gitea-token-2"]);
  });
});
