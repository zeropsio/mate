// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-out",
    retrying: false,
    client: { baseUrl: "https://api.example.test" },
    adoptHandover: async () => {},
    adoptDeviceLogin: async () => {},
    signOut: async () => {},
    verifyAgain: () => {},
  }),
}));

vi.mock("../ZeropsProjectsPage", () => ({ ZeropsProjectsPage: () => null }));

const asked = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock("~/zerops/deviceLogin", () => ({
  zeropsSignInMode: () => "device-login",
  runZeropsDeviceLogin: (input: { readonly intent?: string }) => {
    asked.push(input.intent);
    return {
      outcome: Promise.resolve({ kind: "expired", session: null }),
      cancel: () => {},
      reopen: () => {},
    };
  },
}));

vi.mock("~/zerops/nativeSignIn", () => ({
  readZeropsNativeSignInBridge: () => null,
  readZeropsNativeSignInProgress: () => undefined,
  runZeropsNativeSignIn: async () => {},
}));

import { ZeropsHostedLanding } from "./ZeropsHostedLanding";

afterEach(() => {
  document.body.innerHTML = "";
  asked.length = 0;
});

const press = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (button === undefined) throw new Error(`no ${label}`);
  await act(async () => {
    button.click();
  });
};

// The person may have made their account before the window ended: a second sign-up would refuse
// their address, and Zerops's sign-in offers to create an account to whoever has none.
it("Try again after a sign-up that did not finish reopens sign-in, never sign-up", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ZeropsHostedLanding />));
  await press("Create one on Zerops");
  await press("Try again");
  expect(asked).toEqual(["register", undefined]);
  await act(async () => root.unmount());
});
