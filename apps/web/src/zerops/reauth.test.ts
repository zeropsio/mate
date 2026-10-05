import { describe, expect, it } from "vite-plus/test";

import { makeZeropsReauth } from "./reauth";

function fakeTab(options: { readonly native?: boolean; readonly blocked?: boolean } = {}) {
  const store = new Map<string, string>();
  const went: string[] = [];
  let started = 0;
  const reauth = makeZeropsReauth({
    storage: () => {
      if (options.blocked) throw new Error("SecurityError");
      return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value);
        },
        removeItem: (key) => {
          store.delete(key);
        },
      };
    },
    native: () => options.native ?? false,
    go: (url) => {
      went.push(url);
    },
    start: () => `https://app.zerops.io/authorize-app?state=${++started}`,
  });
  return { reauth, went };
}

describe("makeZeropsReauth", () => {
  it("sends the tab for a fresh hand-over on the first refusal", () => {
    const tab = fakeTab();
    tab.reauth.ask();
    expect(tab.went).toEqual(["https://app.zerops.io/authorize-app?state=1"]);
  });

  // A fresh token refused at once would otherwise bounce between this tab and
  // the Zerops app for ever. The second refusal stays signed out, on the
  // landing's sign-in button.
  it("does not send the tab again when the fresh hand-over is refused too", () => {
    const tab = fakeTab();
    tab.reauth.ask();
    tab.reauth.ask();
    expect(tab.went).toHaveLength(1);
  });

  // Days later the handed-over token dies again in the ordinary way; that is
  // a new refusal, not the loop the guard is for.
  it("sends the tab again once a fresh load verified the session it brought", () => {
    const tab = fakeTab();
    tab.reauth.ask();
    tab.reauth.settled();
    tab.reauth.ask();
    expect(tab.went).toHaveLength(2);
  });

  // A desktop build signs in through the system browser on the person's
  // click; it never opens one on its own. It stays signed out instead.
  it("never sends a desktop window anywhere", () => {
    const tab = fakeTab({ native: true });
    tab.reauth.ask();
    expect(tab.went).toEqual([]);
  });

  // Without storage the guard cannot hold, so no round trip is started that
  // could loop; the tab stays signed out on its sign-in button.
  it("sends nowhere when this tab's storage is blocked", () => {
    const tab = fakeTab({ blocked: true });
    expect(() => tab.reauth.ask()).not.toThrow();
    expect(() => tab.reauth.settled()).not.toThrow();
    expect(tab.went).toEqual([]);
  });
});
